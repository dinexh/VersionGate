import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/badges/StatusBadge";
import { EnvironmentEnvModal } from "@/components/modals/EnvironmentEnvModal";
import {
  promoteEnvironment,
  type EnvironmentSummary,
} from "@/lib/api";
import { publicEnvironmentUrl, publicServiceUrl } from "@/lib/deployment-display";

function ChainArrow() {
  return (
    <div className="flex shrink-0 items-center justify-center text-muted-foreground/60" aria-hidden>
      <svg width="28" height="24" viewBox="0 0 28 24" className="hidden sm:block">
        <path
          d="M4 12h16m-4-4 4 4-4 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sm:hidden text-lg leading-none">↓</span>
    </div>
  );
}

export interface EnvironmentChainProps {
  projectId: string;
  projectName?: string;
  environments: EnvironmentSummary[];
  onRefresh: () => Promise<void>;
  /** Deploy/build for the leftmost environment in the chain (not always named “development”). */
  onDeployToEnvironment: (environmentId: string) => Promise<void>;
}

export function EnvironmentChain({
  projectId,
  projectName,
  environments,
  onRefresh,
  onDeployToEnvironment,
}: EnvironmentChainProps) {
  const navigate = useNavigate();
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [selectedEnvForVars, setSelectedEnvForVars] = useState<EnvironmentSummary | null>(null);

  const sorted = [...environments].sort((a, b) => a.chainOrder - b.chainOrder);

  const onPromote = async (targetEnvId: string, sourceEnvId: string) => {
    setPromotingId(targetEnvId);
    try {
      const r = await promoteEnvironment(projectId, targetEnvId, sourceEnvId);
      toast.success(`Promotion queued — job ${r.jobId.slice(0, 8)}…`);
      await onRefresh();
      navigate(`/projects/${projectId}/deploy/${r.jobId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Promotion failed");
    } finally {
      setPromotingId(null);
    }
  };

  if (sorted.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <EnvironmentEnvModal
        projectId={projectId}
        environment={selectedEnvForVars}
        open={Boolean(selectedEnvForVars)}
        onOpenChange={(open) => {
          if (!open) setSelectedEnvForVars(null);
        }}
        onRefresh={onRefresh}
      />

      <p className="text-xs text-muted-foreground">
        Deploy builds once on the first stage. Promote copies that image forward (no rebuild).
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
        {sorted.map((env, index) => {
          const upstream = index > 0 ? sorted[index - 1] : null;
          const upstreamActive = upstream?.activeDeployment?.status === "ACTIVE";
          const active = env.activeDeployment;
          const showPromote = index > 0;
          const promoteDisabled = !upstreamActive || promotingId !== null;
          const openUrl =
            active?.status === "ACTIVE" || active?.status === "DEPLOYING"
              ? publicEnvironmentUrl(
                  projectName ? { name: projectName, basePort: 0 } : undefined,
                  env.name,
                  active.port
                )
              : null;
          const directPortUrl = active ? publicServiceUrl(active.port) : null;
          const hasCustomEnv = env.env && Object.keys(env.env).length > 0;

          return (
            <div key={env.id} className="flex flex-1 min-w-[200px] flex-col gap-3 sm:flex-row sm:items-stretch">
              {index > 0 ? <ChainArrow /> : null}
              <Card className="flex-1 border-border bg-card">
                <CardHeader className="border-b border-border pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="font-mono text-xs uppercase tracking-wider">{env.name}</CardTitle>
                    {active ? <StatusBadge status={active.status} /> : <StatusBadge status="PENDING" />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  {active ? (
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-foreground font-semibold">v{active.version}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">Port {active.port}</span>
                      </div>
                      {openUrl ? (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div className="flex items-center gap-1.5">
                            <a
                              href={openUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                              title={`Stage Path URL: ${openUrl}`}
                            >
                              <span>Preview {env.name}</span>
                              <span className="text-[10px]" aria-hidden>↗</span>
                            </a>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                void navigator.clipboard.writeText(openUrl);
                                toast.success(`Copied ${env.name} preview URL`);
                              }}
                              title="Copy preview URL"
                            >
                              Copy URL
                            </Button>
                          </div>
                          {directPortUrl && directPortUrl !== openUrl ? (
                            <a
                              href={directPortUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate font-mono text-[10px] text-muted-foreground/70 hover:text-foreground"
                              title={`Direct Port URL: ${directPortUrl}`}
                            >
                              Direct Port (:{active.port}) ↗
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No deployment yet.</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {index === 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void onDeployToEnvironment(env.id)}
                      >
                        Deploy
                      </Button>
                    ) : null}
                    {showPromote ? (
                      <Button
                        size="sm"
                        disabled={promoteDisabled}
                        onClick={() => upstream && void onPromote(env.id, upstream.id)}
                        title={
                          !upstreamActive
                            ? `Need an ACTIVE deploy on ${upstream?.name ?? "upstream"} first`
                            : `Promote ${upstream?.name} → ${env.name}`
                        }
                      >
                        {promotingId === env.id ? (
                          <>
                            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                            Promoting…
                          </>
                        ) : (
                          `→ ${env.name}`
                        )}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs border-border/80"
                      onClick={() => setSelectedEnvForVars(env)}
                      title={`Configure environment variables for ${env.name}`}
                    >
                      Env {hasCustomEnv ? `(${Object.keys(env.env!).length})` : ""}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
