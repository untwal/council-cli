import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the https module before importing client
vi.mock("https", () => ({
  request: vi.fn(),
}));

import * as https from "https";
import { anthropicChat, openaiChat, type ChatMessage, type Tool } from "../api/client";

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
];

function mockHttpResponse(statusCode: number, body: string): void {
  const mockReq = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
  };

  (https.request as ReturnType<typeof vi.fn>).mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
    const mockRes = {
      statusCode,
      on: vi.fn((event: string, handler: (data?: string) => void) => {
        if (event === "data") handler(body);
        if (event === "end") handler();
      }),
    };
    callback(mockRes);
    return mockReq;
  });
}

describe("anthropicChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends standard payload without reasoning", async () => {
    const responseBody = JSON.stringify({
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ];

    const result = await anthropicChat("test-key", "claude-sonnet-4-6", messages, TOOLS);

    expect(result.content).toBe("Hello!");
    expect(result.stop).toBe(true);

    // Verify the payload sent
    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.model).toBe("claude-sonnet-4-6");
    expect(payload.max_tokens).toBe(8192);
    expect(payload.thinking).toBeUndefined();
  });

  it("sends thinking payload with reasoning enabled", async () => {
    const responseBody = JSON.stringify({
      content: [
        { type: "thinking", thinking: "Let me think about this..." },
        { type: "text", text: "Here is my answer." },
      ],
      stop_reason: "end_turn",
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Solve this" },
    ];

    const result = await anthropicChat("test-key", "claude-opus-4-6", messages, TOOLS, {
      reasoning: true,
    });

    expect(result.content).toBe("Here is my answer.");

    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
    expect(payload.max_tokens).toBe(32000 + 8192);
  });

  it("uses custom budget_tokens when provided", async () => {
    const responseBody = JSON.stringify({
      content: [{ type: "text", text: "Done" }],
      stop_reason: "end_turn",
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];

    await anthropicChat("test-key", "claude-opus-4-6", messages, TOOLS, {
      reasoning: true,
      budgetTokens: 16000,
    });

    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.thinking).toEqual({ type: "enabled", budget_tokens: 16000 });
    expect(payload.max_tokens).toBe(16000 + 8192);
  });

  it("skips thinking blocks in response and returns text", async () => {
    const responseBody = JSON.stringify({
      content: [
        { type: "thinking", thinking: "Internal reasoning..." },
        { type: "text", text: "User-facing answer" },
      ],
      stop_reason: "end_turn",
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Think hard" }];
    const result = await anthropicChat("test-key", "claude-opus-4-6", messages, TOOLS, { reasoning: true });

    // Should return text block, not thinking block
    expect(result.content).toBe("User-facing answer");
  });

  it("handles tool_use response", async () => {
    const responseBody = JSON.stringify({
      content: [
        { type: "tool_use", id: "call-1", name: "read_file", input: { path: "/tmp/file.txt" } },
      ],
      stop_reason: "tool_use",
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Read a file" }];
    const result = await anthropicChat("test-key", "claude-sonnet-4-6", messages, TOOLS);

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].function.name).toBe("read_file");
    expect(JSON.parse(result.tool_calls[0].function.arguments)).toEqual({ path: "/tmp/file.txt" });
    expect(result.stop).toBe(false);
  });
});

describe("openaiChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses max_tokens for non-reasoning models", async () => {
    const responseBody = JSON.stringify({
      choices: [{ message: { content: "Hi!" }, finish_reason: "stop" }],
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    await openaiChat("test-key", "gpt-4o", messages, TOOLS);

    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.max_tokens).toBe(8192);
    expect(payload.tool_choice).toBe("auto");
    expect(payload.max_completion_tokens).toBeUndefined();
  });

  it("uses max_completion_tokens for reasoning models (o3)", async () => {
    const responseBody = JSON.stringify({
      choices: [{ message: { content: "Reasoned answer" }, finish_reason: "stop" }],
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Think" }];
    await openaiChat("test-key", "o3-mini", messages, TOOLS);

    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.max_completion_tokens).toBe(8192);
    expect(payload.max_tokens).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it("detects o1 as reasoning model", async () => {
    const responseBody = JSON.stringify({
      choices: [{ message: { content: "Answer" }, finish_reason: "stop" }],
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    await openaiChat("test-key", "o1-preview", messages, TOOLS);

    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.max_completion_tokens).toBe(8192);
  });

  it("detects o4 as reasoning model", async () => {
    const responseBody = JSON.stringify({
      choices: [{ message: { content: "Answer" }, finish_reason: "stop" }],
    });
    mockHttpResponse(200, responseBody);

    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    await openaiChat("test-key", "o4-mini", messages, TOOLS);

    const writeCall = (https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write;
    const payload = JSON.parse(writeCall.mock.calls[0][0]);
    expect(payload.max_completion_tokens).toBe(8192);
  });
});
