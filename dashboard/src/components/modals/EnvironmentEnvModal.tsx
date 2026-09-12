import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { patchEnvironmentEnv, triggerDeploy, type EnvironmentSummary } from "@/lib/api";
import { toast } from "sonner";
import { handleEnvPaste } from "@/lib/env-parser";

interface EnvironmentEnvModalProps {
  projectId: string;
  environment: EnvironmentSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
}

export function EnvironmentEnvModal({
  projectId,
  environment,
  open,
  onOpenChange,
  onRefresh,
}: EnvironmentEnvModalProps) {
  const navigate = useNavigate();
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [redeploying, setRedeploying] = useState(false);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current && environment) {
      const entries = Object.entries(environment.env || {});
      setEnvPairs(entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
    }
    wasOpenRef.current = open;
  }, [open, environment]);

  if (!environment) return null;

  const handleAddPair = () => {
    setEnvPairs([...envPairs, { key: "", value: "" }]);
  };

  const handleRemovePair = (index: number) => {
    setEnvPairs(envPairs.filter((_, i) => i !== index));
  };

  const handlePairChange = (index: number, field: "key" | "value", val: string) => {
    const next = [...envPairs];
    next[index][field] = val;
    setEnvPairs(next);
  };

  const saveEnvVars = async (): Promise<boolean> => {
    const obj: Record<string, string> = {};
    for (const pair of envPairs) {
      const k = pair.key.trim();
      if (k) {
        obj[k] = pair.value;
      }
    }
    await patchEnvironmentEnv(projectId, environment.id, obj);
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveEnvVars();
      toast.success(`Environment variables updated for ${environment.name}`);
      await onRefresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save environment variables");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndRedeploy = async () => {
    setRedeploying(true);
    try {
      await saveEnvVars();
      toast.success(`[ OK ] Variables saved. Redeploying ${environment.name}…`);
      const r = await triggerDeploy(projectId, environment.id);
      toast.success(`Deploy queued — ${environment.name} — job ${r.jobId.slice(0, 8)}…`);
      await onRefresh();
      onOpenChange(false);
      navigate(`/projects/${projectId}/deploy/${r.jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save and redeploy");
    } finally {
      setRedeploying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wide">
            Stage Env Vars — {environment.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Environment variables set here will override global project defaults when deploying to the{" "}
            <span className="font-semibold text-foreground">{environment.name}</span> stage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 max-h-[300px] overflow-y-auto pr-1">
          {envPairs.map((pair, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                placeholder="KEY (e.g. NODE_ENV)"
                value={pair.key}
                onChange={(e) => handlePairChange(idx, "key", e.target.value)}
                onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                  const text = e.clipboardData.getData("text");
                  if (handleEnvPaste(text, idx, setEnvPairs)) {
                    e.preventDefault();
                  }
                }}
                className="font-mono text-xs uppercase"
              />
              <Input
                placeholder="VALUE (e.g. staging)"
                value={pair.value}
                onChange={(e) => handlePairChange(idx, "value", e.target.value)}
                onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                  const text = e.clipboardData.getData("text");
                  if (handleEnvPaste(text, idx, setEnvPairs)) {
                    e.preventDefault();
                  }
                }}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-destructive"
                onClick={() => handleRemovePair(idx)}
              >
                ✕
              </Button>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={handleAddPair} className="w-full text-xs">
            + Add Variable
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving || redeploying}>
            Cancel
          </Button>
          <Button variant="secondary" type="button" disabled={saving || redeploying} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save Variables"}
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            disabled={saving || redeploying}
            onClick={() => void handleSaveAndRedeploy()}
          >
            {redeploying ? "Deploying…" : "Save & Redeploy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
