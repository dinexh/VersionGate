const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api/v1";

/** Routes mounted at `/api` (GitHub App) — not under `/api/v1`. */
function githubApiBase(): string {
  const v = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/$/, "");
  if (!v) return "/api";
  return v.replace(/\/api\/v1$/i, "/api");
}

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(method: string, path: string, body?: unknown, baseUrl: string = API_BASE): Promise<T> {
  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    const data = await parseJsonSafe(res);
    let msg = `HTTP ${res.status}`;
    if (typeof data === "object" && data !== null) {
      const o = data as { message?: unknown; error?: unknown };
      if (o.message != null && String(o.message)) msg = String(o.message);
      else if (o.error != null && String(o.error)) msg = String(o.error);
    }
    throw new ApiError(msg, res.status, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type DeploymentStatus =
  | "PENDING"
  | "DEPLOYING"
  | "ACTIVE"
  | "FAILED"
  | "ROLLED_BACK";

export interface Project {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  localPath: string;
  buildContext: string;
  appPort: number;
  healthPath: string;
  basePort: number;
  webhookSecret?: string | null;
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  version: number;
  imageTag: string;
  containerName: string;
  port: number;
  color: string;
  status: DeploymentStatus;
  errorMessage?: string | null;
  /** Derived from the parent environment for dashboard filtering */
  projectId: string;
  environmentId?: string;
  promotedFromId?: string | null;
  jobId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentRow {
  id: string;
  name: string;
  projectId: string;
  branch: string;
  serverHost: string;
  basePort: number;
  appPort: number;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response from `GET /projects/:id/environments` (chain UI + active slot). */
export interface EnvironmentSummary {
  id: string;
  name: string;
  chainOrder: number;
  branch: string;
  basePort: number;
  appPort: number;
  env?: Record<string, string>;
  activeDeployment: {
    id: string;
    version: number;
    imageTag: string;
    status: DeploymentStatus;
    port: number;
    color: string;
  } | null;
}

export interface JobRecord {
  id: string;
  type: string;
  status: string;
  projectId: string;
  deploymentId: string | null;
  payload: unknown;
  result: unknown;
  logs: string[];
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on `GET /jobs` list */
  project?: { id: string; name: string };
}

export interface ServerStats {
  status: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used: number;
  memory_total: number;
  disk_percent: number;
  disk_used: number;
  disk_total: number;
  network_sent: number;
  network_recv: number;
  /** Bytes per second since last collector sample (when available). */
  network_sent_rate?: number;
  network_recv_rate?: number;
  uptime: number;
  load_avg: [number, number, number];
  process_count: number;
  timestamp: string;
}

export function getProjects(): Promise<{ projects: Project[] }> {
  return request("GET", "/projects");
}

export function getProject(id: string): Promise<{ project: Project }> {
  return request("GET", `/projects/${id}`);
}

export type ProjectDomainSslStatus = "pending_dns" | "http" | "issued" | "failed";

export interface ProjectDomain {
  id: string;
  hostname: string;
  environmentName: string;
  sslStatus: ProjectDomainSslStatus;
  lastError: string | null;
  dnsA: string[];
  dnsOk: boolean;
  createdAt: string;
  updatedAt: string;
}

export function listProjectDomains(projectId: string): Promise<{
  domains: ProjectDomain[];
  resolvedPort: number | null;
  expectedIpv4: string | null;
}> {
  return request("GET", `/projects/${projectId}/domains`);
}

export function attachProjectDomain(
  projectId: string,
  hostname: string
): Promise<{ domain: ProjectDomain; resolvedPort: number | null }> {
  return request("POST", `/projects/${projectId}/domains`, { hostname });
}

export function removeProjectDomain(projectId: string, domainId: string): Promise<void> {
  return request("DELETE", `/projects/${projectId}/domains/${domainId}`);
}

export function issueProjectDomainSsl(
  projectId: string,
  domainId: string
): Promise<{ ok: boolean; message: string; sslStatus: ProjectDomainSslStatus }> {
  return request("POST", `/projects/${projectId}/domains/${domainId}/ssl`);
}

export function createProject(data: {
  name: string;
  repoUrl: string;
  branch?: string;
  buildContext?: string;
  appPort: number;
  healthPath?: string;
  env?: Record<string, string>;
}): Promise<{ project: Project }> {
  return request("POST", "/projects", data);
}

export function updateProject(
  id: string,
  data: {
    name?: string;
    repoUrl?: string;
    branch?: string;
    buildContext?: string;
    appPort?: number;
    healthPath?: string;
    basePort?: number;
    env?: Record<string, string>;
  }
): Promise<{ project: Project }> {
  return request("PATCH", `/projects/${id}`, data);
}

export function updateProjectEnv(
  id: string,
  env: Record<string, string>
): Promise<{ project: Project }> {
  return request("PATCH", `/projects/${id}/env`, { env });
}

export interface ProjectAnalytics {
  projectId: string;
  totalHits: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  avgLatencyMs: number;
  recentHitsByHour: { hour: string; count: number }[];
}

export function getProjectAnalytics(id: string): Promise<{ analytics: ProjectAnalytics }> {
  return request("GET", `/projects/${id}/analytics`);
}

export function deleteProject(id: string): Promise<void> {
  return request("DELETE", `/projects/${id}`);
}

export function triggerDeploy(
  projectId: string,
  environmentId?: string
): Promise<{ jobId: string; status: string; environmentId?: string }> {
  return request("POST", "/deploy", { projectId, ...(environmentId ? { environmentId } : {}) });
}

export function listEnvironments(projectId: string): Promise<{ environments: EnvironmentSummary[] }> {
  return request("GET", `/projects/${projectId}/environments`);
}

export function patchEnvironmentEnv(
  projectId: string,
  envId: string,
  env: Record<string, string>
): Promise<{ environment: EnvironmentSummary }> {
  return request("PATCH", `/projects/${projectId}/environments/${envId}/env`, { env });
}

export const getProjectEnvironments = listEnvironments;

export function rollback(
  projectId: string,
  environmentId?: string
): Promise<{ jobId: string; status: string; environmentId?: string }> {
  if (environmentId) {
    return request("POST", `/projects/${projectId}/environments/${environmentId}/rollback`);
  }
  return request("POST", `/projects/${projectId}/rollback`);
}

/** Reuse the source environment's ACTIVE image on the target environment (no build). */
export function promoteEnvironment(
  projectId: string,
  targetEnvironmentId: string,
  sourceEnvironmentId: string
): Promise<{
  jobId: string;
  status: string;
  environmentId: string;
  sourceEnvironmentId: string;
  imageTag: string;
}> {
  return request("POST", `/projects/${projectId}/environments/${targetEnvironmentId}/promote`, {
    sourceEnvironmentId,
  });
}

export function getDeployments(projectId: string): Promise<{ deployments: Deployment[] }> {
  return request("GET", `/projects/${projectId}/deployments`);
}

export function getAllDeployments(): Promise<{ deployments: Deployment[] }> {
  return request("GET", "/deployments");
}

export function getServerStats(): Promise<ServerStats> {
  return request("GET", "/server/stats");
}

export type PreflightSeverity = "required" | "recommended" | "informational";

export interface PreflightCheck {
  id: string;
  label: string;
  severity: PreflightSeverity;
  ok: boolean;
  message: string;
  detail?: string;
}

export interface PreflightReport {
  ok: boolean;
  checkedAt: string;
  checks: PreflightCheck[];
}

export function getPreflight(): Promise<PreflightReport> {
  return request("GET", "/system/preflight");
}

export interface DashboardAlert {
  type: string;
  message: string;
  severity: "low" | "medium" | "high";
}

export interface SystemDashboardResponse {
  status: string;
  system_stats: ServerStats;
  connections: { local_address: string; remote_address: string; state: string }[];
  listening_ports: { address: string; port: number }[];
  top_processes: { pid: number; name: string; cpu_percent: number; memory_percent: number }[];
  alerts: DashboardAlert[];
}

export function cancelJob(jobId: string): Promise<{ cancelled: boolean }> {
  return request("DELETE", `/jobs/${jobId}`);
}

export function getServerDashboard(): Promise<SystemDashboardResponse> {
  return request("GET", "/system/server-dashboard");
}

export interface EngineHealthReport {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime: number;
  database: { connected: boolean; latencyMs: number };
  redis: { connected: boolean; available: boolean };
  containers: { totalActive: number; healthyCount: number; failedCount: number };
  system: { cpuPercent: number; memoryPercent: number; diskPercent: number };
  alerts: Array<{ id: string; type: string; message: string; severity: "low" | "medium" | "high" }>;
}

export function getEngineHealth(): Promise<EngineHealthReport> {
  return request("GET", "/system/engine-health");
}

export interface SetupStatus {
  configured: boolean;
  dbConnected: boolean;
  /** True when `.env` exists but this process has not loaded DATABASE_URL — restart the API. */
  needsRestart: boolean;
}

export function getSetupStatus(): Promise<SetupStatus> {
  return request("GET", "/setup/status");
}

export interface AuthStatus {
  databaseReady: boolean;
  hasUsers: boolean;
  authenticated: boolean;
  user?: { id: string; email: string };
}

export function getAuthStatus(): Promise<AuthStatus> {
  return request("GET", "/auth/status");
}

export function getAuthMe(): Promise<{ authenticated: boolean; user?: { id: string; email: string } }> {
  return request("GET", "/auth/me");
}

export function authRegister(body: { email: string; password: string }): Promise<{ user: { id: string; email: string } }> {
  return request("POST", "/auth/register", body);
}

export function authLogin(body: { email: string; password: string }): Promise<{ user: { id: string; email: string } }> {
  return request("POST", "/auth/login", body);
}

export function authLogout(): Promise<{ ok: boolean }> {
  return request("POST", "/auth/logout");
}

export function changePassword(body: { currentPassword?: string; newPassword: string }): Promise<{ ok: boolean; message: string }> {
  return request("POST", "/auth/password", body);
}

export interface ApiTokenItem {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function getApiTokens(): Promise<{ tokens: ApiTokenItem[] }> {
  return request("GET", "/auth/tokens");
}

export function createApiToken(name: string): Promise<{ token: { id: string; name: string; token: string; tokenPrefix: string; createdAt: string } }> {
  return request("POST", "/auth/tokens", { name });
}

export function revokeApiToken(id: string): Promise<{ ok: boolean }> {
  return request("DELETE", `/auth/tokens/${id}`);
}

export interface InstanceSettings {
  engineVersion: string;
  nodeEnv: string;
  apiPort: number;
  dockerNetwork: string;
  projectsRootPath: string;
  nginxConfigPath: string;
  /** @deprecated Use drizzleSchemaSync — kept for older API responses */
  prismaSchemaSync?: "migrate" | "push";
  drizzleSchemaSync: "migrate" | "push";
  inProcessWorker: boolean;
  databaseUrlInEnvFile: boolean;
  databaseUrlLoaded: boolean;
  databaseReachable: boolean;
  needsRestart: boolean;
  encryptionKeyConfigured: boolean;
  geminiConfigured: boolean;
  /** Public hostname or IPv4 from `.env` (`PUBLIC_DOMAIN`). */
  publicDomain: string;
  /** URL path prefix where the app is exposed (`PUBLIC_BASE_PATH`, e.g. `/` or `/versiongate`). */
  publicBasePath: string;
  /** Let's Encrypt contact email from `.env` (`CERTBOT_EMAIL`). */
  certbotEmail: string;
  selfUpdateConfigured: boolean;
  selfUpdateGitBranch: string;
  selfUpdatePollMs: number;
  selfUpdateAutoApply: boolean;
}

export interface SelfUpdateGitStatus {
  branch: string;
  isGitRepo: boolean;
  currentCommit: string;
  remoteCommit: string | null;
  behind: boolean;
  message?: string;
}

export interface SelfUpdateSettingsResponse {
  configured: boolean;
  branch: string;
  pollMs: number;
  autoApply: boolean;
  git: SelfUpdateGitStatus | null;
}

export function getSelfUpdateSettings(): Promise<SelfUpdateSettingsResponse> {
  return request("GET", "/settings/self-update");
}

export function enableSelfUpdateFromSettings(): Promise<{ message: string }> {
  return request("POST", "/settings/self-update/enable");
}

export interface SelfUpdateProgress {
  status: "idle" | "running" | "complete" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  currentStep: string | null;
  steps: string[];
  error?: string;
}

export function checkSelfUpdateFromSettings(): Promise<SelfUpdateGitStatus> {
  return request("POST", "/settings/self-update/check");
}

export function applySelfUpdateFromSettings(): Promise<{ ok: boolean; started?: boolean; steps: string[]; error?: string }> {
  return request("POST", "/settings/self-update/apply");
}

export function getSelfUpdateProgress(): Promise<SelfUpdateProgress> {
  return request("GET", "/settings/self-update/progress");
}

export function getInstanceSettings(): Promise<InstanceSettings> {
  return request("GET", "/settings/instance");
}

export function patchInstanceEnv(env: Record<string, string>): Promise<{
  message: string;
  keysWritten: string[];
}> {
  return request("PATCH", "/settings/env", { env });
}

export function applyNginxSite(body: {
  publicDomain?: string;
  publicBasePath?: string;
}): Promise<{
  ok: boolean;
  message: string;
  path: string;
  publicDomain: string;
  publicBasePath: string;
}> {
  return request("POST", "/settings/nginx/apply", body);
}

export function requestCertbotSsl(body: {
  email?: string;
  /** Sent to API so `.env` matches the form before Certbot runs (recommended when switching subdomain). */
  publicDomain?: string;
}): Promise<{ ok: boolean; message: string }> {
  return request("POST", "/settings/ssl/certbot", body);
}

export function applySetup(body: {
  domain: string;
  databaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  geminiApiKey?: string;
}): Promise<{ configured: boolean }> {
  return request("POST", "/setup/apply", body);
}

export function getJobStatus(jobId: string): Promise<{ job: JobRecord }> {
  return request("GET", `/jobs/${jobId}`);
}

export function listProjectJobs(
  projectId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ jobs: JobRecord[]; total: number; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.offset != null) q.set("offset", String(opts.offset));
  const qs = q.toString();
  return request("GET", `/projects/${projectId}/jobs${qs ? `?${qs}` : ""}`);
}

/** All deploy/rollback jobs across projects (newest first). */
export function listAllJobs(opts?: { limit?: number; offset?: number }): Promise<{
  jobs: JobRecord[];
  total: number;
  limit: number;
  offset: number;
}> {
  const q = new URLSearchParams();
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.offset != null) q.set("offset", String(opts.offset));
  const qs = q.toString();
  return request("GET", `/jobs${qs ? `?${qs}` : ""}`);
}

export interface GithubInstallationSummary {
  installationId: string;
  githubAccountLogin: string;
  githubAccountType: string;
  createdAt: string;
}

export interface GithubIntegrationStatus {
  connected: boolean;
  installations: GithubInstallationSummary[];
  installation?: {
    installationId: string;
    githubAccountLogin: string;
    githubAccountType: string;
    avatarUrl: string | null;
    createdAt: string;
  };
}

export interface GithubRepoRow {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string | null;
  cloneUrl: string;
  htmlUrl: string;
  language: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
}

export interface GithubReposResponse {
  installationId: string;
  totalCount: number;
  repositories: GithubRepoRow[];
}

export interface GithubBranchRow {
  name: string;
  sha?: string;
}

export interface GithubBranchesResponse {
  installationId: string;
  branches: GithubBranchRow[];
}

export interface GithubInstallationGateResponse {
  installation: GithubInstallationSummary | null;
  installations: GithubInstallationSummary[];
}

export function getGithubInstallation(): Promise<GithubInstallationGateResponse> {
  return request("GET", "/github/installation", undefined, githubApiBase());
}

export function linkGithubInstallation(installationId: string): Promise<{
  success: boolean;
  installationId: string;
  githubAccountLogin: string;
}> {
  return request<{ success: boolean; installationId: string; githubAccountLogin: string }>(
    "POST",
    "/github/installation/link",
    { installationId },
    githubApiBase()
  );
}

export function deleteGithubInstallation(installationId?: string): Promise<{ success: boolean; message: string }> {
  const q = installationId ? `?installationId=${encodeURIComponent(installationId)}` : "";
  return request<{ success: boolean; message: string }>(
    "DELETE",
    `/github/installation${q}`,
    undefined,
    githubApiBase()
  );
}

export function getGithubIntegrationStatus(): Promise<GithubIntegrationStatus> {
  return request("GET", "/github/status", undefined, githubApiBase());
}

export function getGithubRepos(installationId?: string): Promise<GithubReposResponse> {
  const q = installationId ? `?installationId=${encodeURIComponent(installationId)}` : "";
  return request("GET", `/github/repos${q}`, undefined, githubApiBase());
}

export function getGithubRepoBranches(
  owner: string,
  repo: string,
  installationId?: string
): Promise<GithubBranchesResponse> {
  const q = installationId ? `?installationId=${encodeURIComponent(installationId)}` : "";
  return request(
    "GET",
    `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches${q}`,
    undefined,
    githubApiBase()
  );
}

export interface RepoStackDetection {
  detected: boolean;
  stack: string;
  label: string;
  framework: string;
  recommendedPort: number;
  recommendedHealthPath: string;
  recommendedBuildContext: string;
  confidence: "high" | "medium" | "low";
  suggestions: { label: string; value: string }[];
}

export function detectRepoStack(
  owner: string,
  repo: string,
  branch?: string,
  installationId?: string
): Promise<RepoStackDetection> {
  const params = new URLSearchParams({ owner, repo });
  if (branch) params.set("branch", branch);
  if (installationId) params.set("installationId", installationId);
  return request(
    "GET",
    `/github/repos/detect?${params.toString()}`,
    undefined,
    githubApiBase()
  );
}

export function createWebSocket(jobId: string): WebSocket {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    const u = new URL(envUrl);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(`${wsProto}//${u.host}/api/v1/logs/${jobId}`);
  }
  if (typeof window !== "undefined") {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(`${wsProto}//${window.location.host}/api/v1/logs/${jobId}`);
  }
  return new WebSocket(`ws://localhost:9090/api/v1/logs/${jobId}`);
}
