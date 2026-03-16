/**
 * Global process manager — tracks child processes and worktrees per run,
 * handles signals, ensures cleanup on exit.
 *
 * Key design: all state is scoped by agentId so concurrent pipelines
 * (bot mode) don't conflict.
 */
import { ChildProcess } from "child_process";
import { Worktree, removeWorktree } from "./worktree";

// ── Per-agent process tracking ──────────────────────────────────────────────

const agentProcesses = new Map<string, ChildProcess>();
const activeWorktrees = new Map<string, { worktree: Worktree; repoPath: string }>();
const beforeExitHooks = new Set<() => void>();
let cleaningUp = false;

// ── Process Tracking ────────────────────────────────────────────────────────

export function trackProcess(child: ChildProcess, agentId?: string): void {
  if (agentId) agentProcesses.set(agentId, child);
  child.on("close", () => { if (agentId) agentProcesses.delete(agentId); });
  child.on("error", () => { if (agentId) agentProcesses.delete(agentId); });
}

export function trackWorktree(wt: Worktree, repo: string): void {
  activeWorktrees.set(wt.agentId, { worktree: wt, repoPath: repo });
}

export function untrackWorktree(agentId: string): void {
  activeWorktrees.delete(agentId);
}

/** Register a before-exit hook (appends, does not overwrite). */
export function setBeforeExit(fn: () => void): void {
  beforeExitHooks.add(fn);
}

/** Remove a specific before-exit hook. */
export function removeBeforeExit(fn: () => void): void {
  beforeExitHooks.delete(fn);
}

// ── Kill ────────────────────────────────────────────────────────────────────

/** Kill all tracked child processes. */
export function killAll(signal: NodeJS.Signals = "SIGTERM"): number {
  let killed = 0;
  for (const [id, child] of agentProcesses) {
    try {
      if (child.pid) {
        try { process.kill(-child.pid, signal); } catch { /**/ }
      }
      child.kill(signal);
      killed++;
    } catch { /**/ }
  }
  if (signal === "SIGKILL") agentProcesses.clear();
  return killed;
}

/** Kill a specific agent's process. */
export function killAgent(agentId: string): boolean {
  const child = agentProcesses.get(agentId);
  if (!child) return false;
  try {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /**/ }
    }
    child.kill("SIGTERM");
    agentProcesses.delete(agentId);
    return true;
  } catch {
    return false;
  }
}

/** Get the ChildProcess for a given agentId. */
export function getAgentProcess(agentId: string): ChildProcess | undefined {
  return agentProcesses.get(agentId);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function cleanupWorktrees(): void {
  for (const { worktree, repoPath: repo } of activeWorktrees.values()) {
    try { removeWorktree(repo, worktree); } catch { /**/ }
  }
  activeWorktrees.clear();
}

export async function gracefulShutdown(exitCode = 0): Promise<never> {
  if (cleaningUp) process.exit(exitCode);
  cleaningUp = true;

  // 1. Run all before-exit hooks
  for (const fn of beforeExitHooks) {
    try { fn(); } catch { /**/ }
  }
  beforeExitHooks.clear();

  // 2. Kill all child processes
  const killed = killAll("SIGTERM");
  if (killed > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killAll("SIGKILL");
        resolve();
      }, 2000);
      const check = setInterval(() => {
        if (agentProcesses.size === 0) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  // 3. Clean up worktrees
  cleanupWorktrees();

  process.exit(exitCode);
}

// ── Global Signal Handlers ──────────────────────────────────────────────────

let handlersInstalled = false;

export function installSignalHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  process.on("SIGINT", () => {
    console.log("\n  Interrupted — cleaning up...");
    gracefulShutdown(130);
  });

  process.on("SIGTERM", () => {
    gracefulShutdown(143);
  });

  process.on("SIGTSTP", () => {
    for (const fn of beforeExitHooks) { try { fn(); } catch { /**/ } }
    process.once("SIGCONT", () => {});
    process.kill(process.pid, "SIGTSTP");
  });

  process.on("uncaughtException", (err) => {
    console.error(`\n  Fatal: ${err.message}`);
    gracefulShutdown(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error(`\n  Unhandled rejection: ${reason}`);
    gracefulShutdown(1);
  });
}

// ── Status ──────────────────────────────────────────────────────────────────

export function getStatus(): { processes: number; worktrees: number } {
  return { processes: agentProcesses.size, worktrees: activeWorktrees.size };
}
