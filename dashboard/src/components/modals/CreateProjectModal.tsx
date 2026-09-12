import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  createProject,
  detectRepoStack,
  getGithubInstallation,
  getGithubRepoBranches,
  type GithubInstallationSummary,
  type GithubRepoRow,
  type RepoStackDetection,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GithubRepoPicker } from "@/components/GithubRepoPicker";
import { cn } from "@/lib/utils";

const NAME_PATTERN = /^[a-z0-9-]+$/;

const ROOT_PRESETS = [
  { label: "Repository root", value: "." },
  { label: "apps/web", value: "apps/web" },
  { label: "frontend", value: "frontend" },
  { label: "packages/app", value: "packages/app" },
] as const;

const selectClass = cn(
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
);

export function CreateProjectModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [buildContext, setBuildContext] = useState(".");
  const [appPort, setAppPort] = useState("3000");
  const [healthPath, setHealthPath] = useState("/health");

  const [ghLoading, setGhLoading] = useState(false);
  const [ghConnected, setGhConnected] = useState(false);
  const [ghInstallations, setGhInstallations] = useState<GithubInstallationSummary[]>([]);
  const [selectedInstallationId, setSelectedInstallationId] = useState<string | null>(null);
  const [ghSource, setGhSource] = useState<"github" | "manual">("manual");
  const [selectedGithubRepo, setSelectedGithubRepo] = useState<GithubRepoRow | null>(null);
  const [branchNames, setBranchNames] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [stackDetecting, setStackDetecting] = useState(false);
  const [detectedStack, setDetectedStack] = useState<RepoStackDetection | null>(null);

  const reset = () => {
    setName("");
    setRepoUrl("");
    setBranch("main");
    setBuildContext(".");
    setAppPort("3000");
    setHealthPath("/health");
    setGhLoading(false);
    setGhConnected(false);
    setGhInstallations([]);
    setSelectedInstallationId(null);
    setGhSource("manual");
    setSelectedGithubRepo(null);
    setBranchNames([]);
    setBranchesLoading(false);
    setStackDetecting(false);
    setDetectedStack(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGhLoading(true);
    void getGithubInstallation()
      .then((r) => {
        if (cancelled) return;
        const connected = r.installation !== null;
        setGhConnected(connected);
        setGhInstallations(r.installations);
        const id =
          r.installation?.installationId ?? r.installations[0]?.installationId ?? null;
        setSelectedInstallationId(id);
        setGhSource(connected ? "github" : "manual");
      })
      .catch(() => {
        if (!cancelled) {
          setGhConnected(false);
          setGhInstallations([]);
          setGhSource("manual");
        }
      })
      .finally(() => {
        if (!cancelled) setGhLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleRepoPick = (r: GithubRepoRow) => {
    setSelectedGithubRepo(r);
    setRepoUrl(r.cloneUrl);
    const defaultB = r.defaultBranch?.trim() || "main";
    setBranch(defaultB);
    setBranchNames([]);
    const cleanName = r.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    setName(cleanName);

    if (cleanName.includes("website")) {
      setBuildContext("website");
    } else if (cleanName.includes("dashboard")) {
      setBuildContext("dashboard");
    } else if (cleanName.includes("frontend") || cleanName.includes("web")) {
      setBuildContext("frontend");
    } else {
      setBuildContext(".");
    }
  };

  useEffect(() => {
    if (!selectedGithubRepo || !selectedInstallationId) return;
    const slash = selectedGithubRepo.fullName.indexOf("/");
    const owner = slash >= 0 ? selectedGithubRepo.fullName.slice(0, slash) : "";
    const repoName = slash >= 0 ? selectedGithubRepo.fullName.slice(slash + 1) : "";
    if (!owner || !repoName) return;

    setBranchesLoading(true);
    void getGithubRepoBranches(owner, repoName, selectedInstallationId)
      .then((res) => {
        const names = res.branches.map((b) => b.name);
        setBranchNames(names);
        const preferred = selectedGithubRepo.defaultBranch?.trim() || "main";
        if (names.includes(preferred)) {
          setBranch(preferred);
        } else if (names[0]) {
          setBranch(names[0]);
        }
      })
      .catch((e: unknown) => {
        setBranchNames([]);
        const msg = e instanceof ApiError ? e.message : "Could not list branches.";
        toast.error(msg);
      })
      .finally(() => setBranchesLoading(false));
  }, [selectedInstallationId, selectedGithubRepo]);

  useEffect(() => {
    let active = true;
    let owner = "";
    let repoName = "";

    if (selectedGithubRepo) {
      const slash = selectedGithubRepo.fullName.indexOf("/");
      owner = slash >= 0 ? selectedGithubRepo.fullName.slice(0, slash) : "";
      repoName = slash >= 0 ? selectedGithubRepo.fullName.slice(slash + 1) : "";
    } else if (repoUrl.trim()) {
      const match = repoUrl.trim().match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
      if (match) {
        owner = match[1];
        repoName = match[2];
      }
    }

    if (!owner || !repoName) {
      setDetectedStack(null);
      setStackDetecting(false);
      return;
    }

    setStackDetecting(true);
    void detectRepoStack(owner, repoName, branch || undefined, selectedInstallationId || undefined)
      .then((res) => {
        if (!active) return;
        if (res && res.detected) {
          setDetectedStack(res);
          setAppPort(String(res.recommendedPort));
          setHealthPath(res.recommendedHealthPath);
          if (res.recommendedBuildContext && res.recommendedBuildContext !== ".") {
            setBuildContext(res.recommendedBuildContext);
          }
        } else {
          setDetectedStack(null);
        }
      })
      .catch(() => {
        if (active) setDetectedStack(null);
      })
      .finally(() => {
        if (active) setStackDetecting(false);
      });

    return () => {
      active = false;
    };
  }, [selectedGithubRepo, branch, repoUrl, selectedInstallationId]);

  const contextPresets = useMemo(() => {
    const list: { label: string; value: string }[] = [...ROOT_PRESETS];
    if (detectedStack?.suggestions) {
      for (const s of detectedStack.suggestions) {
        if (!list.some((existing) => existing.value === s.value)) {
          list.push(s);
        }
      }
    }
    return list;
  }, [detectedStack]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().toLowerCase();
    if (!NAME_PATTERN.test(trimmed)) {
      toast.error("Name must be lowercase letters, numbers, and hyphens only (e.g. my-app).");
      return;
    }
    if (ghSource === "github" && ghConnected && !repoUrl.trim()) {
      toast.error("Select a GitHub repository or switch to manual URL.");
      return;
    }
    if (ghSource === "manual" && !repoUrl.trim()) {
      toast.error("Enter a Git repository URL.");
      return;
    }
    const port = Number.parseInt(appPort, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      toast.error("App port must be between 1 and 65535.");
      return;
    }
    setSubmitting(true);
    try {
      const { project } = await createProject({
        name: trimmed,
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || "main",
        buildContext: buildContext.trim() || ".",
        appPort: port,
        healthPath: healthPath.trim() || "/health",
      });
      toast.success("Project created");
      handleOpenChange(false);
      onCreated?.();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setSubmitting(false);
    }
  };

  const manualRepoFields = (
    <>
      <div className="grid gap-1.5">
        <label htmlFor="cp-repo" className="text-sm font-medium">
          Git repository URL
        </label>
        <Input
          id="cp-repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/org/repo.git"
          autoComplete="off"
          required={ghSource === "manual"}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="cp-branch-manual" className="text-sm font-medium">
          Default branch
        </label>
        <Input
          id="cp-branch-manual"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
        />
      </div>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create new project</DialogTitle>
          <DialogDescription>
            Point at your Git repository and the app directory (similar to a &quot;root directory&quot; in other
            platforms). Host ports for blue and green are assigned automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
          <div
            className="flex gap-3 border border-border bg-muted p-3 text-sm leading-relaxed text-muted-foreground"
            role="note"
          >
            <span className="mt-0.5 font-sans text-xs font-semibold text-sky-400 shrink-0">Info</span>
            <p>
              Each project gets two fixed host ports. New deploys build into the idle slot; after health checks pass,
              traffic can switch with no downtime.
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="cp-name" className="text-sm font-medium">
              Project name (slug)
            </label>
            <Input
              id="cp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. core-api-service"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens only.</p>
          </div>

          {ghLoading ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              Checking GitHub connection…
            </div>
          ) : ghConnected ? (
            <Tabs
              value={ghSource}
              onValueChange={(v) => {
                setGhSource(v as "github" | "manual");
                if (v === "manual") {
                  setSelectedGithubRepo(null);
                  setBranchNames([]);
                }
              }}
            >
              <TabsList variant="line" className="w-full justify-start">
                <TabsTrigger value="github">From GitHub</TabsTrigger>
                <TabsTrigger value="manual">Manual URL</TabsTrigger>
              </TabsList>
              <TabsContent value="github" className="mt-4 grid gap-4">
                {ghInstallations.length > 1 ? (
                  <div className="grid gap-1.5">
                    <label htmlFor="cp-gh-install" className="text-sm font-medium">
                      GitHub installation
                    </label>
                    <select
                      id="cp-gh-install"
                      className={selectClass}
                      value={selectedInstallationId ?? ""}
                      onChange={(e) => {
                        setSelectedInstallationId(e.target.value || null);
                        setSelectedGithubRepo(null);
                        setRepoUrl("");
                        setBranchNames([]);
                      }}
                    >
                      {ghInstallations.map((i) => (
                        <option key={i.installationId} value={i.installationId}>
                          {i.githubAccountLogin} ({i.githubAccountType})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">Organization or account this project&apos;s repos belong to.</p>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Repository</span>
                  <GithubRepoPicker
                    installationId={selectedInstallationId}
                    selectedFullName={selectedGithubRepo?.fullName ?? null}
                    onRepoSelect={handleRepoPick}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="cp-branch-gh" className="text-sm font-medium">
                    Branch
                  </label>
                  {branchesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading branches…</p>
                  ) : branchNames.length > 0 ? (
                    <select
                      id="cp-branch-gh"
                      className={selectClass}
                      value={branchNames.includes(branch) ? branch : branchNames[0]}
                      onChange={(e) => setBranch(e.target.value)}
                    >
                      {branchNames.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="cp-branch-gh"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder={selectedGithubRepo ? "main" : "Select a repository first"}
                      disabled={!selectedGithubRepo}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Production environment tracks this branch for deploys and webhooks.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="manual" className="mt-4 grid gap-4">
                {manualRepoFields}
              </TabsContent>
            </Tabs>
          ) : (
            <>
              <Alert>
                <AlertTitle>Connect GitHub</AlertTitle>
                <AlertDescription>
                  Install the VersionGate GitHub App to browse repositories here. You can still paste a repository URL
                  below.&nbsp;
                  <Link to="/dashboard/integrations" className="font-medium text-foreground underline-offset-2 hover:underline">
                    Open Integrations
                  </Link>
                </AlertDescription>
              </Alert>
              {manualRepoFields}
            </>
          )}

          {stackDetecting ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground font-mono">
              <span className="text-sky-400 font-semibold">[ 01 // DETECTING STACK ]</span>
              <span>Scanning repository structure and dependencies…</span>
            </div>
          ) : detectedStack ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-semibold text-emerald-400 border border-emerald-800/60 bg-emerald-950/40 px-1.5 py-0.5 rounded">
                  [ STACK: {detectedStack.label.toUpperCase()} ]
                </span>
                <span className="text-muted-foreground">
                  Configured port {detectedStack.recommendedPort} // health {detectedStack.recommendedHealthPath}
                </span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground uppercase">{detectedStack.confidence} confidence</span>
            </div>
          ) : null}

          <div className="grid gap-2">
            <label htmlFor="cp-ctx" className="text-sm font-medium">
              Build context path
            </label>
            <p className="text-xs text-muted-foreground">Subdirectory containing the Dockerfile or build manifest.</p>
            <div className="flex flex-wrap gap-2">
              {contextPresets.map((p) => (
                <Button
                  key={p.value}
                  type="button"
                  size="sm"
                  variant={buildContext === p.value ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => setBuildContext(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Input
              id="cp-ctx"
              value={buildContext}
              onChange={(e) => setBuildContext(e.target.value)}
              placeholder="."
              className="font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="cp-port" className="text-sm font-medium">
                Application port
              </label>
              <Input
                id="cp-port"
                inputMode="numeric"
                value={appPort}
                onChange={(e) => setAppPort(e.target.value)}
                placeholder="3000"
              />
              <p className="text-xs text-muted-foreground">EXPOSE / listen port inside the image.</p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="cp-health" className="text-sm font-medium">
                Health check path
              </label>
              <Input
                id="cp-health"
                value={healthPath}
                onChange={(e) => setHealthPath(e.target.value)}
                placeholder="/healthz"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Initialize project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
