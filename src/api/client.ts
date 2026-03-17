/**
 * Direct API clients for Anthropic, OpenAI, and Google Gemini.
 * Ported from the VS Code extension — no vscode dependency.
 */
import * as https from "https";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tool {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatResponse {
  content: string | null;
  tool_calls: ToolCall[];
  stop: boolean;
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export interface AnthropicChatOpts {
  reasoning?: boolean;
  budgetTokens?: number;
}

export async function anthropicChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: Tool[],
  opts?: AnthropicChatOpts
): Promise<ChatResponse> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const filtered = messages.filter((m) => m.role !== "system");

  const anthropicMessages = filtered.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }],
      };
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.tool_calls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const anthropicTools = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const payload: Record<string, unknown> = { model, system, messages: anthropicMessages, tools: anthropicTools };
  if (opts?.reasoning) {
    const budgetTokens = opts.budgetTokens ?? 32000;
    payload.thinking = { type: "enabled", budget_tokens: budgetTokens };
    payload.max_tokens = budgetTokens + 8192;
  } else {
    payload.max_tokens = 8192;
  }
  const raw = await post("api.anthropic.com", "/v1/messages", JSON.stringify(payload), {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });

  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(`Anthropic: ${parsed.error.message}`);

  const content = parsed.content as Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: object }> ?? [];
  // Skip thinking blocks — they contain internal reasoning, not user-facing text
  const textBlock = content.find((b) => b.type === "text");
  const toolBlocks = content.filter((b) => b.type === "tool_use");

  return {
    content: textBlock?.text ?? null,
    tool_calls: toolBlocks.map((b) => ({
      id: b.id!,
      type: "function" as const,
      function: { name: b.name!, arguments: JSON.stringify(b.input) },
    })),
    stop: parsed.stop_reason === "end_turn" || toolBlocks.length === 0,
  };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

export async function openaiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: Tool[]
): Promise<ChatResponse> {
  const isReasoning = /^o[134]/.test(model);
  const payload: Record<string, unknown> = { model, messages, tools };
  if (!isReasoning) {
    payload.tool_choice = "auto";
    payload.max_tokens = 8192;
  } else {
    payload.max_completion_tokens = 8192;
  }

  const raw = await post("api.openai.com", "/v1/chat/completions", JSON.stringify(payload), {
    Authorization: `Bearer ${apiKey}`,
  });

  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(`OpenAI: ${parsed.error.message}`);

  const choices = parsed.choices as Array<{ message: { content?: string; tool_calls?: ToolCall[] }; finish_reason: string }> ?? [];
  const msg = choices[0]?.message;
  return {
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls ?? [],
    stop: choices[0]?.finish_reason === "stop" || !msg?.tool_calls?.length,
  };
}

// ── Google Gemini ────────────────────────────────────────────────────────────

export async function geminiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: Tool[]
): Promise<ChatResponse> {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const filtered = messages.filter((m) => m.role !== "system");

  const callIdToName: Record<string, string> = {};
  for (const m of filtered) {
    if (m.tool_calls) {
      for (const tc of m.tool_calls) callIdToName[tc.id] = tc.function.name;
    }
  }

  // Merge consecutive tool messages
  const merged: (ChatMessage & { _toolGroup?: ChatMessage[] })[] = [];
  for (const m of filtered) {
    if (m.role === "tool" && merged.length > 0 && merged[merged.length - 1].role === "tool") {
      merged[merged.length - 1]._toolGroup ??= [merged[merged.length - 1]];
      merged[merged.length - 1]._toolGroup!.push(m);
    } else {
      merged.push(m);
    }
  }

  const contents = merged.map((m) => {
    const group = m._toolGroup;
    if (m.role === "tool" && group) {
      return {
        role: "user",
        parts: group.map((tm) => ({
          functionResponse: {
            name: callIdToName[tm.tool_call_id ?? ""] ?? tm.tool_call_id ?? "",
            response: { result: tm.content },
          },
        })),
      };
    }
    if (m.role === "tool") {
      return {
        role: "user",
        parts: [{
          functionResponse: {
            name: callIdToName[m.tool_call_id ?? ""] ?? m.tool_call_id ?? "",
            response: { result: m.content },
          },
        }],
      };
    }
    if (m.tool_calls?.length) {
      return {
        role: "model",
        parts: m.tool_calls.map((tc) => ({
          functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) },
        })),
      };
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    };
  });

  const functionDeclarations = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));

  const body = {
    ...(systemMsg ? { system_instruction: { parts: [{ text: systemMsg }] } } : {}),
    contents,
    tools: [{ functionDeclarations }],
  };
  // Pass API key in header, not URL (prevents key leaking in logs/traces)
  const apiPath = `/v1beta/models/${model}:generateContent`;

  const raw = await post("generativelanguage.googleapis.com", apiPath, JSON.stringify(body), {
    "x-goog-api-key": apiKey,
  });

  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(`Gemini: ${parsed.error.message}`);

  const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: object } }> } }> ?? [];
  const parts = candidates[0]?.content?.parts ?? [];
  const textPart = parts.find((p) => p.text);
  const fnCalls = parts.filter((p) => p.functionCall);

  return {
    content: textPart?.text ?? null,
    tool_calls: fnCalls.map((p, i) => ({
      id: `gemini-call-${Date.now()}-${i}`,
      type: "function" as const,
      function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args) },
    })),
    stop: fnCalls.length === 0,
  };
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function post(
  hostname: string,
  path: string,
  body: string,
  extraHeaders: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            // Sanitize: don't expose full response which may contain sensitive data
            const safeMsg = data.includes("error") ? data.slice(0, 150).replace(/key["\s:]+["'][^"']+["']/gi, "key:[REDACTED]") : "";
            reject(new Error(`API request failed (HTTP ${res.statusCode})${safeMsg ? ": " + safeMsg : ""}`));
          } else {
            resolve(data);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error(`HTTP request timed out after 120s: ${hostname}${path}`));
    });
    req.write(body);
    req.end();
  });
}
