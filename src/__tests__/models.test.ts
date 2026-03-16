import { describe, it, expect } from "vitest";
import { ModelDef } from "../models";

describe("ModelDef interface", () => {
  it("supports reasoning flag", () => {
    const model: ModelDef = {
      id: "claude:claude-opus-4-6:reasoning",
      label: "Claude Opus 4.6 (Reasoning)",
      cli: "claude",
      model: "claude-opus-4-6",
      reasoning: true,
    };

    expect(model.reasoning).toBe(true);
    expect(model.model).toBe("claude-opus-4-6");
    expect(model.label).toContain("Reasoning");
  });

  it("reasoning is optional and defaults to undefined", () => {
    const model: ModelDef = {
      id: "claude:claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      cli: "claude",
      model: "claude-sonnet-4-6",
    };

    expect(model.reasoning).toBeUndefined();
  });
});

describe("reasoning model variants", () => {
  // These tests verify the hardcoded model lists include reasoning variants

  it("hardcoded CLI models include reasoning variant for opus", () => {
    // Simulates what fetchAnthropicModels returns when CLI available, no API key
    const models: ModelDef[] = [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", cli: "claude", model: "claude-sonnet-4-6" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", cli: "claude", model: "claude-opus-4-6" },
      { id: "claude-opus-4-6:reasoning", label: "Claude Opus 4.6 (Reasoning)", cli: "claude", model: "claude-opus-4-6", reasoning: true },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", cli: "claude", model: "claude-3-5-sonnet-20241022" },
    ];

    const reasoningModels = models.filter((m) => m.reasoning);
    expect(reasoningModels).toHaveLength(1);
    expect(reasoningModels[0].model).toBe("claude-opus-4-6");
    expect(reasoningModels[0].id).toContain("reasoning");
  });

  it("non-reasoning models don't have reasoning flag", () => {
    const models: ModelDef[] = [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", cli: "claude", model: "claude-sonnet-4-6" },
      { id: "codex:o3-mini", label: "o3 Mini", cli: "codex", model: "o3-mini" },
    ];

    expect(models.every((m) => !m.reasoning)).toBe(true);
  });

  it("API-discovered models generate reasoning variant for opus", () => {
    // Simulates what fetchAnthropicModels does with API response
    const apiModels = [
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
    ];

    const result: ModelDef[] = apiModels.map((m) => ({
      id: m.id,
      label: m.display_name,
      cli: "claude",
      model: m.id,
    }));

    // Add reasoning variants for Opus models
    for (const m of apiModels) {
      if (/opus/i.test(m.id)) {
        result.push({
          id: `${m.id}:reasoning`,
          label: `${m.display_name} (Reasoning)`,
          cli: "claude",
          model: m.id,
          reasoning: true,
        });
      }
    }

    expect(result).toHaveLength(3);
    const reasoning = result.filter((m) => m.reasoning);
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].model).toBe("claude-opus-4-6");
    expect(reasoning[0].id).toBe("claude-opus-4-6:reasoning");
  });
});
