import fs from "fs/promises";
import path from "path";
import { Octokit } from "@octokit/rest";
import { getInstallationAccessToken } from "../utils/github/github-installation-token";
import { config } from "../config/env";
import { logger } from "../utils/logger";

function githubAppReady(): boolean {
  return Boolean(config.githubAppId && config.githubAppPrivateKey);
}

export interface RepoFileItem {
  name: string;
  type: "file" | "dir";
  path?: string;
  content?: string;
}

export interface StackDetectionResult {
  detected: boolean;
  stack: string;
  label: string;
  recommendedPort: number;
  recommendedHealthPath: string;
  recommendedBuildContext: string;
  confidence: "high" | "medium" | "low";
  suggestions: { label: string; value: string }[];
}

const COMMON_CONTEXT_DIRS = [
  "apps/web",
  "frontend",
  "website",
  "dashboard",
  "client",
  "web",
  "packages/app",
  "src",
];

export class StackDetectorService {
  /**
   * Pure deterministic detection based on a list of repo files and optional content.
   */
  detectFromFiles(items: RepoFileItem[]): StackDetectionResult {
    const fileMap = new Map<string, RepoFileItem>();
    for (const item of items) {
      fileMap.set(item.name.toLowerCase(), item);
    }

    const suggestions: { label: string; value: string }[] = [
      { label: "Repository root (.)", value: "." },
    ];

    for (const dirName of COMMON_CONTEXT_DIRS) {
      const parts = dirName.split("/");
      const rootFolder = parts[0];
      const match = items.find(
        (i) => (i.type === "dir" || i.path === dirName) && (i.name === rootFolder || i.path === dirName || i.name === dirName)
      );
      if (match) {
        suggestions.push({ label: dirName, value: dirName });
      }
    }

    // 1. Dockerfile
    const dockerfile = fileMap.get("dockerfile");
    if (dockerfile) {
      let exposedPort = 3000;
      if (dockerfile.content) {
        const match = dockerfile.content.match(/EXPOSE\s+(\d+)/i);
        if (match && match[1]) {
          const parsed = parseInt(match[1], 10);
          if (parsed > 0 && parsed <= 65535) {
            exposedPort = parsed;
          }
        }
      }
      return {
        detected: true,
        stack: "dockerfile",
        label: exposedPort !== 3000 ? `Dockerfile (EXPOSE ${exposedPort})` : "Dockerfile",
        recommendedPort: exposedPort,
        recommendedHealthPath: "/",
        recommendedBuildContext: ".",
        confidence: "high",
        suggestions,
      };
    }

    // 2. package.json (Node ecosystem)
    const pkgJson = fileMap.get("package.json");
    if (pkgJson?.content) {
      try {
        const pkg = JSON.parse(pkgJson.content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          scripts?: Record<string, string>;
        };
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const scripts = pkg.scripts || {};

        if (allDeps["next"]) {
          return {
            detected: true,
            stack: "nextjs",
            label: "Next.js",
            recommendedPort: 3000,
            recommendedHealthPath: "/",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        if (allDeps["nuxt"] || allDeps["nuxt3"]) {
          return {
            detected: true,
            stack: "nuxt",
            label: "Nuxt",
            recommendedPort: 3000,
            recommendedHealthPath: "/",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        if (allDeps["@remix-run/node"] || allDeps["@remix-run/react"]) {
          return {
            detected: true,
            stack: "remix",
            label: "Remix",
            recommendedPort: 3000,
            recommendedHealthPath: "/",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        if (allDeps["astro"]) {
          return {
            detected: true,
            stack: "astro",
            label: "Astro",
            recommendedPort: 4321,
            recommendedHealthPath: "/",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        if (allDeps["@sveltejs/kit"] || allDeps["svelte"]) {
          return {
            detected: true,
            stack: "sveltekit",
            label: "SvelteKit",
            recommendedPort: 3000,
            recommendedHealthPath: "/",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        if (allDeps["vite"] || allDeps["react-scripts"] || allDeps["@vue/cli-service"]) {
          return {
            detected: true,
            stack: "vite",
            label: "Vite SPA",
            recommendedPort: 80,
            recommendedHealthPath: "/",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        if (
          allDeps["express"] ||
          allDeps["fastify"] ||
          allDeps["@nestjs/core"] ||
          allDeps["koa"] ||
          allDeps["hono"]
        ) {
          return {
            detected: true,
            stack: "node-api",
            label: "Node.js API",
            recommendedPort: 3000,
            recommendedHealthPath: "/health",
            recommendedBuildContext: ".",
            confidence: "high",
            suggestions,
          };
        }

        const isBun = Boolean(fileMap.get("bun.lock") || fileMap.get("bun.lockb") || /bun/.test(scripts.start || ""));
        return {
          detected: true,
          stack: isBun ? "bun" : "node",
          label: isBun ? "Bun" : "Node.js",
          recommendedPort: 3000,
          recommendedHealthPath: "/",
          recommendedBuildContext: ".",
          confidence: "medium",
          suggestions,
        };
      } catch {
        // invalid JSON
      }
    }

    // 3. Python (requirements.txt, pyproject.toml, Pipfile)
    const reqs = fileMap.get("requirements.txt") || fileMap.get("pyproject.toml") || fileMap.get("pipfile");
    if (reqs) {
      const content = (reqs.content || "").toLowerCase();
      if (content.includes("fastapi") || content.includes("uvicorn")) {
        return {
          detected: true,
          stack: "fastapi",
          label: "FastAPI (Python)",
          recommendedPort: 8000,
          recommendedHealthPath: "/docs",
          recommendedBuildContext: ".",
          confidence: "high",
          suggestions,
        };
      }
      if (content.includes("flask")) {
        return {
          detected: true,
          stack: "flask",
          label: "Flask (Python)",
          recommendedPort: 5000,
          recommendedHealthPath: "/",
          recommendedBuildContext: ".",
          confidence: "high",
          suggestions,
        };
      }
      if (content.includes("django")) {
        return {
          detected: true,
          stack: "django",
          label: "Django (Python)",
          recommendedPort: 8000,
          recommendedHealthPath: "/",
          recommendedBuildContext: ".",
          confidence: "high",
          suggestions,
        };
      }
      return {
        detected: true,
        stack: "python",
        label: "Python",
        recommendedPort: 8000,
        recommendedHealthPath: "/health",
        recommendedBuildContext: ".",
        confidence: "medium",
        suggestions,
      };
    }

    // 4. Go (go.mod)
    if (fileMap.has("go.mod")) {
      return {
        detected: true,
        stack: "go",
        label: "Go",
        recommendedPort: 8080,
        recommendedHealthPath: "/health",
        recommendedBuildContext: ".",
        confidence: "high",
        suggestions,
      };
    }

    // 5. Rust (Cargo.toml)
    if (fileMap.has("cargo.toml")) {
      return {
        detected: true,
        stack: "rust",
        label: "Rust",
        recommendedPort: 8080,
        recommendedHealthPath: "/health",
        recommendedBuildContext: ".",
        confidence: "high",
        suggestions,
      };
    }

    // 6. Static HTML (index.html, index.htm)
    if (fileMap.has("index.html") || fileMap.has("index.htm")) {
      return {
        detected: true,
        stack: "static-html",
        label: "Static HTML",
        recommendedPort: 80,
        recommendedHealthPath: "/health",
        recommendedBuildContext: ".",
        confidence: "high",
        suggestions,
      };
    }

    return {
      detected: false,
      stack: "unknown",
      label: "Custom / Dockerfile",
      recommendedPort: 3000,
      recommendedHealthPath: "/health",
      recommendedBuildContext: ".",
      confidence: "low",
      suggestions,
    };
  }

  /**
   * Detects stack by querying GitHub repo contents.
   */
  async detectFromGithub(
    owner: string,
    repo: string,
    options?: { branch?: string; installationId?: number }
  ): Promise<StackDetectionResult> {
    const branch = options?.branch?.trim() || undefined;
    const items: RepoFileItem[] = [];

    if (options?.installationId && githubAppReady()) {
      try {
        const { token } = await getInstallationAccessToken(options.installationId);
        const octokit = new Octokit({ auth: token });
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: "",
          ref: branch,
        });

        if (Array.isArray(data)) {
          for (const entry of data) {
            items.push({
              name: entry.name,
              type: entry.type === "dir" ? "dir" : "file",
              path: entry.path,
            });
          }

          // Fetch content for candidate manifests
          for (const targetName of ["package.json", "Dockerfile", "requirements.txt", "go.mod", "index.html"]) {
            const found = items.find((i) => i.name.toLowerCase() === targetName.toLowerCase() && i.type === "file");
            if (found) {
              try {
                const res = await octokit.rest.repos.getContent({
                  owner,
                  repo,
                  path: found.name,
                  ref: branch,
                });
                if (!Array.isArray(res.data) && "content" in res.data && res.data.content) {
                  found.content = Buffer.from(res.data.content, "base64").toString("utf-8");
                }
              } catch {
                // file read error ignored
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err, owner, repo }, "detectFromGithub: octokit fetch failed, falling back to public GitHub API");
      }
    }

    if (items.length === 0) {
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "VersionGate-Engine",
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (res.ok) {
          const raw = (await res.json()) as { name: string; type: string; path: string; download_url?: string }[];
          if (Array.isArray(raw)) {
            for (const r of raw) {
              items.push({
                name: r.name,
                type: r.type === "dir" ? "dir" : "file",
                path: r.path,
              });
            }

            // Fetch package.json or requirements.txt if present via download_url
            for (const targetName of ["package.json", "Dockerfile", "requirements.txt"]) {
              const fileObj = raw.find((r) => r.name.toLowerCase() === targetName.toLowerCase() && r.download_url);
              if (fileObj?.download_url) {
                try {
                  const contentRes = await fetch(fileObj.download_url);
                  if (contentRes.ok) {
                    const text = await contentRes.text();
                    const item = items.find((i) => i.name.toLowerCase() === targetName.toLowerCase());
                    if (item) item.content = text;
                  }
                } catch {
                  // ignored
                }
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err, owner, repo }, "detectFromGithub: public fetch failed");
      }
    }

    return this.detectFromFiles(items);
  }

  /**
   * Inspects a local directory on disk.
   */
  async detectFromLocalPath(repoDir: string): Promise<StackDetectionResult> {
    const items: RepoFileItem[] = [];
    try {
      const entries = await fs.readdir(repoDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".git") || entry.name === "node_modules") continue;
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          path: entry.name,
        });
      }

      for (const manifest of ["package.json", "Dockerfile", "requirements.txt", "go.mod", "index.html", "index.htm"]) {
        const item = items.find((i) => i.name.toLowerCase() === manifest.toLowerCase() && i.type === "file");
        if (item) {
          try {
            item.content = await fs.readFile(path.join(repoDir, item.name), "utf-8");
          } catch {
            // ignore read error
          }
        }
      }
    } catch {
      // directory read failure
    }

    return this.detectFromFiles(items);
  }
}

export const stackDetectorService = new StackDetectorService();
