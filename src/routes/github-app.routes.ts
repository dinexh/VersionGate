import type { FastifyInstance } from "fastify";
import { requireDatabaseConfigured } from "../middleware/require-database";
import {
  githubAppRelayWebhookHandler,
  githubAppWebhookHandler,
  githubCallbackHandler,
  githubInstallationRecordHandler,
  githubDeleteInstallationHandler,
  githubLinkInstallationHandler,
  githubIntegrationStatusHandler,
  githubInstallHandler,
  githubRepoBranchesHandler,
  githubReposHandler,
  githubDetectRepoHandler,
} from "../controllers/github-app.controller";

export async function githubAppRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireDatabaseConfigured);
  app.get("/auth/github/install", githubInstallHandler);
  app.get("/auth/github/callback", githubCallbackHandler);
  app.get("/github/installation", githubInstallationRecordHandler);
  app.delete("/github/installation", githubDeleteInstallationHandler);
  app.delete("/github/installation/:installationId", githubDeleteInstallationHandler);
  app.post("/github/installation/link", githubLinkInstallationHandler);
  app.get("/github/status", githubIntegrationStatusHandler);
  app.get("/github/repos/:owner/:repo/branches", githubRepoBranchesHandler);
  app.get("/github/repos/detect", githubDetectRepoHandler);
  app.get("/github/repos", githubReposHandler);
  app.post("/webhooks/github", githubAppWebhookHandler);
  app.post("/webhooks/github/relay", githubAppRelayWebhookHandler);
}
