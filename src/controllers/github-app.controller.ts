import type { FastifyReply, FastifyRequest } from "fastify";
import { eq, desc } from "drizzle-orm";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { config } from "../config/env";
import { getDb } from "../db/client";
import { githubInstallations } from "../db/schema";
type GitHubInstallationSelect = typeof githubInstallations.$inferSelect;
import { EnvironmentRepository } from "../repositories/environment.repository";
import { ProjectRepository } from "../repositories/project.repository";
import { enqueueJob } from "../services/job-queue.service";
import { getUserFromSessionToken, getUserFromApiToken } from "../services/auth.service";
import { getSessionTokenFromRequest } from "../utils/cookie";
import { logger } from "../utils/logger";
import { createRelayInstallState, parseRelayInstallState } from "../utils/github/github-install-state";
import { getInstallationAccessToken } from "../utils/github/github-installation-token";
import { normalizeGithubRepoUrl } from "../utils/github/github-repo-url";
import { verifyGithubWebhookSignature } from "../utils/github/github-webhook-signature";
import {
  registerInstallationWithRelay,
  verifyRelayHopSignature,
  fetchReposFromRelay,
  fetchBranchesFromRelay,
} from "../utils/github/github-relay";
import { dashboardIntegrationsAbsoluteUrl } from "../utils/public-app-origin";

const projectRepo = new ProjectRepository();
const envRepo = new EnvironmentRepository();

const INSTALL_APP_URL = "https://github.com/apps/VersionGate-App/installations/new";

async function resolveRequestUser(req: FastifyRequest): Promise<{ id: string; email: string } | null> {
  const authed = req as FastifyRequest & { authUser?: { id: string; email: string } };
  if (authed.authUser) return authed.authUser;

  const authHeader = req.headers["authorization"];
  let token: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    token = req.headers["x-api-token"] as string | undefined;
  }
  if (token && token.startsWith("vg_")) {
    return getUserFromApiToken(token);
  }

  const raw = getSessionTokenFromRequest(req.headers.cookie);
  return getUserFromSessionToken(raw);
}

function githubAppReady(): boolean {
  const appId = Number(config.githubAppId);
  return Number.isFinite(appId) && appId > 0 && !!config.githubAppPrivateKey?.trim();
}

interface GitHubPushPayload {
  ref?: string;
  repository?: { clone_url?: string; html_url?: string };
}

type ReqWithRaw = FastifyRequest & { rawBody?: Buffer };

export async function githubInstallHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await resolveRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized", message: "Sign in required", code: "AUTH_REQUIRED" });
    return;
  }

  const effectivePublicUrl = (process.env.PUBLIC_URL || config.publicUrl || `${req.protocol}://${req.headers.host}`).trim().replace(/\/+$/, "");
  const effectiveStateSecret = (process.env.GITHUB_STATE_SECRET || config.githubStateSecret || "").trim();
  if (!effectiveStateSecret) {
    logger.error("githubInstallHandler: GITHUB_STATE_SECRET is not configured");
    reply.code(500).send({ error: "Server Error", message: "GitHub App relay state secret is unconfigured", code: "GITHUB_CONFIG_ERROR" });
    return;
  }

  const state = createRelayInstallState(user.id, effectivePublicUrl, effectiveStateSecret);
  const url = new URL(INSTALL_APP_URL);
  url.searchParams.set("state", state);

  logger.info(
    {
      userId: user.id,
      instanceUrl: effectivePublicUrl,
      redirectAfterInstall: dashboardIntegrationsAbsoluteUrl(req, { github: "connected" }),
    },
    "githubInstall: redirecting user to GitHub App install (relay state)"
  );

  reply.redirect(302, url.toString());
}

