import { eq, and, desc, lt, max } from "drizzle-orm";
import { getDb } from "../db/client";
import { deployments, environments, projects, jobs, DeploymentSelect, ProjectSelect } from "../db/schema";

export type DeploymentStatusType = "PENDING" | "DEPLOYING" | "ACTIVE" | "FAILED" | "ROLLED_BACK";
export type DeploymentColorType = "BLUE" | "GREEN";

export class DeploymentRepository {
  async create(data: {
    version: number;
    imageTag: string;
    containerName: string;
    port: number;
    color: DeploymentColorType;
    status: DeploymentStatusType;
    environment: { connect: { id: string } };
    promotedFromId?: string | null;
  }): Promise<DeploymentSelect> {
    const db = getDb();
    const now = new Date();
    const [created] = await db
      .insert(deployments)
      .values({
        version: data.version,
        imageTag: data.imageTag,
        containerName: data.containerName,
        port: data.port,
        color: data.color,
        status: data.status,
        environmentId: data.environment.connect.id,
        promotedFromId: data.promotedFromId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  }

  async findById(id: string): Promise<DeploymentSelect | null> {
    const db = getDb();
    const [d] = await db.select().from(deployments).where(eq(deployments.id, id)).limit(1);
    return d ?? null;
  }

  async findActiveForEnvironment(environmentId: string): Promise<DeploymentSelect | null> {
    const db = getDb();
    const [d] = await db
      .select()
      .from(deployments)
      .where(and(eq(deployments.environmentId, environmentId), eq(deployments.status, "ACTIVE")))
      .orderBy(desc(deployments.createdAt))
      .limit(1);
    return d ?? null;
  }

  async findDeployingForEnvironment(environmentId: string): Promise<DeploymentSelect | null> {
    const db = getDb();
    const [d] = await db
      .select()
      .from(deployments)
      .where(and(eq(deployments.environmentId, environmentId), eq(deployments.status, "DEPLOYING")))
      .orderBy(desc(deployments.createdAt))
      .limit(1);
    return d ?? null;
  }

  async findPreviousForEnvironment(
    environmentId: string,
    currentVersion: number
  ): Promise<DeploymentSelect | null> {
    const db = getDb();
    const [d] = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.environmentId, environmentId),
          eq(deployments.status, "ROLLED_BACK"),
          lt(deployments.version, currentVersion)
        )
      )
      .orderBy(desc(deployments.version))
      .limit(1);
    return d ?? null;
  }

  async findAllForEnvironment(environmentId: string): Promise<DeploymentSelect[]> {
    const db = getDb();
    return db
      .select()
      .from(deployments)
      .where(eq(deployments.environmentId, environmentId))
      .orderBy(desc(deployments.createdAt));
  }

  async findAllForProject(
    projectId: string
  ): Promise<(DeploymentSelect & { projectId: string; jobId?: string | null })[]> {
    const db = getDb();
    const rows = await db
      .select({
        deployment: deployments,
        projectId: environments.projectId,
        jobId: jobs.id,
      })
      .from(deployments)
      .innerJoin(environments, eq(deployments.environmentId, environments.id))
      .leftJoin(jobs, eq(deployments.id, jobs.deploymentId))
      .where(eq(environments.projectId, projectId))
      .orderBy(desc(deployments.createdAt));

    return rows.map((r) => ({ ...r.deployment, projectId: r.projectId, jobId: r.jobId ?? null }));
  }

  async getNextVersionForEnvironment(environmentId: string): Promise<number> {
    const db = getDb();
    const [res] = await db
      .select({ maxVersion: max(deployments.version) })
      .from(deployments)
      .where(eq(deployments.environmentId, environmentId));

    return (res?.maxVersion ?? 0) + 1;
  }

  async findAllDeploying(): Promise<DeploymentSelect[]> {
    const db = getDb();
    return db.select().from(deployments).where(eq(deployments.status, "DEPLOYING"));
  }

  async findAllActiveWithProjects(): Promise<(DeploymentSelect & { project: ProjectSelect })[]> {
    const db = getDb();
    const rows = await db
      .select({
        deployment: deployments,
        project: projects,
      })
      .from(deployments)
      .innerJoin(environments, eq(deployments.environmentId, environments.id))
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .where(eq(deployments.status, "ACTIVE"));

    return rows.map((r) => ({ ...r.deployment, project: r.project }));
  }

  async findAll(): Promise<(DeploymentSelect & { projectId: string; projectName?: string; jobId?: string | null })[]> {
    const db = getDb();
    const rows = await db
      .select({
        deployment: deployments,
        projectId: environments.projectId,
        projectName: projects.name,
        jobId: jobs.id,
      })
      .from(deployments)
      .innerJoin(environments, eq(deployments.environmentId, environments.id))
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .leftJoin(jobs, eq(deployments.id, jobs.deploymentId))
      .orderBy(desc(deployments.createdAt));

    return rows.map((r) => ({
      ...r.deployment,
      projectId: r.projectId,
      projectName: r.projectName,
      jobId: r.jobId ?? null,
    }));
  }

  async updateStatus(
    id: string,
    status: DeploymentStatusType,
    errorMessage?: string
  ): Promise<DeploymentSelect> {
    const db = getDb();
    const [updated] = await db
      .update(deployments)
      .set({
        status,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, id))
      .returning();

    return updated;
  }
}
