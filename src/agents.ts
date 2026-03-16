import { spawn } from "child_process";
import { Worktree } from "./worktree";
import { trackProcess } from "./process";

export type AgentStatus = "pending" | "running" | "done" | "error";

export interface AgentResult {
  agentId: string;
  status: AgentStatus;
  log: string[];
  error?: string;
}

export type LogCallback = (agentId: string, line: string) => void;

// ── CLI-based runners (spawn external binary) ────────────────────────────────

function runWithSpawn(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  agentId: string,
  onLog: LogCallback
): Promise<AgentResult> {
  return new Promise((resolve) => {
    const log: string[] = [];
    let buffer = "";

    const child = spawn(cmd, args, {
      cwd,
      env: env as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    trackProcess(child, agentId);

    function processChunk(chunk: Buffer): void {
      buffer += chunk.toString("utf8");
      if (buffer.length > 1024 * 1024) buffer = buffer.slice(-512 * 1024); // prevent OOM
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "").trimEnd();
        if (!line) continue;
        log.push(line);
        onLog(agentId, line);
      }
    }

    child.stdout?.on("data", processChunk);
    child.stderr?.on("data", processChunk);

    child.on("error", (err) => {
      resolve({ agentId, status: "error", log, error: err.message });
    });

    child.on("close", (code) => {
      if (buffer.trim()) {
        const line = buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "").trimEnd();
        if (line) { log.push(line); onLog(agentId, line); }
      }
      resolve({
        agentId,
        status: code === 0 ? "done" : "error",
        log,
        error: code !== 0 ? `Exit code ${code}` : undefined,
      });
    });
  });
}

export function runClaude(
  worktree: Worktree, task: string, model: string, onLog: LogCallback, opts?: AgentRunnerOpts
): Promise<AgentResult> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const args = ["--model", model, "--print", "--dangerously-skip-permissions"];
  if (opts?.reasoning) args.push("--effort", "max");
  args.push(task);
  return runWithSpawn("claude", args, worktree.path, env, worktree.agentId, onLog);
}

export function runCodex(
  worktree: Worktree, task: string, model: string, onLog: LogCallback
): Promise<AgentResult> {
  return runWithSpawn("codex",
    ["exec", "--model", model, "--dangerously-bypass-approvals-and-sandbox", task],
    worktree.path, { ...process.env }, worktree.agentId, onLog);
}

export function runGeminiCli(
  worktree: Worktree, task: string, model: string, onLog: LogCallback
): Promise<AgentResult> {
  const args: string[] = [];
  if (model && model !== "default") args.push("-m", model);
  args.push("-p", task, "--sandbox", "false");
  return runWithSpawn("gemini", args, worktree.path, { ...process.env }, worktree.agentId, onLog);
}

export function runIloom(
  worktree: Worktree, task: string, _model: string, onLog: LogCallback
): Promise<AgentResult> {
  return runWithSpawn("il", ["start", task],
    worktree.path, { ...process.env }, worktree.agentId, onLog);
}

// ── API-based runners (direct HTTP with agentic tool loop) ───────────────────

function runAnthropicApi(
  worktree: Worktree, task: string, model: string, onLog: LogCallback, opts?: AgentRunnerOpts
): Promise<AgentResult> {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) return Promise.resolve({ agentId: worktree.agentId, status: "error", log: [], error: "ANTHROPIC_API_KEY not set" });
  const { runApiAgent } = require("./api/runner");
  return runApiAgent(worktree, task, model, onLog, "anthropic", key, opts?.reasoning ? { reasoning: true } : undefined);
}

function runOpenAIApi(
  worktree: Worktree, task: string, model: string, onLog: LogCallback
): Promise<AgentResult> {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) return Promise.resolve({ agentId: worktree.agentId, status: "error", log: [], error: "OPENAI_API_KEY not set" });
  const { runApiAgent } = require("./api/runner");
  return runApiAgent(worktree, task, model, onLog, "openai", key);
}

function runGeminiApi(
  worktree: Worktree, task: string, model: string, onLog: LogCallback
): Promise<AgentResult> {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
  if (!key) return Promise.resolve({ agentId: worktree.agentId, status: "error", log: [], error: "GOOGLE_API_KEY not set" });
  const { runApiAgent } = require("./api/runner");
  return runApiAgent(worktree, task, model, onLog, "google", key);
}

// ── Runner dispatch ──────────────────────────────────────────────────────────

export interface AgentRunnerOpts {
  reasoning?: boolean;
}

export type AgentRunner = (
  worktree: Worktree, task: string, model: string, onLog: LogCallback, opts?: AgentRunnerOpts
) => Promise<AgentResult>;

export function getRunner(cli: string): AgentRunner {
  switch (cli) {
    case "claude":       return runClaude;
    case "codex":        return runCodex;
    case "gemini-cli":   return runGeminiCli;
    case "iloom":        return runIloom;
    case "anthropic":    return runAnthropicApi;
    case "openai":       return runOpenAIApi;
    case "gemini":       return runGeminiApi;
    default:             throw new Error(`Unknown agent type: ${cli}`);
  }
}

// ── Streaming dispatch ───────────────────────────────────────────────────────

export function hasStreamingSupport(cli: string): boolean {
  return ["claude", "codex", "gemini-cli"].includes(cli);
}
