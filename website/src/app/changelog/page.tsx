import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import Link from "next/link";

export const revalidate = 3600; // Revalidate dynamic releases every 1 hour (ISR)

export const metadata = {
  title: "Changelog // VersionGate",
  description: "Recent product updates, new features, and infrastructure improvements released in VersionGate.",
};

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  html_url: string;
  prerelease: boolean;
}

interface ReleaseItem {
  title: string;
  description: string;
  command?: string;
  prLink?: string;
  prNumber?: number;
}

interface ReleaseCategory {
  title: string;
  badge: "NEW" | "IMPROVEMENT" | "FIX";
  items: ReleaseItem[];
}

interface ProcessedRelease {
  version: string;
  date: string;
  isLatest?: boolean;
  summary: string;
  categories: ReleaseCategory[];
  url?: string;
}

const FALLBACK_RELEASES: ProcessedRelease[] = [
  {
    version: "v2.4.1",
    date: "September 12, 2026",
    isLatest: true,
    summary:
      "Reliable plain HTML & static site zero-downtime deployments: fixed Nginx Dockerfile generator syntax, added native /health route responses, clean URL routing, and index.htm support.",
    categories: [
      {
        title: "Deployment & Engine",
        badge: "FIX",
        items: [
          {
            title: "Static HTML Dockerfile generation fix",
            description:
              "Replaced invalid heredoc parsing with portable POSIX printf configuration generation for default.conf. Added dedicated /health endpoint returning 200 OK and clean URL fallbacks ($uri.html and /index.html).",
            command: "ensureDockerfile(buildContextDir, appPort)",
            prNumber: 189,
          },
          {
            title: "Support index.htm and index.html detection",
            description:
              "Auto-detects either index.html or index.htm at the repository root and subdirectories to generate the production Nginx container.",
          },
        ],
      },
    ],
  },
  {
    version: "v2.4.0",
    date: "September 5, 2026",
    isLatest: false,
    summary:
      "Production custom domains per project: isolated nginx upstream and server files, Certbot TLS per hostname, dashboard Live/Open links prefer the attached domain, and deploy traffic sync rewrites the app upstream after blue/green switches.",
    categories: [
      {
        title: "Networking",
        badge: "NEW",
        items: [
          {
            title: "Project custom domains API",
            description:
              "GET/POST /api/v1/projects/:id/domains, DELETE .../domains/:domainId, POST .../domains/:domainId/ssl. One production hostname per project; staging domains planned later.",
            command: 'POST /api/v1/projects/:id/domains  {"hostname":"app.example.com"}',
          },
          {
            title: "Isolated nginx layout",
            description:
              "vg-app-{project}.upstream.conf switches with ACTIVE production port; vg-app-{project}-{hostname}.conf stays Certbot-owned and separate from dashboard upstream.conf.",
          },
          {
            title: "Dashboard Live URL preference",
            description:
              "Project detail, Overview, and Projects list prefer https:// when sslStatus is issued, otherwise http:// on the custom hostname before falling back to /p/{project}/production.",
          },
        ],
      },
    ],
  },
  {
    version: "v2.3.1",
    date: "September 5, 2026",
    isLatest: false,
    summary:
      "Landing page, README, and capability grid rewritten against src/ — single-container scope stated up front, fictional versiongate CLI and dashboard-only cards removed, job log format aligned with deploy.handler.ts. Domain troubleshooting runbook added for hostname vs engine-health mismatches.",
    categories: [
      {
        title: "Documentation & Marketing Accuracy",
        badge: "IMPROVEMENT",
        items: [
          {
            title: "README and landing page scope correction",
            description:
              "Documents one Docker container per project per environment, no docker-compose, and auto-Dockerfile detection list (package.json, requirements.txt, go.mod, index.html).",
          },
          {
            title: "Capability grid engine-only entries",
            description:
              "Removed dashboard UI remodel cards; API routes and host scripts replace fictional versiongate CLI commands.",
          },
          {
            title: "Simulator and Q&A source-aligned snippets",
            description:
              "Job log lines match deploy.handler.ts and rollback.handler.ts; Q&A code excerpts reference traffic.service.ts, docker.ts, and auth routes.",
          },
          {
            title: "Domain troubleshooting runbook",
            description:
              "Docs for when PM2 and preflight say working but the hostname does not open: split-horizon DNS, hairpin NAT on Proxmox/NAT VPS, and the three nginx files (sites-available/versiongate, conf.d/versiongate.conf, upstream.conf).",
          },
        ],
      },
    ],
  },
  {
    version: "v2.3.0",
    date: "August 20, 2026",
    isLatest: false,
    summary: "Complete Vercel platform structural and layout overhaul featuring top scope bar with workspace switcher, horizontal sub-header navigation bar, 4-column telemetry hero matrix, and Grid vs Dense Table view modes.",
    categories: [
      {
        title: "Platform Navigation Architecture Overhaul",
        badge: "NEW",
        items: [
          {
            title: "Top Vercel Scope Bar & Horizontal Nav Sub-Bar",
            description: "Restructured top bar to include workspace switcher, ⌘K command trigger, system status pill, and horizontal navigation tabs.",
          },
          {
            title: "Telemetry Hero Matrix Grid",
            description: "Added 4-column hero telemetry matrix for Total Projects, Active Containers, Pipeline Status, and Cluster Health.",
          },
          {
            title: "Grid Cards & Dense Data Table View Switcher",
            description: "Added Grid vs Dense Table view mode toggling in Projects page for high-density cloud management.",
          },
        ],
      },
    ],
  },
  {
    version: "v2.2.0",
    date: "August 20, 2026",
    isLatest: false,
    summary: "Full platform visual remodel to Vercel Geist Obsidian design system featuring Geist Sans/Mono typography, pure #000000 obsidian dark canvas, translucent backdrop-blur sticky header, rounded-xl hairline panels, and solid white CTA buttons.",
    categories: [
      {
        title: "Aesthetics & Design System",
        badge: "NEW",
        items: [
          {
            title: "Vercel Geist Typography Integration",
            description: "Integrated Geist Sans Variable and Geist Mono Variable fonts across entire dashboard, header, login cards, and terminal viewers.",
          },
          {
            title: "Vercel Geist Obsidian Theme Tokens",
            description: "Configured #000000 obsidian canvas, #0a0a0a surface cards, #1f1f1f hairline borders, and glowing status micro-badges.",
          },
          {
            title: "UI Primitive & Card Overhaul",
            description: "Standardized Button, Card, Input, Badge, and StatCard components to Vercel Geist rounded-xl hairline panels and solid white CTAs.",
          },
        ],
      },
    ],
  },
  {
    version: "v2.1.0",
    date: "August 20, 2026",
    isLatest: false,
    summary: "CLI administrator password reset script, in-dashboard password updates under Settings -> Security, reorganized 5-tab Settings page, and fixed header navigation bar layout.",
    categories: [
      {
        title: "Administrator Credential Management",
        badge: "NEW",
        items: [
          {
            title: "Host CLI Password Reset Tools",
            description:
              "Added `bun run reset-password` script and `--reset` / `--force` flags to `create-admin` for direct credential updates on existing host user records.",
            command: "bun run reset-password admin@example.com 'NewPassword123!'",
          },
          {
            title: "In-Dashboard Password Updates & Settings Overhaul",
            description:
              "Added Change Password form under Settings -> Security and reorganized Settings into 5 fully populated tabs (General, Network, Security, Updates, Advanced).",
          },
        ],
      },
    ],
  },
  {
    version: "v2.0.0",
    date: "August 19, 2026",
    isLatest: false,
    summary: "Automated host Certbot and Nginx plugin installation in the one-command installer script, enhanced Let's Encrypt path resolution, and non-blocking diagnostic feedback for host setups.",
    categories: [
      {
        title: "Automated Host Certbot Installation",
        badge: "NEW",
        items: [
          {
            title: "Pre-packaged Host Certbot & Nginx Plugin",
            description:
              "Updated the 1-command installer script (install.sh) and host bootstrap scripts to automatically download and configure certbot and python3-certbot-nginx out of the box.",
            command: "curl -fsSL https://versiongate.tech/install.sh | sudo bash",
          },
          {
            title: "Enhanced Certbot Path Resolution & Diagnostics",
            description:
              "Added multi-path binary resolution (/usr/bin/certbot, /snap/bin/certbot, /usr/local/bin/certbot) and detailed error diagnostics for missing binaries and Cloudflare proxying.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.9.0",
    date: "August 15, 2026",
    isLatest: false,
    summary: "Asynchronous zero-downtime system self-updates with live log streaming modal, complete dashboard UI overhaul with silent SWR revalidation, and smart terminal scroll locking.",
    categories: [
      {
        title: "Zero-Downtime System Self-Updates",
        badge: "NEW",
        items: [
          {
            title: "Non-Blocking Background Update Pipeline",
            description:
              "System updates run asynchronously in the background with GET /api/v1/system/update/progress telemetry, eliminating HTTP timeouts and connection drops during builds.",
            command: "versiongate system update --async",
          },
          {
            title: "Interactive Live Progress Modal",
            description:
              "Replaced abrupt banners and page reload loops with an interactive live progress drawer showing real-time git fetch, bun install, schema sync, and build steps.",
          },
          {
            title: "Graceful Environment-Aware Reloading",
            description:
              "Automatically detects PM2 vs standalone / container runtimes, applying asset updates in-place without crashing or terminating live dev sessions.",
          },
        ],
      },
      {
        title: "Dashboard UI & Experience Redesign",
        badge: "IMPROVEMENT",
        items: [
          {
            title: "Zero-Flicker SWR Background Revalidation",
            description:
              "Cluster metrics and project states refresh silently in the background without full-screen skeleton flashing or layout jitter.",
          },
          {
            title: "Smart Terminal Scroll Lock",
            description:
              "DeployLog viewer automatically pins to the bottom during live streams while respecting user scroll intent, with a convenient Jump to Latest button.",
          },
          {
            title: "Precision Developer Typography & Clean Metrics",
            description:
              "Redesigned Overview and Project Detail screens with clean slot status indicators, verified container ports, and rapid deployment action triggers.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.8.0",
    date: "August 15, 2026",
    isLatest: false,
    summary: "Engine resilience hardening with encrypted env injection, multi-stage Git auto-deploy, startup stuck job recovery, modern Bun lockfile support, and deduplicated log streams.",
    categories: [
      {
        title: "Engine & Orchestration Hardening",
        badge: "NEW",
        items: [
          {
            title: "Multi-Stage Git Webhook Auto-Deploy",
            description:
              "Push events to staging or development Git branches now automatically trigger zero-downtime builds for matching environment stages in parallel.",
            command: "versiongate webhook test --branch staging",
          },
          {
            title: "Runtime AES-256 Secret Decryption",
            description:
              "Encrypted database environment variables and stage overrides are safely decrypted into container runtime variables upon deployment, promotion, and warm-swap rollback.",
          },
          {
            title: "In-Process Worker Startup Stuck Job Recovery",
            description:
              "Server restarts automatically detect and recover crashed in-flight jobs, clearing stale database deploy locks and keeping deployment status in sync.",
          },
          {
            title: "Modern Bun Lockfile & Optional go.sum Support",
            description:
              "Dockerfile synthesis now detects modern text-based bun.lock files and supports Go projects with standalone go.mod files.",
          },
          {
            title: "WebSocket Live Log Stream Deduplication",
            description:
              "Synchronized log cursor positions between real-time event emitters and PostgreSQL polling prevent duplicate log stream lines in the deployment terminal.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.7.0",
    date: "August 13, 2026",
    isLatest: false,
    summary: "Production-ready installer upgrade with Nginx reverse proxy, PM2 systemd boot persistence, Certbot TLS, and public health checks.",
    categories: [
      {
        title: "Host Installer & Infrastructure",
        badge: "NEW",
        items: [
          {
            title: "Nginx Reverse Proxy Automation",
            description:
              "Installer configures Nginx server block proxying port 80 to 127.0.0.1:9090 with WebSocket upgrade headers, so the engine is reachable on domain or VM public IP directly.",
            command: "curl -fsSL https://versiongate.tech/install.sh | sudo bash",
          },
          {
            title: "PM2 Systemd Reboot Persistence",
            description:
              "Runs pm2 startup systemd and verifies that the pm2 systemd service is active and enabled across server reboots.",
          },
          {
            title: "Optional Certbot TLS Provisioning",
            description:
              "Automatically provisions SSL/TLS certificates via Certbot when a DOMAIN environment variable is passed during install.",
            command: "DOMAIN=versiongate.tech bash install.sh",
          },
          {
            title: "End-to-End Nginx Health Check",
            description:
              "Installer health check verifies both local port 9090 response and Nginx reverse-proxied public endpoint response before finishing.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.6.0",
    date: "August 10, 2026",
    isLatest: false,
    summary: "Signal-black marketing landing with acid-mint accent, mono manifesto typography, and kinetic slot-orbit hero.",
    categories: [
      {
        title: "Website & Marketing",
        badge: "NEW",
        items: [
          {
            title: "Landing page redesign",
            description:
              "Pure-black editorial landing: stacked VersionGate wordmark, kinetic radial control-plane graphic, long-form problem narrative, four-step architecture loop, and install path — acid mint accent system.",
          },
          {
            title: "Typography & atmosphere",
            description:
              "JetBrains Mono display headlines + IBM Plex Sans body, mint (#3EFFA8) accents on pure black, top signal banner, and intentional orbit/pulse motion.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.5.1",
    date: "August 5, 2026",
    isLatest: false,
    summary: "PM2 worker deduplication, Drizzle naming alignment, job queue row locking, and Compose port fixes.",
    categories: [
      {
        title: "Engine Reliability",
        badge: "FIX",
        items: [
          {
            title: "Single job consumer under PM2",
            description:
              "The API process sets IN_PROCESS_WORKER=false when managed by PM2 so only versiongate-worker polls the queue — no duplicate pollers.",
          },
          {
            title: "FOR UPDATE SKIP LOCKED job claims",
            description:
              "Workers claim pending jobs with PostgreSQL row locks so concurrent workers do not fight over the same row.",
          },
          {
            title: "Drizzle schema sync env naming",
            description:
              "Settings and .env editing use DRIZZLE_SCHEMA_SYNC (PRISMA_SCHEMA_SYNC still accepted as a legacy alias).",
          },
          {
            title: "Docker Compose port 9090",
            description: "Compose defaults now match the engine listen port (9090) and single-process in-process worker mode.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.5.0",
    date: "July 30, 2026",
    isLatest: false,
    summary: "Automated Worker Self-Healing, Base-Href HTML Proxying, Auto-Detect Build Context & Relay Fixes.",
    categories: [
      {
        title: "New Features & Infrastructure",
        badge: "NEW",
        items: [
          {
            title: "Automated In-Process Worker Engine",
            description: "Embedded background worker started automatically on server boot, eliminating queue delays and removing the requirement for manual PM2 terminal restarts.",
            command: "versiongate worker status",
            prNumber: 149,
          },
          {
            title: "Base Href HTML Response Proxying",
            description: "Automatic injection of base href tags into proxied HTML responses for seamless CSS, JS, and static asset rendering across Next.js and Vite apps.",
            command: "versiongate proxy test",
            prNumber: 149,
          },
          {
            title: "Smart Repository Context Auto-Detection",
            description: "Vercel-style auto-fill of project names and subdirectory detection (website, dashboard, frontend) upon picking GitHub repositories.",
            command: "versiongate project create",
            prNumber: 149,
          },
        ],
      },
    ],
  },
  {
    version: "v1.4.0",
    date: "July 29, 2026",
    isLatest: false,
    summary: "GitHub App Relay Proxying, Stage Path Reverse Proxy, Warm-Swap Rollbacks, API Bearer Tokens & Health Audit.",
    categories: [
      {
        title: "New Features & Infrastructure",
        badge: "NEW",
        items: [
          {
            title: "GitHub App Relay & Manual Installation Sync",
            description: "Automatic relay proxy fallback for self-hosted instances running without local GitHub App private keys, plus 1-click manual Installation ID sync when GitHub remains on settings page.",
            command: "versiongate github mode --type relay",
            prNumber: 130,
            prLink: "https://github.com/dineshkorukonda/VersionGate/pull/130",
          },
          {
            title: "Stage Path Reverse Proxy Routing",
            description: "Reverse proxies stage environments cleanly on /p/:projectName/:stage without exposing raw container ports.",
            command: "versiongate proxy add --path /p/web-app/staging",
            prNumber: 128,
            prLink: "https://github.com/dineshkorukonda/VersionGate/pull/128",
          },
          {
            title: "Instant Zero-Wait Warm-Swap Rollbacks",
            description: "Sub-second rollbacks reusing locally cached Docker image tags without git re-pulling or context rebuilds.",
            command: "versiongate rollback --project web-app --env production",
            prNumber: 120,
            prLink: "https://github.com/dineshkorukonda/VersionGate/pull/120",
          },
          {
            title: "Bearer API Access Tokens for CI/CD",
            description: "SHA-256 hashed persistent vg_live_... API Bearer tokens for external CI/CD workflow automation.",
            command: "versiongate tokens create --name 'GitHub Actions CI'",
            prNumber: 119,
            prLink: "https://github.com/dineshkorukonda/VersionGate/pull/119",
          },
          {
            title: "Universal One-Line Host Installer Endpoint",
            description: "Direct host endpoint serving install.sh at versiongate.tech/install.sh for automated zero-downtime VM setup.",
            command: "curl -fsSL https://versiongate.tech/install.sh | sudo bash",
            prNumber: 135,
            prLink: "https://github.com/dineshkorukonda/VersionGate/pull/135",
          },
        ],
      },
    ],
  },
  {
    version: "v1.3.0",
    date: "July 21, 2026",
    summary: "Quality Gates, Multi-Stage Promotion Pipelines, and Environment Chain Visualization.",
    categories: [
      {
        title: "Quality Gates & Promotion Pipelines",
        badge: "NEW",
        items: [
          {
            title: "Automated Soak & Health Check Gates",
            description: "Monitors latency and error rate thresholds for a defined soak window before promoting builds.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.2.0",
    date: "May 03, 2026",
    summary: "Multi-tenant GitHub App Central Relay and Neon Database Integration.",
    categories: [
      {
        title: "Relay Architecture & Database Scaling",
        badge: "NEW",
        items: [
          {
            title: "Central GitHub App Relay Core",
            description: "HMAC-SHA256 signature verification (X-VG-Relay-Signature) and fan-out webhook forwarding.",
          },
        ],
      },
    ],
  },
  {
    version: "v1.1.0",
    date: "April 22, 2026",
    summary: "Initial Release of Self-Hosted Zero-Downtime Deployment Engine.",
    categories: [
      {
        title: "Core Deployment Engine",
        badge: "NEW",
        items: [
          {
            title: "Blue-Green Container Execution",
            description: "Multi-stage Docker container builds, atomic Nginx upstream switches, and automated database schema synchronization.",
          },
        ],
      },
    ],
  },
];

function parseReleaseBody(body: string): ReleaseCategory[] {
  if (!body) return [];
  const lines = body.split("\n");
  const categories: ReleaseCategory[] = [];
  let currentCategory: ReleaseCategory | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### Added") || trimmed.startsWith("## Added")) {
      if (currentCategory) categories.push(currentCategory);
      currentCategory = { title: "Added Capabilities", badge: "NEW", items: [] };
    } else if (trimmed.startsWith("### Changed") || trimmed.startsWith("## Changed") || trimmed.startsWith("### Improved")) {
      if (currentCategory) categories.push(currentCategory);
      currentCategory = { title: "Improvements & Updates", badge: "IMPROVEMENT", items: [] };
    } else if (trimmed.startsWith("### Fixed") || trimmed.startsWith("## Fixed")) {
      if (currentCategory) categories.push(currentCategory);
      currentCategory = { title: "Bug Fixes & Security", badge: "FIX", items: [] };
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const itemText = trimmed.replace(/^[-*]\s+/, "");
      const boldMatch = itemText.match(/^\*\*(.*?)\*\*:\s*(.*)/);
      const title = boldMatch ? boldMatch[1] : itemText;
      const description = boldMatch ? boldMatch[2] : itemText;

      if (!currentCategory) {
        currentCategory = { title: "Release Highlights", badge: "NEW", items: [] };
      }
      currentCategory.items.push({ title, description });
    }
  }

  if (currentCategory) categories.push(currentCategory);
  return categories;
}

async function fetchGitHubReleases(): Promise<ProcessedRelease[]> {
  try {
    const res = await fetch("https://api.github.com/repos/dineshkorukonda/VersionGate/releases", {
      headers: {
        "User-Agent": "VersionGate-Website-Changelog",
        Accept: "application/vnd.github+json",
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return FALLBACK_RELEASES;
    }

    const data: GitHubRelease[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return FALLBACK_RELEASES;
    }

    return data.map((rel, idx) => {
      const parsedCategories = parseReleaseBody(rel.body);
      const rawTitle = rel.name || rel.tag_name;
      const titleParts = rawTitle.split(" — ");
      const summary = titleParts.length > 1 ? titleParts[1] : rel.tag_name;

      const dateObj = new Date(rel.published_at);
      const formattedDate = dateObj.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      return {
        version: rel.tag_name,
        date: formattedDate,
        isLatest: idx === 0,
        summary: summary,
        categories: parsedCategories.length > 0 ? parsedCategories : FALLBACK_RELEASES[idx]?.categories || [],
        url: rel.html_url,
      };
    });
  } catch (err) {
    return FALLBACK_RELEASES;
  }
}

export default async function ChangelogPage() {
  const releases = await fetchGitHubReleases();

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors">
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        {/* Page Header */}
        <div className="space-y-4 border-b border-border pb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Changelog // GitHub API Auto-Sync
              </span>
            </div>
            <span className="rounded bg-muted border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              [ AUTO-UPDATED VIA GITHUB RELEASES ]
            </span>
          </div>
          <h1 className="font-sans text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Changelog
          </h1>
          <p className="max-w-2xl font-sans text-sm text-muted-foreground leading-relaxed">
            Live, automatically synced product updates, feature releases, and infrastructure improvements powered by GitHub Releases.
          </p>
        </div>

        {/* Timeline Entries */}
        <div className="mt-10 space-y-16">
          {releases.map((rel) => (
            <section key={rel.version} className="relative grid gap-8 md:grid-cols-12">
              {/* Left Column: Version & Date */}
              <div className="md:col-span-3 space-y-2">
                <div className="sticky top-20 flex items-center gap-2">
                  <span className="font-mono text-lg font-bold text-foreground">
                    {rel.version}
                  </span>
                  {rel.isLatest ? (
                    <span className="rounded bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold text-primary-foreground">
                      LATEST
                    </span>
                  ) : null}
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {rel.date}
                </p>
                {rel.url ? (
                  <div className="pt-2">
                    <Link
                      href={rel.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      View GitHub Release
                    </Link>
                  </div>
                ) : null}
              </div>

              {/* Right Column: Release Content */}
              <div className="md:col-span-9 space-y-8 rounded-lg border border-border bg-card p-6 sm:p-8">
                <p className="font-sans text-sm font-medium text-foreground leading-relaxed border-b border-border pb-4">
                  {rel.summary}
                </p>

                {rel.categories.map((cat, idx) => (
                  <div key={idx} className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted text-foreground border border-border px-2 py-0.5 font-mono text-[10px] font-semibold">
                        [ {cat.badge} ]
                      </span>
                      <h2 className="font-sans text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {cat.title}
                      </h2>
                    </div>

                    <div className="grid gap-4">
                      {cat.items.map((item, itemIdx) => (
                        <div
                          key={itemIdx}
                          className="rounded-md border border-border bg-muted/40 p-4 space-y-2 transition hover:border-foreground/30"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-sans text-sm font-semibold text-foreground">
                              {item.title}
                            </h3>
                            {item.prNumber && item.prLink ? (
                              <Link
                                href={item.prLink}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                              >
                                PR #{item.prNumber}
                              </Link>
                            ) : null}
                          </div>

                          <p className="font-sans text-xs text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>

                          {item.command ? (
                            <div className="mt-2 rounded bg-background border border-border px-3 py-1.5 font-mono text-[11px] text-foreground overflow-x-auto">
                              <code>{item.command}</code>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
