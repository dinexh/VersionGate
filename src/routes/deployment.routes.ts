import { FastifyInstance } from "fastify";
import {
  deployHandler,
  listDeploymentsHandler,
  statusHandler,
  cancelDeployHandler,
} from "../controllers/deployment.controller";

const deployBodySchema = {
  type: "object",
  required: ["projectId"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    environmentId: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

const deploymentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    version: { type: "number" },
    imageTag: { type: "string" },
    containerName: { type: "string" },
    port: { type: "number" },
    color: { type: "string" },
    status: { type: "string" },
    errorMessage: { type: "string", nullable: true },
    environmentId: { type: "string" },
    projectId: { type: "string" },
    projectName: { type: "string", nullable: true },
    promotedFromId: { type: "string", nullable: true },
    jobId: { type: "string", nullable: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

export async function deploymentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/deploy", {
    schema: {
      body: deployBodySchema,
      response: {
        202: {
          type: "object",
          properties: {
            jobId: { type: "string" },
            status: { type: "string" },
            environmentId: { type: "string" },
          },
        },
      },
    },
    handler: deployHandler,
  });

  app.get("/deployments", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            deployments: { type: "array", items: deploymentSchema },
          },
        },
      },
    },
    handler: listDeploymentsHandler,
  });

  app.get("/projects/:id/deployments", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            deployments: { type: "array", items: deploymentSchema },
          },
        },
      },
    },
    handler: listDeploymentsHandler,
  });

  app.get("/status", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            activeDeployment: { ...deploymentSchema, nullable: true },
          },
        },
      },
    },
    handler: statusHandler,
  });

  app.post("/projects/:id/cancel-deploy", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: { cancelled: { type: "boolean" } },
        },
      },
    },
    handler: cancelDeployHandler,
  });
}
