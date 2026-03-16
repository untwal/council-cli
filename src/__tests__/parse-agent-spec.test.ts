import { describe, it, expect } from "vitest";
import { parseAgentSpec, parseAgentSpecs } from "../parse-agent-spec";

describe("parseAgentSpec", () => {
  it("parses basic cli:model format", () => {
    const result = parseAgentSpec("claude:claude-sonnet-4-6");
    expect(result).toEqual({
      id: "claude:claude-sonnet-4-6",
      label: "claude-sonnet-4-6",
      cli: "claude",
      model: "claude-sonnet-4-6",
      reasoning: undefined,
    });
  });

  it("parses cli-only spec (model defaults to cli name)", () => {
    const result = parseAgentSpec("claude");
    expect(result).toEqual({
      id: "claude:claude",
      label: "claude",
      cli: "claude",
      model: "claude",
      reasoning: undefined,
    });
  });

  it("parses reasoning suffix", () => {
    const result = parseAgentSpec("claude:claude-opus-4-6:reasoning");
    expect(result).toEqual({
      id: "claude:claude-opus-4-6:reasoning",
      label: "claude-opus-4-6 (Reasoning)",
      cli: "claude",
      model: "claude-opus-4-6",
      reasoning: true,
    });
  });

  it("handles codex models", () => {
    const result = parseAgentSpec("codex:o3-mini");
    expect(result).toEqual({
      id: "codex:o3-mini",
      label: "o3-mini",
      cli: "codex",
      model: "o3-mini",
      reasoning: undefined,
    });
  });

  it("handles gemini-cli models", () => {
    const result = parseAgentSpec("gemini-cli:gemini-2.5-flash");
    expect(result).toEqual({
      id: "gemini-cli:gemini-2.5-flash",
      label: "gemini-2.5-flash",
      cli: "gemini-cli",
      model: "gemini-2.5-flash",
      reasoning: undefined,
    });
  });

  it("handles API-based runner specs", () => {
    const result = parseAgentSpec("anthropic:claude-opus-4-6");
    expect(result).toEqual({
      id: "anthropic:claude-opus-4-6",
      label: "claude-opus-4-6",
      cli: "anthropic",
      model: "claude-opus-4-6",
      reasoning: undefined,
    });
  });

  it("handles API-based runner with reasoning", () => {
    const result = parseAgentSpec("anthropic:claude-opus-4-6:reasoning");
    expect(result).toEqual({
      id: "anthropic:claude-opus-4-6:reasoning",
      label: "claude-opus-4-6 (Reasoning)",
      cli: "anthropic",
      model: "claude-opus-4-6",
      reasoning: true,
    });
  });

  it("does NOT treat random suffix as reasoning", () => {
    const result = parseAgentSpec("claude:claude-opus-4-6:other");
    expect(result.reasoning).toBeUndefined();
    expect(result.model).toBe("claude-opus-4-6:other");
  });

  it("handles openai API spec", () => {
    const result = parseAgentSpec("openai:gpt-4o");
    expect(result.cli).toBe("openai");
    expect(result.model).toBe("gpt-4o");
  });

  it("handles gemini API spec", () => {
    const result = parseAgentSpec("gemini:gemini-2.0-flash");
    expect(result.cli).toBe("gemini");
    expect(result.model).toBe("gemini-2.0-flash");
  });
});

describe("parseAgentSpecs", () => {
  it("parses comma-separated agent specs", () => {
    const result = parseAgentSpecs("claude:claude-sonnet-4-6,codex:o3-mini");
    expect(result).toHaveLength(2);
    expect(result[0].cli).toBe("claude");
    expect(result[0].model).toBe("claude-sonnet-4-6");
    expect(result[1].cli).toBe("codex");
    expect(result[1].model).toBe("o3-mini");
  });

  it("parses mixed reasoning and non-reasoning specs", () => {
    const result = parseAgentSpecs(
      "claude:claude-opus-4-6:reasoning,claude:claude-sonnet-4-6,codex:o3-mini"
    );
    expect(result).toHaveLength(3);
    expect(result[0].reasoning).toBe(true);
    expect(result[0].model).toBe("claude-opus-4-6");
    expect(result[1].reasoning).toBeUndefined();
    expect(result[2].reasoning).toBeUndefined();
  });

  it("parses single agent spec", () => {
    const result = parseAgentSpecs("claude:claude-opus-4-6");
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-opus-4-6");
  });

  it("works with config-style specs", () => {
    // Simulates .council.yml agents joined with commas
    const configAgents = ["claude:claude-sonnet-4-6", "gemini-cli:default", "claude:claude-opus-4-6:reasoning"];
    const result = parseAgentSpecs(configAgents.join(","));
    expect(result).toHaveLength(3);
    expect(result[0].cli).toBe("claude");
    expect(result[1].cli).toBe("gemini-cli");
    expect(result[1].model).toBe("default");
    expect(result[2].reasoning).toBe(true);
  });
});
