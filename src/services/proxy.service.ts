import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db/client";
import { projects, environments, deployments } from "../db/schema";
import { logger } from "../utils/logger";
import { projectAnalyticsService } from "./project-analytics.service";
import type { FastifyRequest, FastifyReply } from "fastify";

export interface ResolvedProxyTarget {
  projectId: string;
  projectName: string;
  environmentName: string;
  port: number;
  healthPath: string;
  proxyPrefix: string;
}

export class ProxyService {
  async resolveTarget(projectName: string, envName?: string): Promise<ResolvedProxyTarget | null> {
    const db = getDb();

    // 1. Find project by name
    const projRows = await db
      .select()
      .from(projects)
      .where(eq(projects.name, projectName.toLowerCase()))
      .limit(1);

    if (projRows.length === 0) {
      return null;
    }
    const project = projRows[0];

    // 2. Find target environment
    const targetEnvName = (envName || "production").toLowerCase();
    const envRows = await db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.projectId, project.id),
          eq(environments.name, targetEnvName)
        )
      )
      .limit(1);

    if (envRows.length === 0) {
      return null;
    }
    const environment = envRows[0];

    // 3. Find active deployment for environment
    const depRows = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.environmentId, environment.id),
          eq(deployments.status, "ACTIVE")
        )
      )
      .orderBy(desc(deployments.createdAt))
      .limit(1);

    if (depRows.length === 0) {
      return null;
    }

    const proxyPrefix = `/p/${project.name}/${environment.name}`;

    return {
      projectId: project.id,
      projectName: project.name,
      environmentName: environment.name,
      port: depRows[0].port,
      healthPath: project.healthPath,
      proxyPrefix,
    };
  }

  /**
   * Rewrites absolute-path asset references in HTML so they route through
   * the VersionGate reverse proxy prefix. Handles Next.js (_next/), Vite (/assets/),
   * and generic root-relative paths (/static/).
   */
  private rewriteHtmlAssetPaths(html: string, proxyPrefix: string): string {
    // Inject <base> tag so relative paths also resolve correctly
    if (!html.includes("<base ")) {
      html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${proxyPrefix}/">`);
    }

    // Next.js: rewrite assetPrefix in __NEXT_DATA__ JSON
    html = html.replace(/"assetPrefix":""/g, `"assetPrefix":"${proxyPrefix}"`);

    // Rewrite src="/_next/... and href="/_next/... (Next.js static assets)
    html = html.replace(/(src|href)="\/_next\//gi, `$1="${proxyPrefix}/_next/`);

    // Rewrite /assets/ (Vite output)
    html = html.replace(/(src|href)="\/assets\//gi, `$1="${proxyPrefix}/assets/`);

    // Rewrite /static/ (CRA and misc setups)
    html = html.replace(/(src|href)="\/static\//gi, `$1="${proxyPrefix}/static/`);

    return html;
  }

  async proxyRequest(
    req: FastifyRequest,
    reply: FastifyReply,
    target: ResolvedProxyTarget,
    subPath: string
  ): Promise<void> {
    const sub = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const queryIdx = req.url.indexOf("?");
    const queryString = queryIdx !== -1 ? req.url.slice(queryIdx) : "";
    const targetUrl = `http://127.0.0.1:${target.port}${sub}${queryString}`;

    try {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        if (key.toLowerCase() === "host") {
          headers["host"] = `127.0.0.1:${target.port}`;
        } else if (key.toLowerCase() !== "connection") {
          headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
        }
      }

      headers["x-forwarded-for"] = req.ip || "127.0.0.1";
      headers["x-forwarded-proto"] = req.protocol || "http";
      headers["x-versiongate-proxy"] = "true";
      // Signal basePath to Next.js SSR
      headers["x-forwarded-prefix"] = target.proxyPrefix;

      const method = req.method;
      const hasBody = method !== "GET" && method !== "HEAD";
      const bodyPayload = hasBody && req.body
        ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body))
        : undefined;

      const startTime = Date.now();
      const response = await fetch(targetUrl, {
        method,
        headers,
        body: bodyPayload,
      });
      const latencyMs = Math.max(1, Date.now() - startTime);

      // Record hit telemetry asynchronously
      void projectAnalyticsService.recordHit(target.projectId, response.status, latencyMs);

      reply.code(response.status);

      response.headers.forEach((val, key) => {
        if (
          key.toLowerCase() !== "transfer-encoding" &&
          key.toLowerCase() !== "content-encoding"
        ) {
          reply.header(key, val);
        }
      });

      if (response.body) {
        const contentType = response.headers.get("content-type") || "";
        const arrayBuffer = await response.arrayBuffer();
        let buf = Buffer.from(arrayBuffer);

        if (contentType.includes("text/html")) {
          let html = buf.toString("utf8");
          html = this.rewriteHtmlAssetPaths(html, target.proxyPrefix);
          buf = Buffer.from(html, "utf8");
          reply.header("content-length", buf.length.toString());
        }

        return reply.send(buf);
      } else {
        return reply.send();
      }
    } catch (err) {
      logger.error({ err, targetUrl }, "Proxy error dispatching to upstream container");
      return reply.code(502).type("text/html").send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>VersionGate Gateway Error</title>
            <style>
              body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #334155; max-width: 500px; text-align: center; }
              h1 { color: #f43f5e; font-size: 1.5rem; margin-top: 0; }
              p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
              .badge { background: #334155; color: #38bdf8; padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>502 Bad Gateway</h1>
              <p>VersionGate proxy could not connect to <strong>${target.projectName}</strong> (<span class="badge">${target.environmentName}</span>) at port <code>${target.port}</code>.</p>
              <p>The container may still be booting or failed health check.</p>
            </div>
          </body>
        </html>
      `);
    }
  }
}