export async function githubCallbackHandler(
  req: FastifyRequest<{ Querystring: Record<string, string | undefined> }>,
  reply: FastifyReply
): Promise<void> {

  const installationIdStr = req.query.installation_id ?? "";
  const setupAction = req.query.setup_action ?? "";

  logger.info(
    {
      installation_id: installationIdStr,
      setup_action: setupAction,
    },
    "githubCallback: received redirect"
  );

  if (!installationIdStr || !/^\d+$/.test(installationIdStr)) {
    reply.redirect(302, dashboardIntegrationsAbsoluteUrl(req, { github: "missing_installation" }));
    return;
  }

  const rawCookie = getSessionTokenFromRequest(req.headers.cookie);
  const sessionUser = await getUserFromSessionToken(rawCookie);
  if (!sessionUser) {
    reply.redirect(302, dashboardIntegrationsAbsoluteUrl(req, { github: "auth_required" }));
    return;
  }

  const stateQ = typeof req.query.state === "string" ? req.query.state : undefined;
  if (stateQ && config.githubStateSecret && config.publicUrl) {
    const parsed = parseRelayInstallState(stateQ, config.githubStateSecret);
    if (parsed) {
      const want = config.publicUrl.trim().replace(/\/+$/, "");
      const got = parsed.instanceUrl.trim().replace(/\/+$/, "");
      if (got !== want) {
        logger.warn({ got, want }, "githubCallback: relay state instanceUrl does not match PUBLIC_URL");
        reply.redirect(302, dashboardIntegrationsAbsoluteUrl(req, { github: "bad_state" }));
        return;
      }
    }
  }

  const userId = sessionUser.id;

  if (setupAction === "request") {
    reply.redirect(302, dashboardIntegrationsAbsoluteUrl(req, {}));
    return;
  }

  let login = "";
  let accountType = "unknown";
  if (githubAppReady()) {
    try {
      const auth = createAppAuth({
        appId: Number(config.githubAppId),
        privateKey: config.githubAppPrivateKey,
      });
      const { token } = await auth({ type: "app" });
      const octokit = new Octokit({ auth: token });
      const { data: installation } = await octokit.rest.apps.getInstallation({
        installation_id: Number(installationIdStr),
      });

      const account = installation.account;
      if (!account || typeof account !== "object") {
        reply.redirect(302, dashboardIntegrationsAbsoluteUrl(req, { github: "bad_installation" }));
        return;
      }
      login = "login" in account ? account.login : "";
      accountType = "type" in account ? String(account.type) : "unknown";
    } catch (err) {
      logger.warn({ err }, "githubCallback: direct app installation fetch failed");
    }
  }
  const installationId = BigInt(installationIdStr);

  const db = getDb();
  const [existing] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);

  if (existing) {
    await db
      .update(githubInstallations)
      .set({
        userId,
        githubAccountLogin: login,
        githubAccountType: accountType,
      })
      .where(eq(githubInstallations.installationId, installationId));
  } else {
    await db.insert(githubInstallations).values({
      userId,
      installationId,
      githubAccountLogin: login,
      githubAccountType: accountType,
    });
  }

  if (config.publicUrl && config.githubStateSecret) {
    try {
      await registerInstallationWithRelay({
        installationId: installationIdStr,
        userId,
        instanceUrl: config.publicUrl,
        relaySecret: config.githubStateSecret,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), installationId: installationIdStr },
        "githubCallback: failed to register installation with versiongate.tech relay"
      );
    }
  }

  reply.redirect(302, dashboardIntegrationsAbsoluteUrl(req, { github: "connected" }));
}

async function resolveInstallationForUser(
  userId: string,
  installationIdQuery?: string
): Promise<GitHubInstallationSelect | null> {
  const db = getDb();
  if (installationIdQuery && /^\d+$/.test(installationIdQuery)) {
    const [row] = await db
      .select()
      .from(githubInstallations)
      .where(
        eq(githubInstallations.userId, userId)
      )
      .limit(1);
    return row ?? null;
  }

  const [row] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId))
    .orderBy(desc(githubInstallations.createdAt))
    .limit(1);

  return row ?? null;
}

async function avatarForInstallation(row: GitHubInstallationSelect, octokit: Octokit): Promise<string | null> {
  const login = row.githubAccountLogin;
  const kind = row.githubAccountType.toLowerCase();
  try {
    if (kind === "organization") {
      const { data } = await octokit.rest.orgs.get({ org: login });
      return data.avatar_url;
    }
    const { data } = await octokit.rest.users.getByUsername({ username: login });
    return data.avatar_url;
  } catch {
    return null;
  }
}

