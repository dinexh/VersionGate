import { useEffect, useMemo, useRef, useState } from "react";
import { DonutChart } from "@/components/charts/DonutChart";
import { DeleteProjectDialog } from "@/components/modals/DeleteProjectDialog";
import { EditProjectModal } from "@/components/modals/EditProjectModal";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getDeployments,
  getProject,
  getProjectAnalytics,
  getProjectEnvironments,
  listProjectDomains,
  listProjectJobs,
  rollback,
  triggerDeploy,
  type Deployment,
  type EnvironmentSummary,
  type JobRecord,
  type Project,
  type ProjectAnalytics,
  type ProjectDomain,
} from "@/lib/api";
import { EnvironmentChain } from "@/components/badges/EnvironmentChain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/badges/StatusBadge";
import { SlotBadge } from "@/components/badges/SlotBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { BlueGreenTrafficCard } from "@/components/BlueGreenTrafficCard";
import { getDeployingDeployment, publicProjectLiveUrl, publicServiceUrl } from "@/lib/deployment-display";
import { ProjectCustomDomainCard } from "@/components/ProjectCustomDomainCard";
import { AggregateJobLogStream } from "@/components/AggregateJobLogStream";
import { jobArtifactLabel, jobDurationLabel } from "@/lib/job-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function copyText(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed")
  );
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function notifyUser(title: string, options?: NotificationOptions) {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, options);
    } catch {
      // browser notification error ignored
    }
  }
}

