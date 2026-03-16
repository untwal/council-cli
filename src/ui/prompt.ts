import * as readline from "readline";
import { RST, BOLD, DIM, FG, ICON, agentColor } from "./theme";
import { ModelDef } from "../models";

export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

export function prompt(question: string, defaultAnswer = ""): Promise<string> {
  if (!isTTY()) return Promise.resolve(defaultAnswer);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.on("close", () => resolve(defaultAnswer)); // handle EOF/error
    rl.question(`  ${FG.brightCyan}${ICON.arrowR}${RST} ${question}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await prompt(`${question} ${DIM}${hint}${RST} `, defaultYes ? "y" : "n");
  return answer.toLowerCase() !== (defaultYes ? "n" : "y") && answer !== "";
}

export async function selectAgents(available: ModelDef[]): Promise<ModelDef[]> {
  // Non-TTY (e.g. Claude CLI custom command): pick one model per unique CLI runner
  // to get cross-provider comparison instead of always defaulting to first 2
  if (!isTTY()) {
    return pickDiverseDefaults(available);
  }

  console.log();
  console.log(`  ${BOLD}Available agents:${RST}`);
  console.log();

  const cliRunners = new Set(["claude", "codex", "iloom"]);
  available.forEach((m, i) => {
    const color = agentColor(i);
    const isCli = cliRunners.has(m.cli);
    const badge = isCli ? `${FG.brightGreen}CLI${RST}` : `${FG.brightYellow}API${RST}`;
    const hint = m.cli === "iloom" ? "swarm pipeline" : `${m.cli} ${ICON.arrow} ${m.model}`;
    const reasoning = m.reasoning ? ` ${FG.brightMagenta}⚡reasoning${RST}` : "";
    console.log(`  ${color}${BOLD}[${i + 1}]${RST}  ${badge} ${BOLD}${m.label}${RST}${reasoning}  ${DIM}${hint}${RST}`);
  });

  console.log();
  const input = await prompt(`Select agents ${DIM}(space-separated numbers, Enter for diverse defaults)${RST}: `);

  if (!input) return pickDiverseDefaults(available);

  const selected = input
    .split(/[\s,]+/)
    .map((n) => parseInt(n, 10) - 1)
    .filter((i) => i >= 0 && i < available.length)
    .map((i) => available[i]);

  if (selected.length < 2) {
    console.log(`  ${FG.brightYellow}${ICON.warning}${RST} Need at least 2 agents. Selecting diverse defaults.`);
    return pickDiverseDefaults(available);
  }

  return selected;
}

/**
 * Pick diverse defaults — one model per unique provider/CLI runner.
 * Prefers non-reasoning variants to keep costs down for auto-selection.
 * Falls back to first 2 if only one provider is available.
 */
export function pickDiverseDefaults(available: ModelDef[]): ModelDef[] {
  // Group by provider (cli runner), skip reasoning variants for defaults
  const providerMap = new Map<string, ModelDef>();
  for (const m of available) {
    if (m.reasoning) continue;  // skip reasoning for auto-defaults
    if (!providerMap.has(m.cli)) {
      providerMap.set(m.cli, m);
    }
  }

  const diverse = Array.from(providerMap.values());
  if (diverse.length >= 2) return diverse;

  // Only one provider — pick first 2 distinct (non-reasoning) models
  const nonReasoning = available.filter((m) => !m.reasoning);
  if (nonReasoning.length >= 2) return [nonReasoning[0], nonReasoning[1]];

  // Absolute fallback
  return available.slice(0, 2);
}

export async function inputMultiline(label: string, placeholder?: string): Promise<string> {
  if (placeholder) {
    console.log(`  ${DIM}${placeholder}${RST}`);
  }
  return prompt(`${label}: `);
}