export async function githubInstallationRecordHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await resolveRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized", message: "Sign in required", code: "AUTH_REQUIRED" });
    return;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, user.id))
    .orderBy(desc(githubInstallations.createdAt));

  if (rows.length === 0) {
    reply.code(200).send({ installation: null, installations: [] });
    return;
  }

  const primary = rows[0];
  reply.code(200).send({
    installation: {
      installationId: primary.installationId.toString(),
      githubAccountLogin: primary.githubAccountLogin,
      githubAccountType: primary.githubAccountType,
      createdAt: primary.createdAt.toISOString(),
    },
    installations: rows.map((r) => ({
      installationId: r.installationId.toString(),
      githubAccountLogin: r.githubAccountLogin,
      githubAccountType: r.githubAccountType,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function githubLinkInstallationHandler(
  req: FastifyRequest<{ Body: { installationId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const user = await resolveRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized", message: "Sign in required", code: "AUTH_REQUIRED" });
    return;
  }

  const body = req.body as { installationId?: string } | undefined;
  const installationIdStr = (body?.installationId ?? "").trim();
  if (!installationIdStr || !/^\d+$/.test(installationIdStr)) {
    reply.code(400).send({
      error: "BadRequest",
      message: "Please enter a valid numeric GitHub Installation ID (e.g. 67554316).",
    });
    return;
  }

  let login = "";
  let accountType = "unknown";
  if (githubAppReady()) {
    try {
      const auth = createAppAuth({
        appId: Number(config.githubAppId),
        privateKey: config.githubAppPrivateKey,
      });
      const { token } = await auth({ type: "app" });
      const octokit = new Octokit({ auth: token });
      const { data: installation } = await octokit.rest.apps.getInstallation({
        installation_id: Number(installationIdStr),
      });

      const account = installation.account;
      if (account && typeof account === "object") {
        login = "login" in account ? String(account.login) : "";
        accountType = "type" in account ? String(account.type) : "unknown";
      }
    } catch (err) {
      logger.warn({ err }, "githubLinkInstallationHandler: direct app installation fetch failed");
    }
  }

  const installationId = BigInt(installationIdStr);
  const db = getDb();
  const [existing] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);

  if (existing) {
    await db
      .update(githubInstallations)
      .set({
        userId: user.id,
        githubAccountLogin: login || existing.githubAccountLogin || user.email.split("@")[0],
        githubAccountType: accountType !== "unknown" ? accountType : existing.githubAccountType,
      })
      .where(eq(githubInstallations.installationId, installationId));
  } else {
    await db.insert(githubInstallations).values({
      userId: user.id,
      installationId,
      githubAccountLogin: login || user.email.split("@")[0],
      githubAccountType: accountType,
    });
  }

  const effectivePublicUrl = (process.env.PUBLIC_URL || config.publicUrl || "").trim();
  const effectiveStateSecret = (process.env.GITHUB_STATE_SECRET || config.githubStateSecret || "").trim();
  if (effectivePublicUrl && effectiveStateSecret) {
    try {
      await registerInstallationWithRelay({
        installationId: installationIdStr,
        userId: user.id,
        instanceUrl: effectivePublicUrl,
        relaySecret: effectiveStateSecret,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), installationId: installationIdStr },
        "githubLinkInstallationHandler: failed to register installation with relay"
      );
    }
  }

  reply.code(200).send({
    success: true,
    installationId: installationIdStr,
    githubAccountLogin: login || user.email.split("@")[0],
  });
}

export async function githubIntegrationStatusHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await resolveRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized", message: "Sign in required", code: "AUTH_REQUIRED" });
    return;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, user.id))
    .orderBy(desc(githubInstallations.createdAt));

  if (rows.length === 0) {
    reply.code(200).send({ connected: false, installations: [] });
    return;
  }

  const primary = rows[0];
  let avatarUrl: string | null = null;
  if (githubAppReady()) {
    try {
      const { token } = await getInstallationAccessToken(primary.installationId);
      const octokit = new Octokit({ auth: token });
      avatarUrl = await avatarForInstallation(primary, octokit);
    } catch (err) {
      logger.warn({ err }, "githubIntegrationStatusHandler: avatar fetch failed");
    }
  }

  reply.code(200).send({
    connected: true,
    installations: rows.map((r) => ({
      installationId: r.installationId.toString(),
      githubAccountLogin: r.githubAccountLogin,
      githubAccountType: r.githubAccountType,
      createdAt: r.createdAt.toISOString(),
    })),
    installation: {
      installationId: primary.installationId.toString(),
      githubAccountLogin: primary.githubAccountLogin,
      githubAccountType: primary.githubAccountType,
      avatarUrl,
      createdAt: primary.createdAt.toISOString(),
    },
  });
}

export async function githubRepoBranchesHandler(
  req: FastifyRequest<{ Params: { owner: string; repo: string }; Querystring: { installationId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const user = await resolveRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized", message: "Sign in required", code: "AUTH_REQUIRED" });
    return;
  }

  const owner = decodeURIComponent(req.params.owner ?? "").trim();
  const repo = decodeURIComponent(req.params.repo ?? "").trim();
  if (!owner || !repo || owner.includes("/") || repo.includes("/")) {
    reply.code(400).send({ error: "BadRequest", message: "Invalid owner or repo" });
    return;
  }

  const q = req.query as { installationId?: string };
  const row = await resolveInstallationForUser(user.id, q.installationId);
  if (!row) {
    reply.code(400).send({
      error: "BadRequest",
      message: "No GitHub App installation for this user.",
    });
    return;
  }

  if (githubAppReady()) {
    const { token } = await getInstallationAccessToken(row.installationId);
    const octokit = new Octokit({ auth: token });

    const names: { name: string; sha: string | undefined }[] = [];
    let page = 1;
    for (;;) {
      const { data } = await octokit.rest.repos.listBranches({
        owner,
        repo,
        per_page: 100,
        page,
      });
      for (const b of data) {
        names.push({ name: b.name, sha: b.commit?.sha });
      }
      if (data.length < 100) break;
      page += 1;
    }

    reply.code(200).send({
      installationId: row.installationId.toString(),
      branches: names,
    });
    return;
  }

  const secretsToTry = [process.env.GITHUB_STATE_SECRET, config.githubStateSecret].filter((s): s is string => Boolean(s && s.trim()));
  for (const sec of secretsToTry) {
    try {
      const branches = await fetchBranchesFromRelay({
        installationId: row.installationId.toString(),
        owner,
        repo,
        relaySecret: sec.trim(),
      });
      reply.code(200).send({
        installationId: row.installationId.toString(),
        branches,
      });
      return;
    } catch (err) {
      logger.warn({ err, sec: sec.slice(0, 6) }, "githubRepoBranchesHandler: relay fetch attempt failed");
    }
  }

  reply.code(503).send({
    error: "ServiceUnavailable",
    message: "Could not fetch repository branches. Set GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY or ensure GITHUB_STATE_SECRET is configured.",
  });
}

export async function githubReposHandler(
  req: FastifyRequest<{ Querystring: { installationId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const user = await resolveRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized", message: "Sign in required", code: "AUTH_REQUIRED" });
    return;
  }

  const q = req.query as { installationId?: string };
  const row = await resolveInstallationForUser(user.id, q.installationId);

  if (!row) {
    reply.code(400).send({
      error: "BadRequest",
      message: "No GitHub App installation for this user. Open /api/auth/github/install first.",
    });
    return;
  }

  if (githubAppReady()) {
    const { token } = await getInstallationAccessToken(row.installationId);
    const octokit = new Octokit({ auth: token });

    const repositories: Awaited<
      ReturnType<Octokit["rest"]["apps"]["listReposAccessibleToInstallation"]>
    >["data"]["repositories"] = [];

    let page = 1;
    for (;;) {
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: 100,
        page,
      });
      repositories.push(...data.repositories);
      if (data.repositories.length < 100) break;
      page += 1;
    }

    reply.code(200).send({
      installationId: row.installationId.toString(),
      totalCount: repositories.length,
      repositories: repositories.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
        private: r.private,
        defaultBranch: r.default_branch,
        cloneUrl: r.clone_url,
        htmlUrl: r.html_url,
        language: r.language ?? null,
        updatedAt: r.updated_at ?? null,
        pushedAt: r.pushed_at ?? null,
      })),
    });
    return;
  }

  const secretsToTry = [process.env.GITHUB_STATE_SECRET, config.githubStateSecret].filter((s): s is string => Boolean(s && s.trim()));
  for (const sec of secretsToTry) {
    try {
      const repositories = await fetchReposFromRelay({
        installationId: row.installationId.toString(),
        relaySecret: sec.trim(),
      });
      reply.code(200).send({
        installationId: row.installationId.toString(),
        totalCount: repositories.length,
        repositories,
      });
      return;
    } catch (err) {
      logger.warn({ err, sec: sec.slice(0, 6) }, "githubReposHandler: relay fetch attempt failed");
    }
  }

  reply.code(503).send({
    error: "ServiceUnavailable",
    message: "Could not fetch repositories. Set GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY or ensure GITHUB_STATE_SECRET is configured.",
  });
}

