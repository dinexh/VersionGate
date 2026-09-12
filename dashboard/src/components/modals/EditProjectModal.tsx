import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
import { triggerDeploy, updateProject, type Project } from "@/lib/api";

export function EditProjectModal({
  open,
  onOpenChange,
  project,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onUpdated?: () => void;
}) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [repoUrl, setRepoUrl] = useState(project.repoUrl);
  const [branch, setBranch] = useState(project.branch);
  const [buildContext, setBuildContext] = useState(project.buildContext);
  const [appPort, setAppPort] = useState(String(project.appPort));
  const [healthPath, setHealthPath] = useState(project.healthPath);
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    if (open) {
      setRepoUrl(project.repoUrl);
      setBranch(project.branch);
      setBuildContext(project.buildContext);
      setAppPort(String(project.appPort));
      setHealthPath(project.healthPath);
      const rawEnv = project.env || {};
      const pairs = Object.entries(rawEnv).map(([k, v]) => ({ key: k, value: String(v) }));
      setEnvPairs(pairs.length > 0 ? pairs : [{ key: "", value: "" }]);
    }
  }, [open, project]);

  const addEnvPair = () => {
    setEnvPairs((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeEnvPair = (idx: number) => {
    setEnvPairs((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateEnvPair = (idx: number, field: "key" | "value", val: string) => {
    setEnvPairs((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item))
    );
  };

  const saveProjectSettings = async (): Promise<boolean> => {
    const port = Number.parseInt(appPort, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      toast.error("App port must be between 1 and 65535.");
      return false;
    }

    const envMap: Record<string, string> = {};
    for (const p of envPairs) {
      const k = p.key.trim();
      if (k) {
        envMap[k] = p.value;
      }
    }

    await updateProject(project.id, {
      repoUrl: repoUrl.trim(),
      branch: branch.trim() || "main",
      buildContext: buildContext.trim() || ".",
      appPort: port,
      healthPath: healthPath.trim() || "/health",
      env: envMap,
    });
    return true;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await saveProjectSettings();
      if (!ok) return;
      toast.success("[ OK ] Project configuration updated");
      onOpenChange(false);
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setSubmitting(false);
    }
  };

  const onSaveAndRedeploy = async () => {
    setRedeploying(true);
    try {
      const ok = await saveProjectSettings();
      if (!ok) return;
      toast.success("[ OK ] Settings saved. Triggering redeployment…");
      const r = await triggerDeploy(project.id);
      toast.success(`Redeployment queued — job ${r.jobId.slice(0, 8)}…`);
      onOpenChange(false);
      onUpdated?.();
      navigate(`/projects/${project.id}/deploy/${r.jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save and redeploy");
    } finally {
      setRedeploying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl font-sans">
        <DialogHeader>
          <DialogTitle>Edit Project Settings</DialogTitle>
          <DialogDescription>
            Update Git repository, deployment paths, container port, and project-level environment variables.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="ep-repo" className="text-sm font-medium">
              Git Repository URL
            </label>
            <Input
              id="ep-repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="ep-branch" className="text-sm font-medium">
                Production Branch
              </label>
              <Input
                id="ep-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="ep-context" className="text-sm font-medium">
                Build Context Subdirectory
              </label>
              <Input
                id="ep-context"
                value={buildContext}
                onChange={(e) => setBuildContext(e.target.value)}
                placeholder="."
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="ep-port" className="text-sm font-medium">
                Container Internal Port
              </label>
              <Input
                id="ep-port"
                type="number"
                min={1}
                max={65535}
                value={appPort}
                onChange={(e) => setAppPort(e.target.value)}
                placeholder="3000"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="ep-health" className="text-sm font-medium">
                Health Check Path
              </label>
              <Input
                id="ep-health"
                value={healthPath}
                onChange={(e) => setHealthPath(e.target.value)}
                placeholder="/health"
                required
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Project Environment Variables</label>
              <Button type="button" variant="outline" size="sm" onClick={addEnvPair} className="text-xs">
                + Add Variable
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Encrypted at rest with AES-256-GCM. Applied to all deployments unless overridden by environment stages.
            </p>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {envPairs.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={p.key}
                    onChange={(e) => updateEnvPair(idx, "key", e.target.value)}
                    className="font-mono text-xs uppercase"
                  />
                  <Input
                    placeholder="VALUE"
                    value={p.value}
                    onChange={(e) => updateEnvPair(idx, "value", e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEnvPair(idx)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-500"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting || redeploying}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={submitting || redeploying}
            >
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
            <Button
              type="button"
              onClick={() => void onSaveAndRedeploy()}
              disabled={submitting || redeploying}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {redeploying ? "Deploying…" : "Save & Redeploy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
