import { describe, test, expect } from "bun:test";
import { StackDetectorService, type RepoFileItem } from "../../src/services/stack-detector.service";

describe("StackDetectorService", () => {
  const detector = new StackDetectorService();

  test("detects Dockerfile and extracts EXPOSE port", () => {
    const files: RepoFileItem[] = [
      { name: "Dockerfile", type: "file", content: "FROM node:20\nEXPOSE 4000\nCMD [\"node\", \"app.js\"]" },
      { name: "README.md", type: "file" },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.detected).toBe(true);
    expect(result.stack).toBe("dockerfile");
    expect(result.recommendedPort).toBe(4000);
    expect(result.label).toContain("Dockerfile");
  });

  test("detects Next.js project from package.json", () => {
    const files: RepoFileItem[] = [
      {
        name: "package.json",
        type: "file",
        content: JSON.stringify({
          name: "my-web-app",
          dependencies: { next: "14.2.0", react: "^18" },
        }),
      },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.detected).toBe(true);
    expect(result.stack).toBe("nextjs");
    expect(result.label).toBe("Next.js");
    expect(result.recommendedPort).toBe(3000);
    expect(result.recommendedHealthPath).toBe("/");
  });

  test("detects Vite SPA project from package.json", () => {
    const files: RepoFileItem[] = [
      {
        name: "package.json",
        type: "file",
        content: JSON.stringify({
          name: "client-portal",
          devDependencies: { vite: "^5.0.0" },
        }),
      },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.detected).toBe(true);
    expect(result.stack).toBe("vite");
    expect(result.label).toBe("Vite SPA");
    expect(result.recommendedPort).toBe(80);
    expect(result.recommendedHealthPath).toBe("/");
  });

  test("detects FastAPI Python project from requirements.txt", () => {
    const files: RepoFileItem[] = [
      {
        name: "requirements.txt",
        type: "file",
        content: "fastapi==0.110.0\nuvicorn==0.28.0\n",
      },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.detected).toBe(true);
    expect(result.stack).toBe("fastapi");
    expect(result.label).toBe("FastAPI (Python)");
    expect(result.recommendedPort).toBe(8000);
    expect(result.recommendedHealthPath).toBe("/docs");
  });

  test("detects Go project from go.mod", () => {
    const files: RepoFileItem[] = [
      {
        name: "go.mod",
        type: "file",
        content: "module example.com/my-service\n\ngo 1.22\n",
      },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.detected).toBe(true);
    expect(result.stack).toBe("go");
    expect(result.label).toBe("Go");
    expect(result.recommendedPort).toBe(8080);
    expect(result.recommendedHealthPath).toBe("/health");
  });

  test("detects Static HTML project from index.html", () => {
    const files: RepoFileItem[] = [
      {
        name: "index.html",
        type: "file",
        content: "<!DOCTYPE html><html><body>Landing</body></html>",
      },
      {
        name: "styles.css",
        type: "file",
      },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.detected).toBe(true);
    expect(result.stack).toBe("static-html");
    expect(result.label).toBe("Static HTML");
    expect(result.recommendedPort).toBe(80);
    expect(result.recommendedHealthPath).toBe("/health");
  });

  test("detects subfolder context when monorepo subdirectories exist", () => {
    const files: RepoFileItem[] = [
      { name: "README.md", type: "file" },
      { name: "apps/web", type: "dir" },
      { name: "frontend", type: "dir" },
    ];
    const result = detector.detectFromFiles(files);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(result.suggestions.some((s) => s.value === "apps/web")).toBe(true);
    expect(result.suggestions.some((s) => s.value === "frontend")).toBe(true);
  });
});
