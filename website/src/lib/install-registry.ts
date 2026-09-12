import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Redis } from "@upstash/redis";

export interface InstallMapping {
  instanceUrl: string;
  userId?: string;
  registeredAt: string;
}

function normalizeInstanceUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function instanceKeyHash(instanceUrl: string): string {
  return createHash("sha256").update(normalizeInstanceUrl(instanceUrl), "utf8").digest("hex").slice(0, 32);
}

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function installKey(installationId: string | number): string {
  return `vg:install:${installationId}`;
}

function instanceIndexKey(instanceUrl: string): string {
  return `vg:instance:${instanceKeyHash(instanceUrl)}:installs`;
}

// Local file / in-memory fallback for self-hosted instances when Upstash Redis is not configured
const LOCAL_REGISTRY_PATH =
  process.env.VG_REGISTRY_FILE ||
  (process.platform === "win32"
    ? join(process.env.TEMP || "C:\\temp", "versiongate-install-registry.json")
    : "/tmp/versiongate-install-registry.json");

const memoryCache = new Map<string, InstallMapping>();
let localLoaded = false;

function loadLocalStore(): Map<string, InstallMapping> {
  if (localLoaded) return memoryCache;
  try {
    if (existsSync(LOCAL_REGISTRY_PATH)) {
      const raw = readFileSync(LOCAL_REGISTRY_PATH, "utf8");
      const parsed = JSON.parse(raw) as Record<string, InstallMapping>;
      for (const [k, v] of Object.entries(parsed)) {
        memoryCache.set(k, v);
      }
    }
  } catch (err) {
    console.warn("[install-registry] Warning loading local fallback registry:", err);
  }
  localLoaded = true;
  return memoryCache;
}

function persistLocalStore(): void {
  try {
    const dir = dirname(LOCAL_REGISTRY_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, InstallMapping> = {};
    for (const [k, v] of memoryCache.entries()) {
      obj[k] = v;
    }
    writeFileSync(LOCAL_REGISTRY_PATH, JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    console.warn("[install-registry] Warning persisting local fallback registry:", err);
  }
}

export async function setInstallMapping(
  installationId: string | number,
  mapping: { instanceUrl: string; userId?: string }
): Promise<void> {
  const instanceUrl = normalizeInstanceUrl(mapping.instanceUrl);
  const payload: InstallMapping = {
    instanceUrl,
    userId: mapping.userId,
    registeredAt: new Date().toISOString(),
  };
  const id = String(installationId);

  const redis = getRedis();
  if (redis) {
    await redis.set(installKey(id), payload);
    await redis.sadd(instanceIndexKey(instanceUrl), id);
  } else {
    // Local memory / file fallback
    loadLocalStore();
    memoryCache.set(id, payload);
    persistLocalStore();
  }
}

export async function getInstallMapping(installationId: string | number): Promise<InstallMapping | null> {
  const id = String(installationId);
  const redis = getRedis();
  if (redis) {
    const raw = await redis.get<InstallMapping | string>(installKey(id));
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as InstallMapping;
      } catch {
        return null;
      }
    }
    return raw;
  }

  // Local memory / file fallback
  const store = loadLocalStore();
  return store.get(id) ?? null;
}

export async function deleteInstallMapping(installationId: string | number): Promise<void> {
  const id = String(installationId);
  const redis = getRedis();
  if (redis) {
    const existing = await getInstallMapping(id);
    await redis.del(installKey(id));
    if (existing?.instanceUrl) {
      await redis.srem(instanceIndexKey(existing.instanceUrl), id);
    }
  } else {
    // Local memory / file fallback
    loadLocalStore();
    memoryCache.delete(id);
    persistLocalStore();
  }
}

export function isValidInstanceUrl(instanceUrl: string): boolean {
  const t = instanceUrl.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (!u.hostname) return false;
    return true;
  } catch {
    return false;
  }
}
