import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process.spawn
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock process tracker
vi.mock("../process", () => ({
  trackProcess: vi.fn(),
}));

import { spawn } from "child_process";
import { streamClaude, StreamEvent } from "../streaming";
import { Worktree } from "../worktree";

function createMockWorktree(): Worktree {
  return {
    path: "/tmp/test-worktree",
    agentId: "test-agent",
    branch: "test-branch",
  };
}

function setupMockSpawn(exitCode = 0): void {
  const mockChild = {
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === "data") {
          // Emit a simple JSON event
          handler(Buffer.from(JSON.stringify({ type: "result" }) + "\n"));
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === "close") {
        setTimeout(() => handler(exitCode), 10);
      }
    }),
  };

  (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
}

describe("streamClaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes standard args without reasoning", async () => {
    setupMockSpawn();
    const wt = createMockWorktree();
    const events: StreamEvent[] = [];

    await streamClaude(wt, "do something", "claude-sonnet-4-6", (_id, event) => events.push(event), () => {});

    const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(spawnCall[0]).toBe("claude");
    const args: string[] = spawnCall[1];
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--print");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--effort");
  });

  it("passes --effort max with reasoning enabled", async () => {
    setupMockSpawn();
    const wt = createMockWorktree();

    await streamClaude(wt, "think hard", "claude-opus-4-6", () => {}, () => {}, { reasoning: true });

    const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = spawnCall[1];
    expect(args).toContain("--effort");
    expect(args).toContain("max");

    // --effort max should appear before the task
    const effortIdx = args.indexOf("--effort");
    const taskIdx = args.indexOf("think hard");
    expect(effortIdx).toBeLessThan(taskIdx);
  });

  it("does not pass --effort when reasoning is false/undefined", async () => {
    setupMockSpawn();
    const wt = createMockWorktree();

    await streamClaude(wt, "simple task", "claude-sonnet-4-6", () => {}, () => {}, {});

    const args: string[] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).not.toContain("--effort");
  });

  it("removes CLAUDECODE env var", async () => {
    process.env.CLAUDECODE = "true";
    setupMockSpawn();
    const wt = createMockWorktree();

    await streamClaude(wt, "test", "claude-sonnet-4-6", () => {}, () => {});

    const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const env = spawnCall[2].env;
    expect(env.CLAUDECODE).toBeUndefined();

    delete process.env.CLAUDECODE;
  });

  it("sets working directory to worktree path", async () => {
    setupMockSpawn();
    const wt = createMockWorktree();

    await streamClaude(wt, "test", "claude-sonnet-4-6", () => {}, () => {});

    const spawnCall = (spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(spawnCall[2].cwd).toBe("/tmp/test-worktree");
  });
});
