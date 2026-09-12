import redisService from "./redis.service";

export interface ProjectAnalyticsSummary {
  projectId: string;
  totalHits: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  avgLatencyMs: number;
  recentHitsByHour: { hour: string; count: number }[];
}

interface LocalProjectStats {
  totalHits: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  totalLatencyMs: number;
  hourly: Map<string, number>;
}

export class ProjectAnalyticsService {
  private localStore = new Map<string, LocalProjectStats>();

  private getOrCreateLocal(projectId: string): LocalProjectStats {
    let s = this.localStore.get(projectId);
    if (!s) {
      s = {
        totalHits: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        totalLatencyMs: 0,
        hourly: new Map<string, number>(),
      };
      this.localStore.set(projectId, s);
    }
    return s;
  }

  async recordHit(projectId: string, statusCode: number, latencyMs: number): Promise<void> {
    const hourKey = new Date().toISOString().slice(0, 13); // e.g. "2026-09-12T14"

    // 1. Local fallback record
    const local = this.getOrCreateLocal(projectId);
    local.totalHits += 1;
    local.totalLatencyMs += latencyMs;
    if (statusCode >= 200 && statusCode < 300) local.status2xx += 1;
    else if (statusCode >= 300 && statusCode < 400) local.status3xx += 1;
    else if (statusCode >= 400 && statusCode < 500) local.status4xx += 1;
    else if (statusCode >= 500) local.status5xx += 1;

    local.hourly.set(hourKey, (local.hourly.get(hourKey) ?? 0) + 1);

    // Keep only last 24 hours locally
    if (local.hourly.size > 24) {
      const keys = [...local.hourly.keys()].sort();
      while (keys.length > 24) {
        const oldest = keys.shift();
        if (oldest) local.hourly.delete(oldest);
      }
    }

    // 2. Redis record if available
    if (redisService.isAvailable()) {
      try {
        const client = (redisService as any).client;
        if (client) {
          const key = `analytics:${projectId}`;
          await client.hincrby(key, "totalHits", 1);
          await client.hincrby(key, "totalLatencyMs", Math.round(latencyMs));
          if (statusCode >= 200 && statusCode < 300) await client.hincrby(key, "status2xx", 1);
          else if (statusCode >= 300 && statusCode < 400) await client.hincrby(key, "status3xx", 1);
          else if (statusCode >= 400 && statusCode < 500) await client.hincrby(key, "status4xx", 1);
          else if (statusCode >= 500) await client.hincrby(key, "status5xx", 1);
          await client.hincrby(`${key}:hourly`, hourKey, 1);
        }
      } catch {
        // redis error ignored, fallback to local
      }
    }
  }

  async getAnalytics(projectId: string): Promise<ProjectAnalyticsSummary> {
    // Generate 24 hourly buckets
    const now = new Date();
    const recentBuckets: { hour: string; count: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const label = `${d.getHours().toString().padStart(2, "0")}:00`;
      recentBuckets.push({ hour: label, count: 0 });
    }

    const local = this.getOrCreateLocal(projectId);

    // If Redis is available, read from Redis
    if (redisService.isAvailable()) {
      try {
        const client = (redisService as any).client;
        if (client) {
          const key = `analytics:${projectId}`;
          const [stats, hourlyData] = await Promise.all([
            client.hgetall(key),
            client.hgetall(`${key}:hourly`),
          ]);
          if (stats && Object.keys(stats).length > 0) {
            const totalHits = Number.parseInt(stats.totalHits || "0", 10);
            const totalLatency = Number.parseInt(stats.totalLatencyMs || "0", 10);
            const status2xx = Number.parseInt(stats.status2xx || "0", 10);
            const status3xx = Number.parseInt(stats.status3xx || "0", 10);
            const status4xx = Number.parseInt(stats.status4xx || "0", 10);
            const status5xx = Number.parseInt(stats.status5xx || "0", 10);

            if (hourlyData) {
              for (let i = 23; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 3600 * 1000);
                const hKey = d.toISOString().slice(0, 13);
                const count = Number.parseInt(hourlyData[hKey] || "0", 10);
                const idx = 23 - i;
                if (recentBuckets[idx]) recentBuckets[idx].count = count;
              }
            }

            return {
              projectId,
              totalHits,
              status2xx,
              status3xx,
              status4xx,
              status5xx,
              avgLatencyMs: totalHits > 0 ? Math.round(totalLatency / totalHits) : 0,
              recentHitsByHour: recentBuckets,
            };
          }
        }
      } catch {
        // fallback to local
      }
    }

    // Return from local
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const hKey = d.toISOString().slice(0, 13);
      const count = local.hourly.get(hKey) ?? 0;
      const idx = 23 - i;
      if (recentBuckets[idx]) recentBuckets[idx].count = count;
    }

    return {
      projectId,
      totalHits: local.totalHits,
      status2xx: local.status2xx,
      status3xx: local.status3xx,
      status4xx: local.status4xx,
      status5xx: local.status5xx,
      avgLatencyMs: local.totalHits > 0 ? Math.round(local.totalLatencyMs / local.totalHits) : 0,
      recentHitsByHour: recentBuckets,
    };
  }
}

export const projectAnalyticsService = new ProjectAnalyticsService();
