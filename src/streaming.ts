/**
 * Streaming CLI runner — spawns claude/codex/gemini with streaming JSON output
 * and emits parsed events in real-time. This replaces the old fire-and-forget
 * spawn pattern with live streaming.
 */
import { spawn, ChildProcess } from "child_process";
import { Worktree } from "./worktree";
import { AgentResult, LogCallback } from "./agents";
import { trackProcess } from "./process";

export interface StreamEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  text?: string;
  toolName?: string;
  toolArgs?: string;
  result?: string;
  durationMs?: number;
  tokenUsage?: { input: number; output: number };
}

export type StreamCallback = (agentId: string, event: StreamEvent) => void;

// ── Claude streaming ─────────────────────────────────────────────────────────

export interface StreamOpts {
  reasoning?: boolean;
}

export function streamClaude(
  worktree: Worktree,
  task: string,
  model: string,
  onEvent: StreamCallback,
  onLog: LogCallback,
  opts?: StreamOpts
): Promise<AgentResult> {
  const env = { ...process.env } as Record<string, string>;
  delete env.CLAUDECODE;
  const args = [
    "--model", model,
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (opts?.reasoning) args.push("--effort", "max");
  args.push(task);
  return streamProcess("claude", args, worktree, env, onEvent, onLog, parseClaudeEvent);
}

// ── Codex streaming ──────────────────────────────────────────────────────────

export function streamCodex(
  worktree: Worktree,
  task: string,
  model: string,
  onEvent: StreamCallback,
  onLog: LogCallback
): Promise<AgentResult> {
  const args = ["exec", "--model", model, "--json", "--dangerously-bypass-approvals-and-sandbox", task];
  return streamProcess("codex", args, worktree, { ...process.env } as Record<string, string>, onEvent, onLog, parseCodexEvent);
}

// ── Gemini streaming ─────────────────────────────────────────────────────────

export function streamGemini(
  worktree: Worktree,
  task: string,
  model: string,
  onEvent: StreamCallback,
  onLog: LogCallback
): Promise<AgentResult> {
  const args: string[] = [];
  if (model && model !== "default") args.push("-m", model);
  args.push("-p", task, "--output-format", "stream-json", "--sandbox", "false");
  return streamProcess("gemini", args, worktree, { ...process.env } as Record<string, string>, onEvent, onLog, parseGeminiEvent);
}

// ── Generic streaming process runner ─────────────────────────────────────────

type EventParser = (json: Record<string, unknown>, agentId: string) => StreamEvent | null;

function streamProcess(
  cmd: string,
  args: string[],
  worktree: Worktree,
  env: Record<string, string>,
  onEvent: StreamCallback,
  onLog: LogCallback,
  parseEvent: EventParser
): Promise<AgentResult> {
  return new Promise((resolve) => {
    const agentId = worktree.agentId;
    const log: string[] = [];
    let buffer = "";

    const child = spawn(cmd, args, {
      cwd: worktree.path,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    trackProcess(child, agentId);

    function processLine(line: string): void {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Try to parse as JSON
      try {
        const json = JSON.parse(trimmed);
        const event = parseEvent(json, agentId);
        if (event) {
          onEvent(agentId, event);
          // Also emit to log for backward compatibility
          if (event.type === "text" && event.text) {
            const short = event.text.slice(0, 150);
            log.push(`[model] ${short}`);
            onLog(agentId, `[model] ${short}`);
          } else if (event.type === "tool_call") {
            const msg = `[tool] ${event.toolName}(${(event.toolArgs ?? "").slice(0, 80)})`;
            log.push(msg);
            onLog(agentId, msg);
          } else if (event.type === "tool_result") {
            const msg = `[result] ${(event.result ?? "").slice(0, 100)}`;
            log.push(msg);
            onLog(agentId, msg);
          }
        }
      } catch {
        // Not JSON — raw text output, strip ANSI
        const clean = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
        if (clean) {
          log.push(clean);
          onLog(agentId, clean);
          onEvent(agentId, { type: "text", text: clean });
        }
      }
    }

    const MAX_BUFFER = 1024 * 1024; // 1MB max buffer to prevent OOM

    function processChunk(chunk: Buffer): void {
      buffer += chunk.toString("utf8");
      // Prevent unbounded buffer growth
      if (buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(-MAX_BUFFER / 2);
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    }

    child.stdout?.on("data", processChunk);
    child.stderr?.on("data", (chunk: Buffer) => {
      // stderr might have non-JSON warnings — just log them
      const text = chunk.toString("utf8").trim();
      if (text) {
        log.push(`[stderr] ${text.slice(0, 200)}`);
      }
    });

    child.on("error", (err) => {
      onEvent(agentId, { type: "error", text: err.message });
      resolve({ agentId, status: "error", log, error: err.message });
    });

    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      onEvent(agentId, { type: "done" });
      resolve({
        agentId,
        status: code === 0 ? "done" : "error",
        log,
        error: code !== 0 ? `Exit code ${code}` : undefined,
      });
    });
  });
}

// ── Event parsers ────────────────────────────────────────────────────────────

function parseClaudeEvent(json: Record<string, unknown>, agentId: string): StreamEvent | null {
  const type = json.type as string;

  if (type === "assistant") {
    const msg = json.message as Record<string, unknown> | undefined;
    const content = msg?.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;

    for (const block of content) {
      if (block.type === "text") {
        return { type: "text", text: block.text as string };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_call",
          toolName: block.name as string,
          toolArgs: JSON.stringify(block.input ?? {}),
        };
      }
      if (block.type === "tool_result") {
        return { type: "tool_result", result: String(block.content ?? "") };
      }
    }
  }

  if (type === "result") {
    const usage = json.usage as Record<string, number> | undefined;
    return {
      type: "done",
      durationMs: json.duration_ms as number | undefined,
      tokenUsage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
    };
  }

  return null;
}

function parseCodexEvent(json: Record<string, unknown>, agentId: string): StreamEvent | null {
  const type = json.type as string;

  if (type === "item.completed") {
    const item = json.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message") {
      return { type: "text", text: item.text as string };
    }
    if (item?.type === "tool_call") {
      return {
        type: "tool_call",
        toolName: item.name as string ?? "unknown",
        toolArgs: item.arguments as string ?? "",
      };
    }
    if (item?.type === "tool_output") {
      return { type: "tool_result", result: item.output as string ?? "" };
    }
  }

  if (type === "turn.completed") {
    const usage = json.usage as Record<string, number> | undefined;
    return {
      type: "done",
      tokenUsage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
    };
  }

  return null;
}

function parseGeminiEvent(json: Record<string, unknown>, agentId: string): StreamEvent | null {
  const type = json.type as string;

  if (type === "message") {
    const role = json.role as string;
    if (role === "assistant") {
      return { type: "text", text: json.content as string ?? "" };
    }
  }

  if (type === "result") {
    const stats = json.stats as Record<string, number> | undefined;
    return {
      type: "done",
      durationMs: stats?.duration_ms,
      tokenUsage: stats ? { input: stats.input_tokens ?? 0, output: stats.output_tokens ?? 0 } : undefined,
    };
  }

  return null;
}
