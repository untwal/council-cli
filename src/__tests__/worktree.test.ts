import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { createWorktree, getDiff, applyDiff, removeWorktree, removeAll } from "../worktree";

function createTempRepo(): string {
  const tmpDir = fs.mkdtempSync("/tmp/council-wt-test-");
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name test", { cwd: tmpDir, stdio: "pipe" });
  fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: tmpDir, stdio: "pipe" });
  return tmpDir;
}

describe("createWorktree", () => {
  it("creates a worktree with unique branch name", () => {
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "test-agent");
      expect(fs.existsSync(wt.path)).toBe(true);
      expect(wt.branch).toMatch(/^council\/test-agent-\d+-[a-f0-9]+$/);
      expect(wt.agentId).toBe("test-agent");
      removeWorktree(repo, wt);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("sanitizes agent ID with special chars", () => {
    
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "claude:opus-4.6:reasoning");
      expect(wt.branch).toMatch(/^council\/claude-opus-4-6-reasoning/);
      removeWorktree(repo, wt);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("creates unique branches for same agent", () => {
    
    const repo = createTempRepo();
    try {
      const wt1 = createWorktree(repo, "agent-a");
      const wt2 = createWorktree(repo, "agent-a");
      expect(wt1.branch).not.toBe(wt2.branch);
      expect(wt1.path).not.toBe(wt2.path);
      removeWorktree(repo, wt1);
      removeWorktree(repo, wt2);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("getDiff", () => {
  it("returns empty string for no changes", () => {
    
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "diff-test");
      const diff = getDiff(wt);
      expect(diff).toBe("");
      removeWorktree(repo, wt);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("captures tracked file changes", () => {
    
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "diff-test-2");
      fs.writeFileSync(path.join(wt.path, "README.md"), "# Modified\n");
      const diff = getDiff(wt);
      expect(diff).toContain("-# Test");
      expect(diff).toContain("+# Modified");
      removeWorktree(repo, wt);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("captures untracked files", () => {
    
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "diff-test-3");
      fs.writeFileSync(path.join(wt.path, "new-file.txt"), "hello\n");
      const diff = getDiff(wt);
      expect(diff).toContain("new-file.txt");
      expect(diff).toContain("+hello");
      removeWorktree(repo, wt);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("applyDiff", () => {
  it("applies a valid diff to the repo", () => {
    
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "apply-test");
      fs.writeFileSync(path.join(wt.path, "README.md"), "# Applied\n");
      const diff = getDiff(wt);
      removeWorktree(repo, wt);

      applyDiff(repo, diff);
      const content = fs.readFileSync(path.join(repo, "README.md"), "utf-8");
      expect(content).toBe("# Applied\n");

      // Revert for cleanup
      execSync("git checkout -- .", { cwd: repo, stdio: "pipe" });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("does nothing for empty diff", () => {
    
    const repo = createTempRepo();
    try {
      expect(() => applyDiff(repo, "")).not.toThrow();
      expect(() => applyDiff(repo, "   ")).not.toThrow();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("cleans up temp patch file even on error", () => {
    
    const repo = createTempRepo();
    try {
      try { applyDiff(repo, "invalid patch content"); } catch { /**/ }
      expect(fs.existsSync(path.join(repo, ".council-tmp.patch"))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("removeWorktree", () => {
  it("removes worktree and branch", () => {
    
    const repo = createTempRepo();
    try {
      const wt = createWorktree(repo, "remove-test");
      expect(fs.existsSync(wt.path)).toBe(true);
      removeWorktree(repo, wt);
      expect(fs.existsSync(wt.path)).toBe(false);
      // Branch should be gone
      const branches = execSync("git branch", { cwd: repo, encoding: "utf-8" });
      expect(branches).not.toContain(wt.branch);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("removeAll", () => {
  it("removes all council worktrees and branches", () => {
    
    const repo = createTempRepo();
    try {
      createWorktree(repo, "bulk-1");
      createWorktree(repo, "bulk-2");
      const wtDir = path.join(repo, ".council-worktrees");
      expect(fs.existsSync(wtDir)).toBe(true);

      removeAll(repo);

      expect(fs.existsSync(wtDir)).toBe(false);
      const branches = execSync("git branch", { cwd: repo, encoding: "utf-8" });
      expect(branches).not.toContain("council/");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
