import { FastifyRequest, FastifyReply } from "fastify";
import { ProjectRepository } from "../repositories/project.repository";
import { EnvironmentRepository } from "../repositories/environment.repository";
import { enqueueJob } from "../services/job-queue.service";
import { logger } from "../utils/logger";

const projectRepo = new ProjectRepository();
const envRepo = new EnvironmentRepository();

interface WebhookParams {
  secret: string;
}

// Minimal shape we care about from a GitHub push event
interface GitHubPushPayload {
  ref?: string;                                // e.g. "refs/heads/main"
  repository?: { clone_url?: string; html_url?: string };
}

export async function githubWebhookHandler(
  req: FastifyRequest<{ Params: WebhookParams; Body: GitHubPushPayload }>,
  reply: FastifyReply
): Promise<void> {
  const { secret } = req.params;

  // Look up the project by its webhook secret
  const project = await projectRepo.findByWebhookSecret(secret);
  if (!project) {
    return reply.code(404).send({ error: "NotFound", message: "No project found for this webhook URL" });
  }

  // Only handle push events (GitHub also sends ping, etc.)
  const event = req.headers["x-github-event"] as string | undefined;
  if (event && event !== "push") {
    return reply.code(200).send({ skipped: true, reason: `Ignoring event: ${event}` });
  }

  const environments = await envRepo.findAllForProject(project.id);

  // Find all environments matching the pushed branch
  const ref = req.body?.ref ?? "";
  const pushedBranch = ref.replace("refs/heads/", "");

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
      "Webhook: branch mismatch — skipping"
    );
    return reply.code(200).send({
      skipped: true,
      reason: `Push to '${pushedBranch}' does not match any configured environment branch`,
    });
  }

  for (const targetEnv of matchingEnvs) {
    logger.info(
      { projectId: project.id, projectName: project.name, environmentId: targetEnv.id, envName: targetEnv.name, ref },
      "Webhook: triggering auto-deploy"
    );

    enqueueJob("DEPLOY", project.id, {}, targetEnv.id).catch((err) => {
      logger.error({ projectId: project.id, environmentId: targetEnv.id, err }, "Webhook: failed to enqueue deploy job");
    });
  }

  return reply.code(200).send({
    triggered: true,
    project: project.name,
    environments: matchingEnvs.map((e) => e.name),
  });
}
