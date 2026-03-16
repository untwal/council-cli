import { describe, it, expect } from "vitest";
import { pickDiverseDefaults } from "../ui/prompt";
import { ModelDef } from "../models";

function model(overrides: Partial<ModelDef> & { cli: string; model: string }): ModelDef {
  return {
    id: `${overrides.cli}:${overrides.model}`,
    label: overrides.label ?? overrides.model,
    cli: overrides.cli,
    model: overrides.model,
    reasoning: overrides.reasoning,
  };
}

describe("pickDiverseDefaults", () => {
  it("picks one model per unique provider", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
      model({ cli: "claude", model: "claude-opus-4-6" }),
      model({ cli: "codex", model: "o3-mini" }),
      model({ cli: "gemini-cli", model: "gemini-2.5-flash" }),
    ];

    const result = pickDiverseDefaults(available);
    expect(result).toHaveLength(3);
    const clis = result.map((r) => r.cli);
    expect(clis).toContain("claude");
    expect(clis).toContain("codex");
    expect(clis).toContain("gemini-cli");
  });

  it("picks first model from each provider", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
      model({ cli: "claude", model: "claude-opus-4-6" }),
      model({ cli: "codex", model: "gpt-4o" }),
      model({ cli: "codex", model: "o3-mini" }),
    ];

    const result = pickDiverseDefaults(available);
    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("claude-sonnet-4-6");
    expect(result[1].model).toBe("gpt-4o");
  });

  it("skips reasoning variants for auto-defaults", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-opus-4-6", reasoning: true }),
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
      model({ cli: "codex", model: "o3-mini" }),
    ];

    const result = pickDiverseDefaults(available);
    // Should pick sonnet (non-reasoning) over opus (reasoning)
    const claude = result.find((r) => r.cli === "claude");
    expect(claude?.model).toBe("claude-sonnet-4-6");
    expect(claude?.reasoning).toBeUndefined();
  });

  it("falls back to first 2 non-reasoning when only one provider", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
      model({ cli: "claude", model: "claude-opus-4-6" }),
      model({ cli: "claude", model: "claude-opus-4-6", reasoning: true }),
    ];

    const result = pickDiverseDefaults(available);
    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("claude-sonnet-4-6");
    expect(result[1].model).toBe("claude-opus-4-6");
    expect(result.every((r) => !r.reasoning)).toBe(true);
  });

  it("handles only reasoning models available", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-opus-4-6", reasoning: true }),
      model({ cli: "anthropic", model: "claude-opus-4-6", reasoning: true }),
    ];

    // All are reasoning, fallback to slice(0,2)
    const result = pickDiverseDefaults(available);
    expect(result).toHaveLength(2);
  });

  it("handles single model available", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
    ];

    const result = pickDiverseDefaults(available);
    expect(result).toHaveLength(1);
  });

  it("handles empty list", () => {
    const result = pickDiverseDefaults([]);
    expect(result).toHaveLength(0);
  });

  it("includes all provider types: CLI and API", () => {
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
      model({ cli: "anthropic", model: "claude-opus-4-6" }),
      model({ cli: "openai", model: "gpt-4o" }),
      model({ cli: "gemini", model: "gemini-2.0-flash" }),
    ];

    const result = pickDiverseDefaults(available);
    expect(result).toHaveLength(4);
  });

  it("prefers CLI runner when same provider has CLI and API", () => {
    // When sorted, CLI runners come first, so the first claude entry wins
    const available: ModelDef[] = [
      model({ cli: "claude", model: "claude-sonnet-4-6" }),
      model({ cli: "anthropic", model: "claude-sonnet-4-6" }),
      model({ cli: "codex", model: "o3-mini" }),
      model({ cli: "openai", model: "gpt-4o" }),
    ];

    const result = pickDiverseDefaults(available);
    // Should include all 4 since they have different cli runners
    expect(result).toHaveLength(4);
  });
});
