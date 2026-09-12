import { useCallback, useEffect, useMemo, useState } from "react";
import { DonutChart } from "@/components/charts/DonutChart";
import { ActivityLineChart, type ActivityDayPoint } from "@/components/charts/ActivityLineChart";
import { Link } from "react-router-dom";
import { listAllJobs, getAllDeployments, type JobRecord, type Deployment } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AggregateJobLogStream } from "@/components/AggregateJobLogStream";
import { jobArtifactLabel } from "@/lib/job-display";
import { cn } from "@/lib/utils";

const POLL_MS = 8000;

function buildLast7DayBuckets(jobs: JobRecord[]): ActivityDayPoint[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const keys: string[] = [];
  const labelByKey = new Map<string, string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    keys.push(key);
    labelByKey.set(
      key,
      d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    );
  }
  const counts = new Map<string, ActivityDayPoint>();
  for (const key of keys) {
    counts.set(key, { day: labelByKey.get(key) ?? key, deploy: 0, rollback: 0, other: 0 });
  }
  for (const j of jobs) {
    const key = j.createdAt.slice(0, 10);
    const row = counts.get(key);
    if (!row) continue;
    const t = j.type.toUpperCase();
    if (t.includes("ROLLBACK")) row.rollback += 1;
    else if (t.includes("DEPLOY") || t.includes("PROMOTE")) row.deploy += 1;
    else row.other += 1;
  }
  return keys.map((k) => counts.get(k)!);
}