async function handleGithubPushDeploy(
  payload: GitHubPushPayload,
  logPrefix: string
): Promise<{ triggered: boolean; projects: string[]; skipped?: string }> {
  const ref = payload.ref ?? "";
  const pushedBranch = ref.replace("refs/heads/", "");
  const cloneUrl = payload.repository?.clone_url ?? "";
  const htmlUrl = payload.repository?.html_url ?? "";
  const normalized = normalizeGithubRepoUrl(cloneUrl || htmlUrl);

  if (!normalized) {
    return { triggered: false, projects: [], skipped: "Could not determine repository URL" };
  }

  const projectsList = await projectRepo.findAll();
  const matches = projectsList.filter((p) => normalizeGithubRepoUrl(p.repoUrl) === normalized);

  if (matches.length === 0) {
    logger.info({ normalized }, `${logPrefix}: no VersionGate project matches repository`);
    return { triggered: false, projects: [], skipped: "No matching project for repository" };
  }

  const triggered: string[] = [];
  for (const project of matches) {
    const environments = await envRepo.findAllForProject(project.id);
    let matchingEnvs = pushedBranch
      ? environments.filter((e) => e.branch === pushedBranch)
      : environments.filter((e) => e.name === "production");

    if (matchingEnvs.length === 0) {
      const defaultEnv = await envRepo.findDefaultForProject(project.id);
      if (defaultEnv && (!pushedBranch || defaultEnv.branch === pushedBranch)) {
        matchingEnvs.push(defaultEnv);
      }
    }

    // If multiple environments match the same branch (e.g. default setup), prioritize production to prevent duplicate runs
    if (matchingEnvs.length > 1) {
      const prod = matchingEnvs.find((e) => e.name === "production");
      if (prod) {
        matchingEnvs = [prod];
      }
    }

    if (matchingEnvs.length === 0) {
      logger.info(
        { projectId: project.id, pushedBranch },
        `${logPrefix}: no matching environment branch for push — skipping`
      );
      continue;
    }

    for (const targetEnv of matchingEnvs) {
      logger.info(
        { projectId: project.id, projectName: project.name, environmentId: targetEnv.id, envName: targetEnv.name, ref },
        `${logPrefix}: triggering auto-deploy`
      );

      await enqueueJob("DEPLOY", project.id, {}, targetEnv.id);
      triggered.push(`${project.name}:${targetEnv.name}`);
    }
  }

  return { triggered: triggered.length > 0, projects: triggered };
}

