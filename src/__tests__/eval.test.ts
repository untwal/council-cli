import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { evaluate, EvalResult } from "../eval";
import { Worktree } from "../worktree";
import { resetCache } from "../config";

function createTempRepo(): string {
  const tmpDir = fs.mkdtempSync("/tmp/council-eval-test-");
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email test@test.com && git config user.name test", { cwd: tmpDir, stdio: "pipe" });
  fs.writeFileSync(path.join(tmpDir, "README.md"), "test\n");
  execSync("git add -A && git commit -m init", { cwd: tmpDir, stdio: "pipe" });
  return tmpDir;
}

beforeEach(() => resetCache());

describe("evaluate", () => {
  it("runs a passing command", () => {
    const repo = createTempRepo();
    try {
      const wt: Worktree = { agentId: "test", path: repo, branch: "main" };
      const result = evaluate(wt, ["echo hello"]);
      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].passed).toBe(true);
      expect(result.checks[0].output).toContain("hello");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("detects failing command", () => {
    const repo = createTempRepo();
    try {
      const wt: Worktree = { agentId: "test", path: repo, branch: "main" };
      const result = evaluate(wt, ["false"]); // `false` exits with code 1
      expect(result.allPassed).toBe(false);
      expect(result.checks[0].passed).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("handles multiple commands with mixed results", () => {
    const repo = createTempRepo();
    try {
      const wt: Worktree = { agentId: "test", path: repo, branch: "main" };
      const result = evaluate(wt, ["echo ok", "false", "echo still"]);
      expect(result.allPassed).toBe(false);
      expect(result.checks[0].passed).toBe(true);
      expect(result.checks[1].passed).toBe(false);
      expect(result.checks[2].passed).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("truncates very long output", () => {
    const repo = createTempRepo();
    try {
      const wt: Worktree = { agentId: "test", path: repo, branch: "main" };
      // Generate a lot of output
      const result = evaluate(wt, ["seq 1 5000"]);
      expect(result.checks[0].output.length).toBeLessThan(2500);
      expect(result.checks[0].output).toContain("...");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("records duration for each check", () => {
    const repo = createTempRepo();
    try {
      const wt: Worktree = { agentId: "test", path: repo, branch: "main" };
      const result = evaluate(wt, ["echo fast"]);
      expect(result.checks[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns empty checks for empty command list", () => {
    const repo = createTempRepo();
    // Create a bare repo with no auto-detectable checks
    try {
      const wt: Worktree = { agentId: "test", path: repo, branch: "main" };
      const result = evaluate(wt, []);
      // Auto-detection kicks in, but no config files exist so no checks
      expect(result.allPassed).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