function exportJobsCsv(jobs: JobRecord[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ["createdAt", "projectId", "projectName", "type", "status", "artifactHint", "error"];
  const lines = [header.join(",")];
  for (const j of jobs) {
    lines.push(
      [
        esc(j.createdAt),
        esc(j.projectId),
        esc(j.project?.name ?? ""),
        esc(j.type),
        esc(j.status),
        esc(jobArtifactLabel(j)),
        esc(j.error ?? ""),
      ].join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `versiongate-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Exported CSV");
}

export function Activity() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [activeTab, setActiveTab] = useState<"jobs" | "deployments">("jobs");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [chartMode, setChartMode] = useState<"all" | "deploy" | "rollback">("all");

  const load = useCallback(async () => {
    try {
      const [rJobs, rDeps] = await Promise.all([
        listAllJobs({ limit: 200 }),
        getAllDeployments().catch(() => ({ deployments: [] })),
      ]);
      setJobs(rJobs.jobs);
      setDeployments(rDeps.deployments);
      setTotal(rJobs.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const filteredJobs = useMemo(() => {
    if (statusFilter === "all") return jobs;
    return jobs.filter((j) => j.status === statusFilter);
  }, [jobs, statusFilter]);

  const badgeFor = (status: string) => {
    if (status === "FAILED" || status === "CANCELLED") return "destructive" as const;
    if (status === "COMPLETE") return "default" as const;
    return "secondary" as const;
  };

  const jobsByStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      m.set(j.status, (m.get(j.status) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [jobs]);

  const dayBuckets = useMemo(() => buildLast7DayBuckets(jobs), [jobs]);

  const peak = useMemo(() => {
    let max = 0;
    for (const d of dayBuckets) max = Math.max(max, d.deploy + d.rollback + d.other);
    return max;
  }, [dayBuckets]);

  const successRate = useMemo(() => {
    let ok = 0;
    let done = 0;
    for (const j of jobs) {
      if (j.status === "COMPLETE" || j.status === "FAILED" || j.status === "CANCELLED") {
        done++;
        if (j.status === "COMPLETE") ok++;
      }
    }
    if (done === 0) return null;
    return ((ok / done) * 100).toFixed(1);
  }, [jobs]);

  return (
    <div className="w-full space-y-8">
      <PageHeader
        title="Activity Log"
        description="Real-time deployment jobs across all projects"
                actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-card px-2 text-xs font-medium"
            >
              <option value="all">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="RUNNING">Running</option>
              <option value="COMPLETE">Complete</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => exportJobsCsv(filteredJobs)}>
              Export CSV
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        }
      />

      {!loading && jobs.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Jobs by status</CardTitle>
              <CardDescription>Sample up to 200 loaded jobs · {total} total in database</CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart data={jobsByStatus} />
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Jobs by type (7 days)</CardTitle>
                <CardDescription>
                  Peak volume: {peak} jobs/day · {successRate != null ? `Terminal success: ${successRate}%` : "No terminal jobs yet"}
                </CardDescription>
              </div>
              <div className="flex gap-1 rounded-lg border border-border/80 bg-muted/30 p-0.5">
                {(["all", "deploy", "rollback"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setChartMode(m)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                      chartMode === m ? "bg-card text-primary " : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {m === "all" ? "All" : m}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <ActivityLineChart data={dayBuckets} highlight={chartMode} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div>
        <div className="pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{activeTab === "jobs" ? "Jobs history" : "All Deployments"}</h2>
            <p className="text-sm text-muted-foreground">
              {activeTab === "jobs"
                ? "Open a row for streamed logs. Pending work requires versiongate-worker."
                : "Active and historical deployment records across all projects with version logs."}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border/80 bg-muted/30 p-0.5 self-start">
            <button
              type="button"
              onClick={() => setActiveTab("jobs")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                activeTab === "jobs" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Jobs ({jobs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("deployments")}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                activeTab === "deployments" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Deployments ({deployments.length})
            </button>
          </div>
        </div>

        <div className="pt-0 border-t border-border">
          {loading && (activeTab === "jobs" ? jobs.length === 0 : deployments.length === 0) ? (
            <div className="space-y-2 px-6 pb-6 pt-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : activeTab === "jobs" ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="pl-6">When</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Logs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-16 text-center text-muted-foreground">
                      No jobs match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredJobs.map((job) => (
                    <TableRow key={job.id} className="border-border/40">
                      <TableCell className="pl-6 text-sm text-muted-foreground relative">
                        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-full rounded-r-md ${job.status === "COMPLETE" ? "bg-emerald-500" : job.status === "FAILED" ? "bg-red-500" : "bg-amber-500"}`} />
                        {new Date(job.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link to={`/projects/${job.projectId}`} className="text-primary hover:underline">
                          {job.project?.name ?? "—"}
                        </Link>
                        <div className="font-text-xs text-muted-foreground">commit: {jobArtifactLabel(job)}</div>
                      </TableCell>
                      <TableCell className="font-text-sm">{job.type}</TableCell>
                      <TableCell>
                        <Badge variant={badgeFor(job.status)} className="font-text-xs">
                          {job.status}
                        </Badge>
                        {job.error ? (
                          <p className="mt-1 max-w-md truncate text-xs text-red-700" title={job.error}>
                            {job.error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Link
                          to={`/projects/${job.projectId}/deploy/${job.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          View log
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="pl-6">Version</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Container / Slot</TableHead>
                  <TableHead>Host Port</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="pr-6 text-right">Logs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">
                      No deployments recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  deployments.map((d) => (
                    <TableRow key={d.id} className="border-border/40">
                      <TableCell className="pl-6 font-mono text-sm font-medium">v{d.version}</TableCell>
                      <TableCell className="font-medium">
                        <Link to={`/projects/${d.projectId}`} className="text-primary hover:underline">
                          {d.projectName ?? d.projectId.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={d.status === "ACTIVE" ? "default" : d.status === "FAILED" ? "destructive" : "secondary"}
                          className="font-mono text-xs"
                        >
                          {d.status}
                        </Badge>
                        {d.errorMessage ? (
                          <p className="mt-1 max-w-xs truncate text-xs text-rose-400" title={d.errorMessage}>
                            {d.errorMessage}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {d.containerName} ({d.color})
                      </TableCell>
                      <TableCell className="font-mono text-sm">{d.port}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(d.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {d.jobId ? (
                          <Link
                            to={`/projects/${d.projectId}/deploy/${d.jobId}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            View log
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {!loading && (activeTab === "jobs" ? total > 0 : deployments.length > 0) ? (
            <p className="border-t border-border/40 px-6 py-3 text-xs text-muted-foreground">
              {activeTab === "jobs"
                ? `Showing ${filteredJobs.length} of ${total} jobs`
                : `Showing ${deployments.length} total deployments across all projects`}
            </p>
          ) : null}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Live system log stream</h2>
        <AggregateJobLogStream title="Aggregate job tail" pollMs={6000} />
      </section>
    </div>
  );
}