export async function githubAppWebhookHandler(req: ReqWithRaw, reply: FastifyReply): Promise<void> {
  const secret = config.githubWebhookSecret;
  if (!secret) {
    reply.code(503).send({
      error: "ServiceUnavailable",
      message: "GITHUB_WEBHOOK_SECRET is not configured.",
    });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody?.length) {
    reply.code(400).send({ error: "BadRequest", message: "Missing raw body for signature verification" });
    return;
  }

  const sig = req.headers["x-hub-signature-256"];
  const sigStr = Array.isArray(sig) ? sig[0] : sig;
  if (!verifyGithubWebhookSignature(rawBody, sigStr, secret)) {
    reply.code(401).send({ error: "Unauthorized", message: "Invalid webhook signature" });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    reply.code(400).send({ error: "BadRequest", message: "Invalid JSON body" });
    return;
  }

  const event = req.headers["x-github-event"];
  const eventStr = (Array.isArray(event) ? event[0] : event)?.toLowerCase() ?? "";

  if (eventStr === "ping") {
    reply.code(200).send({ ok: true, ping: true });
    return;
  }

  if (eventStr !== "push") {
    reply.code(200).send({ skipped: true, reason: `Ignoring event: ${eventStr || "unknown"}` });
    return;
  }

  const result = await handleGithubPushDeploy(body as GitHubPushPayload, "GitHub App webhook");
  if (result.skipped && !result.triggered) {
    reply.code(200).send({ skipped: true, reason: result.skipped });
    return;
  }
  reply.code(200).send({ triggered: result.triggered, projects: result.projects });
}

