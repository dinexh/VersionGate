import { describe, test, expect } from "bun:test";
import { ensureDockerfile } from "../../src/utils/dockerfile";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Dockerfile Generator", () => {
  test("generates Dockerfile for Node.js package.json project", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-node-"));
    try {
      await fs.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-node-app", scripts: { start: "node index.js" } }),
        "utf-8"
      );

      const buildDir = await ensureDockerfile(tmpDir, 3000);
      expect(buildDir).toBe(tmpDir);

      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("FROM node:20-alpine");
      expect(content).toContain("EXPOSE 3000");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates Dockerfile for Python requirements.txt project", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-py-"));
    try {
      await fs.writeFile(path.join(tmpDir, "requirements.txt"), "flask==3.0.0", "utf-8");

      await ensureDockerfile(tmpDir, 8000);
      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("FROM python:3.11-slim");
      expect(content).toContain("EXPOSE 8000");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates Dockerfile for Go go.mod project", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-go-"));
    try {
      await fs.writeFile(path.join(tmpDir, "go.mod"), "module testgo\n\ngo 1.22", "utf-8");

      await ensureDockerfile(tmpDir, 8080);
      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("FROM golang:1.22-alpine");
      expect(content).toContain("EXPOSE 8080");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates Dockerfile for Bun project with modern text bun.lock", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-bun-"));
    try {
      await fs.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-bun-app", scripts: { start: "bun run index.ts" } }),
        "utf-8"
      );
      await fs.writeFile(path.join(tmpDir, "bun.lock"), "# bun lockfile v1\n", "utf-8");

      await ensureDockerfile(tmpDir, 3000);
      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("FROM oven/bun:alpine");
      expect(content).toContain("COPY package.json bun.lock* bun.lockb* ./");
      expect(content).toContain("EXPOSE 3000");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates Dockerfile for Go project with optional go.sum", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-go-nosum-"));
    try {
      await fs.writeFile(path.join(tmpDir, "go.mod"), "module testgonosum\n\ngo 1.22", "utf-8");

      await ensureDockerfile(tmpDir, 8080);
      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("COPY go.mod go.sum* ./");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates Dockerfile for static HTML index.html project with health check and routing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-html-"));
    try {
      await fs.writeFile(path.join(tmpDir, "index.html"), "<!DOCTYPE html><html><body>Hello</body></html>", "utf-8");

      const buildDir = await ensureDockerfile(tmpDir, 3000);
      expect(buildDir).toBe(tmpDir);

      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("FROM nginx:1.25-alpine");
      expect(content).toContain("COPY . /usr/share/nginx/html");
      expect(content).toContain("listen 3000;");
      expect(content).toContain("location = /health");
      expect(content).toContain('return 200 "healthy";');
      expect(content).toContain("try_files $uri $uri/ $uri.html /index.html =404;");
      expect(content).toContain("EXPOSE 3000");
      expect(content).toContain('CMD ["nginx", "-g", "daemon off;"]');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates Dockerfile for static HTML index.htm project", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vg-test-htm-"));
    try {
      await fs.writeFile(path.join(tmpDir, "index.htm"), "<!DOCTYPE html><html><body>Hello htm</body></html>", "utf-8");

      const buildDir = await ensureDockerfile(tmpDir, 80);
      expect(buildDir).toBe(tmpDir);

      const content = await fs.readFile(path.join(tmpDir, "Dockerfile"), "utf-8");
      expect(content).toContain("FROM nginx:1.25-alpine");
      expect(content).toContain("listen 80;");
      expect(content).toContain("EXPOSE 80");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
