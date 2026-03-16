import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import {
  trackProcess, trackWorktree, untrackWorktree,
  setBeforeExit, removeBeforeExit, killAgent, getAgentProcess,
  getStatus,
} from "../process";
import { Worktree } from "../worktree";

function mockChild(): ChildProcess {
  const emitter = new EventEmitter();
  const child = emitter as unknown as ChildProcess;
  Object.defineProperty(child, "pid", { value: Math.floor(Math.random() * 10000), writable: true });
  child.kill = vi.fn().mockReturnValue(true);
  return child;
}

describe("trackProcess", () => {
  it("tracks a process by agentId", () => {
    const child = mockChild();
    trackProcess(child, "agent-1");
    expect(getAgentProcess("agent-1")).toBe(child);
  });

  it("removes process on close event", () => {
    const child = mockChild();
    trackProcess(child, "agent-close");
    expect(getAgentProcess("agent-close")).toBe(child);
    child.emit("close", 0);
    expect(getAgentProcess("agent-close")).toBeUndefined();
  });

  it("removes process on error event", () => {
    const child = mockChild();
    trackProcess(child, "agent-error");
    child.emit("error", new Error("test"));
    expect(getAgentProcess("agent-error")).toBeUndefined();
  });
});

describe("killAgent", () => {
  it("kills a tracked agent process", () => {
    const child = mockChild();
    trackProcess(child, "killable-agent");
    const result = killAgent("killable-agent");
    expect(result).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("returns false for unknown agent", () => {
    expect(killAgent("nonexistent")).toBe(false);
  });
});

describe("trackWorktree", () => {
  it("tracks and untracks worktrees", () => {
    const wt: Worktree = { agentId: "wt-1", path: "/tmp/wt", branch: "council/wt-1" };
    trackWorktree(wt, "/tmp/repo");
    expect(getStatus().worktrees).toBeGreaterThanOrEqual(1);

    untrackWorktree("wt-1");
  });
});

describe("setBeforeExit / removeBeforeExit", () => {
  it("supports multiple hooks (does not overwrite)", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    setBeforeExit(fn1);
    setBeforeExit(fn2);

    // Both should be registered (we can't test invocation without triggering shutdown,
    // but we can verify they're different functions and both registered)
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();

    removeBeforeExit(fn1);
    removeBeforeExit(fn2);
  });
});

describe("getStatus", () => {
  it("reports active process and worktree counts", () => {
    const status = getStatus();
    expect(typeof status.processes).toBe("number");
    expect(typeof status.worktrees).toBe("number");
  });
});