export async function githubAppRelayWebhookHandler(req: ReqWithRaw, reply: FastifyReply): Promise<void> {
  const secret = config.githubStateSecret;
  if (!secret) {
    reply.code(503).send({
      error: "ServiceUnavailable",
      message: "GITHUB_STATE_SECRET is not configured (required for relay fan-out).",
    });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody?.length) {
    reply.code(400).send({ error: "BadRequest", message: "Missing raw body for signature verification" });
    return;
  }

  const installationHeader = req.headers["x-vg-installation-id"];
  const installationId = (Array.isArray(installationHeader) ? installationHeader[0] : installationHeader) ?? "";
  if (!installationId || !/^\d+$/.test(installationId)) {
    reply.code(400).send({ error: "BadRequest", message: "Missing X-VG-Installation-Id" });
    return;
  }

  const hop = req.headers["x-vg-relay-signature"];
  const hopStr = Array.isArray(hop) ? hop[0] : hop;
  if (!verifyRelayHopSignature(rawBody, installationId, hopStr, secret)) {
    reply.code(401).send({ error: "Unauthorized", message: "Invalid relay signature" });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    reply.code(400).send({ error: "BadRequest", message: "Invalid JSON body" });
    return;
  }

  const event = req.headers["x-github-event"];
  const eventStr = (Array.isArray(event) ? event[0] : event)?.toLowerCase() ?? "";

  if (eventStr === "ping") {
    reply.code(200).send({ ok: true, ping: true });
    return;
  }

  if (eventStr !== "push") {
    reply.code(200).send({ skipped: true, reason: `Ignoring event: ${eventStr || "unknown"}` });
    return;
  }

  const result = await handleGithubPushDeploy(body as GitHubPushPayload, "GitHub relay webhook");
  if (result.skipped && !result.triggered) {
    reply.code(200).send({ skipped: true, reason: result.skipped, installationId });
    return;
  }
  reply.code(200).send({ triggered: result.triggered, projects: result.projects, installationId });
}

export async function githubDetectRepoHandler(
  req: FastifyRequest<{ Querystring: { owner?: string; repo?: string; installationId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { owner, repo } = req.query;
  if (!owner || !repo) {
    reply.code(400).send({ error: "BadRequest", message: "Missing owner or repo" });
    return;
  }

  const suggestions = [
    { label: "Repository root (.)", value: "." },
    { label: "website", value: "website" },
    { label: "dashboard", value: "dashboard" },
    { label: "apps/web", value: "apps/web" },
    { label: "frontend", value: "frontend" },
  ];

  reply.code(200).send({
    detectedContext: ".",
    detectedPort: 3000,
    framework: "Node.js / React / Next.js",
    suggestions,
  });
}
