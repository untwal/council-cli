/**
 * Shared agent spec parser — single source of truth for parsing agent specs
 * like "claude:claude-opus-4-6:reasoning" or "codex:o3-mini".
 *
 * Used by: --agents flag, .council.yml agents, config parsing.
 */
import { ModelDef } from "./models";

/**
 * Parse a single agent spec string into a ModelDef.
 *
 * Formats:
 *   cli:model            → { cli: "claude", model: "claude-opus-4-6" }
 *   cli:model:reasoning  → { cli: "claude", model: "claude-opus-4-6", reasoning: true }
 *   cli                  → { cli: "claude", model: "claude" }
 *
 * The ":reasoning" suffix is always the last segment and is stripped from the model name.
 */
export function parseAgentSpec(spec: string): ModelDef {
  const parts = spec.split(":");
  const cli = parts[0];
  const reasoning = parts.length >= 2 && parts[parts.length - 1] === "reasoning";
  const modelParts = reasoning ? parts.slice(1, -1) : parts.slice(1);
  const model = modelParts.join(":") || cli;
  const suffix = reasoning ? ":reasoning" : "";
  return {
    id: `${cli}:${model}${suffix}`,
    label: reasoning ? `${model} (Reasoning)` : model,
    cli,
    model,
    reasoning: reasoning || undefined,
  };
}

/**
 * Parse a comma-separated list of agent specs.
 */
export function parseAgentSpecs(input: string): ModelDef[] {
  return input.split(",").map(parseAgentSpec);
}
