/**
 * API-based agentic runner. Calls model APIs directly with a tool-use loop.
 * Supports both one-shot (compare/orchestrate) and multi-turn (chat) usage.
 */
import { Worktree } from "../worktree";
import { AgentResult, LogCallback } from "../agents";
import { anthropicChat, openaiChat, geminiChat, ChatMessage, ChatResponse, AnthropicChatOpts } from "./client";
import { TOOLS, executeTool } from "./tools";

const MAX_ITERATIONS = 30;

export type Vendor = "anthropic" | "openai" | "google";

// ── One-shot runner (for compare / orchestrate) ──────────────────────────────

export interface ApiAgentOpts {
  reasoning?: boolean;
}

export function runApiAgent(
  worktree: Worktree,
  task: string,
  model: string,
  onLog: LogCallback,
  vendor: Vendor,
  apiKey: string,
  opts?: ApiAgentOpts
): Promise<AgentResult> {
  return (async () => {
    const agentId = worktree.agentId;
    const log: string[] = [];
    const emit = (line: string) => { log.push(line); onLog(agentId, line); };

    const label = opts?.reasoning ? `${model} (${vendor} API, reasoning)` : `${model} (${vendor} API)`;
    emit(`Model: ${label}`);

    const systemPrompt = buildSystemPrompt(worktree.path);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task },
    ];

    const result = await runToolLoop(messages, worktree.path, model, vendor, apiKey, emit, opts);

    if (result.error) {
      return { agentId, status: "error" as const, log, error: result.error };
    }
    return { agentId, status: "done" as const, log };
  })();
}

// ── Multi-turn chat turn (for chat mode) ─────────────────────────────────────

export interface ChatTurnResult {
  assistantText: string;
  toolCalls: number;
  messages: ChatMessage[];
  error?: string;
}

/**
 * Run a single chat turn: append user message, execute tool loop, return
 * the updated message history and the assistant's final text.
 */
export async function runChatTurn(
  messages: ChatMessage[],
  userMessage: string,
  worktreePath: string,
  model: string,
  vendor: Vendor,
  apiKey: string,
  onLog: (line: string) => void,
  opts?: ApiAgentOpts
): Promise<ChatTurnResult> {
  messages.push({ role: "user", content: userMessage });

  const result = await runToolLoop(messages, worktreePath, model, vendor, apiKey, onLog, opts);

  return {
    assistantText: result.lastText,
    toolCalls: result.totalToolCalls,
    messages,
    error: result.error,
  };
}

// ── Core tool loop (shared) ──────────────────────────────────────────────────

interface LoopResult {
  lastText: string;
  totalToolCalls: number;
  error?: string;
}

async function runToolLoop(
  messages: ChatMessage[],
  worktreePath: string,
  model: string,
  vendor: Vendor,
  apiKey: string,
  emit: (line: string) => void,
  opts?: ApiAgentOpts
): Promise<LoopResult> {
  let lastText = "";
  let totalToolCalls = 0;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    emit(`[iteration ${i}]`);

    let response: ChatResponse;
    try {
      response = await callModel(vendor, apiKey, model, messages, opts);
    } catch (err) {
      emit(`[error] API call failed: ${err}`);
      return { lastText, totalToolCalls, error: String(err) };
    }

    if (response.content) {
      lastText = response.content;
      emit(`[model] ${response.content.slice(0, 200)}`);
    }

    messages.push({
      role: "assistant",
      content: response.content ?? "",
      tool_calls: response.tool_calls,
    });

    if (!response.tool_calls.length) {
      emit("Done — no more tool calls");
      return { lastText, totalToolCalls };
    }

    for (const call of response.tool_calls) {
      totalToolCalls++;
      let args: Record<string, string> = {};
      try { args = JSON.parse(call.function.arguments); } catch {
        emit(`[warn] Failed to parse tool arguments for ${call.function.name}: ${call.function.arguments.slice(0, 80)}`);
      }

      emit(`[tool] ${call.function.name}(${JSON.stringify(args).slice(0, 100)})`);
      const result = executeTool(call.function.name, args, worktreePath);
      emit(`[result] ${result.slice(0, 120)}${result.length > 120 ? "…" : ""}`);

      messages.push({ role: "tool", content: result, tool_call_id: call.id });
    }
  }

  emit(`Hit max iterations (${MAX_ITERATIONS})`);
  return { lastText, totalToolCalls };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function callModel(
  vendor: Vendor,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ApiAgentOpts
): Promise<ChatResponse> {
  switch (vendor) {
    case "anthropic": return anthropicChat(apiKey, model, messages, TOOLS, opts?.reasoning ? { reasoning: true } : undefined);
    case "openai":    return openaiChat(apiKey, model, messages, TOOLS);
    case "google":    return geminiChat(apiKey, model, messages, TOOLS);
    default:          throw new Error(`Unknown vendor: ${vendor}`);
  }
}

export function buildSystemPrompt(worktreePath: string): string {
  return `You are an expert software engineer working in an isolated git worktree.

Working directory: ${worktreePath}

Rules:
1. Read relevant files before modifying them.
2. Write complete file contents when using write_file — no placeholders or truncations.
3. Stop calling tools when the task is complete.
4. Make minimal, focused changes.
5. After making changes, do NOT call any more tools — just confirm what you did.
6. When asked a question that doesn't require code changes, just answer — no tool calls needed.`;
}
