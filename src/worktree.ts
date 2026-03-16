import { execSync, spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

const GIT_TIMEOUT = 30_000;
const SPAWN_OPTS = { stdio: "pipe" as const, timeout: GIT_TIMEOUT };

export interface Worktree {
  agentId: string;
  path: string;
  branch: string;
}

export function createWorktree(repoPath: string, agentId: string): Worktree {
  const safe = agentId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const uid = crypto.randomBytes(4).toString("hex");
  const ts = Date.now();
  const branch = `council/${safe}-${ts}-${uid}`;
  const wtPath = path.join(repoPath, ".council-worktrees", `${safe}-${ts}-${uid}`);

  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  // Use spawnSync with array args to prevent shell injection
  const result = spawnSync("git", ["worktree", "add", "-b", branch, wtPath], { cwd: repoPath, ...SPAWN_OPTS });
  if (result.status !== 0) {
    throw new Error(`git worktree add failed: ${(result.stderr ?? "").toString().slice(0, 200)}`);
  }

  return { agentId, path: wtPath, branch };
}

export function getDiff(worktree: Worktree): string {
  try {
    const tracked = spawnSync("git", ["diff", "HEAD"], { cwd: worktree.path, encoding: "utf-8", timeout: GIT_TIMEOUT });

    const untrackedResult = spawnSync(
      "git", ["ls-files", "--others", "--exclude-standard"],
      { cwd: worktree.path, encoding: "utf-8", timeout: GIT_TIMEOUT }
    );
    const untrackedFiles = (untrackedResult.stdout ?? "").trim().split("\n").filter(Boolean);

    let untrackedDiffs = "";
    for (const f of untrackedFiles) {
      // Validate filename doesn't contain path traversal
      if (f.includes("..") || path.isAbsolute(f)) continue;
      const r = spawnSync("git", ["diff", "--no-index", "/dev/null", f], {
        cwd: worktree.path, encoding: "utf-8", timeout: GIT_TIMEOUT,
      });
      if (r.stdout) untrackedDiffs += r.stdout;
    }

    return (tracked.stdout ?? "") + untrackedDiffs;
  } catch {
    return "";
  }
}

export function applyDiff(repoPath: string, diff: string): void {
  if (!diff.trim()) return;

  const tmpPatch = path.join(repoPath, `.council-patch-${crypto.randomBytes(4).toString("hex")}.tmp`);

  try {
    fs.writeFileSync(tmpPatch, diff, { mode: 0o600 }); // restrict permissions
    let result = spawnSync("git", ["apply", "--3way", tmpPatch], { cwd: repoPath, ...SPAWN_OPTS });
    if (result.status !== 0) {
      result = spawnSync("git", ["apply", tmpPatch], { cwd: repoPath, ...SPAWN_OPTS });
      if (result.status !== 0) {
        throw new Error(`git apply failed: ${(result.stderr ?? "").toString().slice(0, 200)}`);
      }
    }
  } finally {
    try { fs.unlinkSync(tmpPatch); } catch { /**/ }
  }
}

export function removeWorktree(repoPath: string, worktree: Worktree): void {
  let result = spawnSync("git", ["worktree", "remove", "--force", worktree.path], { cwd: repoPath, ...SPAWN_OPTS });
  if (result.status !== 0) {
    try { fs.rmSync(worktree.path, { recursive: true, force: true }); } catch { /**/ }
    spawnSync("git", ["worktree", "prune"], { cwd: repoPath, ...SPAWN_OPTS });
  }
  spawnSync("git", ["branch", "-D", worktree.branch], { cwd: repoPath, ...SPAWN_OPTS });
}

export function removeAll(repoPath: string): void {
  const dir = path.join(repoPath, ".council-worktrees");
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  spawnSync("git", ["worktree", "prune"], { cwd: repoPath, ...SPAWN_OPTS });
  try {
    const result = spawnSync("git", ["branch"], { cwd: repoPath, encoding: "utf-8", timeout: GIT_TIMEOUT });
    for (const line of (result.stdout ?? "").split("\n")) {
      const b = line.trim().replace(/^\*\s*/, "");
      if (b.startsWith("council/")) {
        spawnSync("git", ["branch", "-D", b], { cwd: repoPath, ...SPAWN_OPTS });
      }
    }
  } catch { /**/ }
}

export function findRepoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8", timeout: GIT_TIMEOUT });
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error("Not inside a git repository");
  }
  return result.stdout.trim();
}