export function ProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [environmentsError, setEnvironmentsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [customDomains, setCustomDomains] = useState<ProjectDomain[]>([]);
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const previousStatusMapRef = useRef<Map<string, string>>(new Map());

  const load = async (isSilent = false) => {
    if (!id) {
      setLoading(false);
      setProject(null);
      return;
    }
    if (!isSilent && !project) {
      setLoading(true);
    }
    setEnvironmentsError(null);
    try {
      const [p, d, j] = await Promise.all([
        getProject(id),
        getDeployments(id),
        listProjectJobs(id, { limit: 25 }),
      ]);
      setProject(p.project ?? null);
      setDeployments(d.deployments);
      setJobs(j.jobs);

      // Notification check on status transition for each deployment
      if (previousStatusMapRef.current.size > 0) {
        for (const dep of d.deployments) {
          const prev = previousStatusMapRef.current.get(dep.id);
          if (prev && prev !== dep.status) {
            const versionStr = `v${dep.version}`;
            const projName = p.project?.name ?? "Project";
            if (dep.status === "ACTIVE") {
              const msg = `[ OK ] ${projName} ${versionStr} is now LIVE`;
              toast.success(msg);
              notifyUser(msg, { body: `Deployment ${versionStr} succeeded on port ${dep.port}.` });
            } else if (dep.status === "FAILED") {
              const msg = `[ FAILED ] ${projName} ${versionStr} deployment failed`;
              toast.error(msg);
              notifyUser(msg, { body: dep.errorMessage || "Deployment build or health check failed." });
            } else if (dep.status === "ROLLED_BACK") {
              const msg = `[ ROLLBACK ] ${projName} rolled back ${versionStr}`;
              toast.info(msg);
              notifyUser(msg, { body: `Deployment ${versionStr} was rolled back.` });
            }
          }
        }
      }
      const nextStatusMap = new Map<string, string>();
      for (const dep of d.deployments) {
        nextStatusMap.set(dep.id, dep.status);
      }
      previousStatusMapRef.current = nextStatusMap;

      try {
        const envData = await getProjectEnvironments(id);
        setEnvironments(envData.environments ?? []);
        setEnvironmentsError(null);
      } catch (envEx) {
        setEnvironments([]);
        setEnvironmentsError(envEx instanceof Error ? envEx.message : "Failed to load environments");
      }

      try {
        const domainData = await listProjectDomains(id);
        setCustomDomains(domainData.domains ?? []);
      } catch {
        setCustomDomains([]);
      }

      try {
        const analyticsData = await getProjectAnalytics(id);
        setAnalytics(analyticsData.analytics);
      } catch {
        // Analytics load failure is non-blocking
      }
    } catch (e) {
      if (!isSilent) {
        toast.error(e instanceof Error ? e.message : "Failed to load project");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    const idTimer = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(idTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load only when project id changes
  }, [id]);

  const deploymentPie = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deployments) {
      m.set(d.status, (m.get(d.status) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [deployments]);

  const jobsByStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      m.set(j.status, (m.get(j.status) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [jobs]);

  const prodChainOrder = useMemo(() => {
    if (environments.length === 0) return null;
    return Math.max(...environments.map((e) => e.chainOrder));
  }, [environments]);

  const prodEnvId = useMemo(() => {
    if (prodChainOrder == null) return null;
    return environments.find((e) => e.chainOrder === prodChainOrder)?.id ?? null;
  }, [environments, prodChainOrder]);

  const environmentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of environments) {
      m.set(e.id, e.name);
    }
    return m;
  }, [environments]);

  const productionDeployments = useMemo(() => {
    if (!prodEnvId) return deployments;
    return deployments.filter((d) => d.environmentId === prodEnvId || d.environmentId === undefined);
  }, [deployments, prodEnvId]);

  const onDeploy = async () => {
    if (!id) return;
    try {
      const r = await triggerDeploy(id);
      toast.success(`Deploy queued (production) — job ${r.jobId.slice(0, 8)}…`);
      navigate(`/projects/${id}/deploy/${r.jobId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deploy failed");
    }
  };

  const onRollback = async () => {
    if (!id) return;
    try {
      const r = await rollback(id);
      toast.success(`Rollback queued — job ${r.jobId.slice(0, 8)}…`);
      navigate(`/projects/${id}/deploy/${r.jobId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rollback failed");
    }
  };

  const onDeployToEnvironment = async (environmentId: string) => {
    if (!id) return;
    const label =
      environments.find((e) => e.id === environmentId)?.name ?? environmentId.slice(0, 8);
    try {
      const r = await triggerDeploy(id, environmentId);
      toast.success(`Deploy queued — ${label} — job ${r.jobId.slice(0, 8)}…`);
      navigate(`/projects/${id}/deploy/${r.jobId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deploy failed");
    }
  };

  if (loading) {
    return (
      <div className="w-full space-y-6">
        <Skeleton className="h-24 " />
        <Skeleton className="h-48 " />
        <Skeleton className="h-72 " />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="w-full space-y-4">
        <p className="text-sm text-muted-foreground">This project could not be loaded. It may have been removed or the response was invalid.</p>
        <Link
          to="/"
          className="inline-flex min-w-[2.25rem] items-center justify-center rounded-lg border border-border/50 bg-card/60 px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Back to overview
        </Link>
      </div>
    );
  }

  const active = productionDeployments.find((d) => d.status === "ACTIVE");
  const deploying = id ? getDeployingDeployment(id, productionDeployments) : undefined;
  const displayStatus = deploying
    ? "DEPLOYING"
    : active
      ? "ACTIVE"
      : productionDeployments[0]?.status === "FAILED"
        ? "FAILED"
        : productionDeployments[0]?.status === "ROLLED_BACK"
          ? "ROLLED_BACK"
          : "PENDING";

  const liveHostPort = active ? active.port : project.basePort;
  const liveUrl = publicProjectLiveUrl(project, customDomains, active?.port);
  const repoHref = /^https?:\/\//i.test(project.repoUrl)
    ? project.repoUrl
    : `https://${project.repoUrl}`;
  const totalDeploys = productionDeployments.length;

  return (
    <div className="w-full space-y-8 font-sans">
      {/* Project Workspace Header Bar */}
      <div className="flex flex-col gap-4 border-b border-neutral-800 pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
            <span className="rounded bg-neutral-900 px-2 py-0.5 font-sans font-medium text-neutral-300">Project</span>
            <span>·</span>
            <span>ID: {project.id.slice(0, 8)}</span>
            <span>·</span>
            <span>Branch: {project.branch}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl font-sans">{project.name}</h1>
            {active ? (
              <Badge variant="outline" className="border-neutral-800 bg-neutral-900 font-mono text-[10px] text-neutral-300">
                v{active.version}
              </Badge>
            ) : null}
            <StatusBadge status={displayStatus} />
          </div>
          <a
            href={repoHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <span>{project.repoUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveUrl ? (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: "default", size: "sm" }),
                "gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold font-sans text-xs"
              )}
            >
              Visit App
              <span className="font-mono text-[10px] opacity-80">(:{liveHostPort})</span>
            </a>
          ) : null}
          <Button variant="outline" size="sm" className="border-rose-900/50 text-rose-400 hover:bg-rose-950/40 text-xs font-sans" onClick={() => void onRollback()}>
            Rollback
          </Button>
          <Button variant="outline" size="sm" className="border-neutral-700 text-neutral-200 hover:bg-neutral-800 text-xs font-sans" onClick={() => void onDeploy()}>
            Redeploy
          </Button>
          <Button size="sm" className="bg-white text-black font-semibold hover:bg-neutral-200 text-xs font-sans" onClick={() => void onDeploy()}>
            Deploy Production
          </Button>
          <Button variant="outline" size="sm" className="border-neutral-700 text-neutral-200 hover:bg-neutral-800 text-xs font-sans" onClick={() => setEditOpen(true)}>
            Edit Settings
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-neutral-400 hover:text-rose-400 text-xs font-sans" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6 min-w-0">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-mono text-sm uppercase tracking-wider">Environments</CardTitle>
          <CardDescription>
            Deploy on development, then promote to staging and production.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {environmentsError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <p className="font-medium text-destructive">Could not list environments</p>
              <p className="mt-1 text-muted-foreground">{environmentsError}</p>
              <Button className="mt-3" variant="outline" size="sm" type="button" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
          {!environmentsError && environments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No environments yet. Create a new project to get development → staging → production.
            </p>
          ) : null}
          {!environmentsError && environments.length === 1 && environments[0]?.name === "production" ? (
            <p className="text-xs text-muted-foreground">
              Only production exists on this project (legacy). New projects include the full chain.
            </p>
          ) : null}
          {!environmentsError && environments.length > 0 ? (
            <EnvironmentChain
              projectId={project.id}
              projectName={project.name}
              environments={environments}
              onRefresh={async () => {
                await load();
              }}
              onDeployToEnvironment={onDeployToEnvironment}
            />
          ) : null}
        </CardContent>
      </Card>

      {deployments.length > 0 || jobs.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Deployments by status</CardTitle>
              <CardDescription>Version history for this project.</CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart data={deploymentPie} emptyLabel="No deployments" />
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Jobs by status</CardTitle>
              <CardDescription>Recent runs (up to 25 loaded).</CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.length > 0 ? (
                <DonutChart data={jobsByStatus} emptyLabel="No jobs" />
              ) : (
                <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border/50 text-sm text-muted-foreground">
                  No jobs yet
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Project Traffic & Telemetry</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">Rolling 24h</span>
          </div>
          <CardDescription>Live traffic metrics and reverse proxy response distributions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Total Requests</span>
              <p className="mt-1 font-mono text-2xl font-bold text-foreground">{analytics?.totalHits ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-emerald-400">Success (2xx)</span>
              <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">{analytics?.status2xx ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-amber-400">Client Err (4xx)</span>
              <p className="mt-1 font-mono text-2xl font-bold text-amber-400">{analytics?.status4xx ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-rose-400">Server Err (5xx)</span>
              <p className="mt-1 font-mono text-2xl font-bold text-rose-400">{analytics?.status5xx ?? 0}</p>
            </div>
          </div>
          {analytics && analytics.avgLatencyMs > 0 ? (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Avg upstream proxy latency:</span>
              <span className="font-mono font-medium text-foreground">{analytics.avgLatencyMs} ms</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <BlueGreenTrafficCard
        project={project}
        deployments={productionDeployments}
        active={active}
        deploying={deploying}
        liveHostPort={liveHostPort}
        liveUrl={liveUrl}
        onCopy={copyText}
      />

      <ProjectCustomDomainCard
        projectId={project.id}
        liveUrl={liveUrl}
        onCopy={copyText}
        onUpdated={() => {
          void load(true);
        }}
      />

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Configuration</CardTitle>
          <Button variant="outline" size="sm" className="h-7 text-xs font-sans" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <span className="text-xs text-muted-foreground">Health path</span>
              <p className="mt-0.5 font-mono text-sm">
                <code className="rounded bg-muted/50 px-1.5 py-0.5">{project.healthPath}</code>
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Build context</span>
              <p className="mt-0.5 font-mono text-sm">
                <code className="rounded bg-muted/50 px-1.5 py-0.5">{project.buildContext}</code>
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Host port range</span>
              <p className="mt-0.5 font-mono text-sm">
                <code className="rounded bg-muted/50 px-1.5 py-0.5">
                  {project.basePort}–{project.basePort + 1}
                </code>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Deployment jobs</CardTitle>
          <CardDescription>Build and rollback runs with artifact hints and duration.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="pl-6">Job</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Artifact</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No jobs yet. Deploy to generate logs.
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => {
                  const dep = job.deploymentId ? deployments.find((d) => d.id === job.deploymentId) : undefined;
                  const envName =
                    dep?.environmentId != null ? environmentNameById.get(dep.environmentId) ?? "—" : "—";
                  return (
                    <TableRow key={job.id} className="border-border/40">
                      <TableCell className="pl-6 font-mono text-xs">#{job.id.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-sm">{job.type}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{envName}</TableCell>
                      <TableCell>
                        <Badge variant={job.status === "FAILED" ? "destructive" : "secondary"} className="font-mono text-xs">
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{jobArtifactLabel(job)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{jobDurationLabel(job)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 px-2" })}
                          >
                            ⋯
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => navigate(`/projects/${project.id}/deploy/${job.id}`)}>
                              View log
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void copyText(job.id, "Job id")}
                            >
                              Copy job id
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
          <CardDescription>Each row is one version. The host port is what you open in the browser for that color slot.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="pl-6">Ver</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Host port</TableHead>
                <TableHead>App port</TableHead>
                <TableHead>Container</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    No deployments yet. Run Deploy above.
                  </TableCell>
                </TableRow>
              ) : (
                deployments.map((d) => {
                  const hp = d.port;
                  const u = publicServiceUrl(hp);
                  const matchedJobId = d.jobId ?? jobs.find((j) => j.deploymentId === d.id)?.id;
                  return (
                    <TableRow key={d.id} className="border-border/40">
                      <TableCell className="pl-6 font-mono">v{d.version}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.environmentId ? environmentNameById.get(d.environmentId) ?? "—" : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={d.status} />
                          {d.errorMessage ? (
                            <span className="max-w-[200px] truncate text-xs text-red-700" title={d.errorMessage ?? ""}>
                              {d.errorMessage}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <SlotBadge color={d.color} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <a href={u} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          {hp}
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">{project.appPort}</TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">{d.containerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{timeAgo(d.createdAt)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 px-2" })}
                          >
                            ⋯
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {matchedJobId ? (
                              <DropdownMenuItem onSelect={() => navigate(`/projects/${project.id}/deploy/${matchedJobId}`)}>
                                View logs
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onSelect={() => {
                                if (d.environmentId) {
                                  void onDeployToEnvironment(d.environmentId);
                                } else {
                                  void onDeploy();
                                }
                              }}
                            >
                              Redeploy
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void copyText(d.containerName, "Container name")}
                            >
                              Copy container
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Live Deployment Log</h2>
        <AggregateJobLogStream title="Recent jobs on this instance" pollMs={8000} />
      </section>
        </div>

        <aside className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Project resources</CardTitle>
              <CardDescription className="text-sm">Quick reference for this deployment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Live URL</p>
                {liveUrl ? (
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 block break-all font-mono text-sm text-primary hover:underline"
                  >
                    {liveUrl.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="mt-1.5 block text-muted-foreground">Not deployed</span>
                )}
                {customDomains[0] ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Custom domain attached. Manage in the section above.
                  </p>
                ) : (
                  <a href="#custom-domain" className="mt-2 inline-block text-xs text-primary hover:underline">
                    Add a custom domain
                  </a>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">App port</p>
                <p className="mt-1.5 font-mono tabular-nums">{project.appPort}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Host ports</p>
                <p className="mt-1.5 font-mono tabular-nums">
                  {project.basePort}–{project.basePort + 1}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch</p>
                <p className="mt-1.5">{project.branch}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Health path</p>
                <p className="mt-1.5 font-mono">{project.healthPath}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Env vars</p>
                <p className="mt-1.5 text-muted-foreground">Encrypted at rest</p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="hidden gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Total deploys</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">{totalDeploys}</p>
          </CardContent>
        </Card>
      </div>

      <EditProjectModal
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        onUpdated={() => {
          void load(false);
        }}
      />

      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={project.id}
        projectName={project.name}
        navigateTo="/"
      />

      <Link to="/" className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}>
        Back to overview
      </Link>
    </div>
  );
}
