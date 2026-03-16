import { AgentResult } from "./agents";

// ANSI colours
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";

const AGENT_COLORS = [CYAN, MAGENTA, YELLOW, BLUE, GREEN];

export function agentColor(i: number): string {
  return AGENT_COLORS[i % AGENT_COLORS.length];
}

export function printHeader(): void {
  console.log(`\n${BOLD}⚖️  Council${R} — parallel agent comparison\n`);
}

export function printPlan(agents: { id: string; cli: string; model: string }[]): void {
  console.log(`${BOLD}Agents:${R}`);
  agents.forEach((a, i) => {
    console.log(`  ${agentColor(i)}●${R} ${BOLD}${a.id}${R}  ${DIM}${a.cli} --model ${a.model}${R}`);
  });
  console.log();
}

export function printLiveLine(agentId: string, agentIndex: number, line: string): void {
  const color = agentColor(agentIndex);
  const prefix = `${color}[${agentId}]${R}`;
  const cleaned = line.replace(/\x1b\[[0-9;]*m/g, ""); // strip nested colours
  console.log(`  ${prefix} ${DIM}${cleaned.slice(0, 120)}${R}`);
}

export function printDiffs(
  results: Array<{ agentId: string; diff: string; result: AgentResult }>
): void {
  console.log(`\n${"─".repeat(80)}`);
  console.log(`${BOLD}Results${R}\n`);

  for (let i = 0; i < results.length; i++) {
    const { agentId, diff, result } = results[i];
    const color = agentColor(i);
    const icon = result.status === "done" ? `${GREEN}✓${R}` : `${RED}✗${R}`;

    console.log(`${color}${"━".repeat(80)}${R}`);
    console.log(`${icon}  ${BOLD}${color}${agentId}${R}  ${DIM}(${result.status})${R}`);
    console.log(`${color}${"━".repeat(80)}${R}`);

    if (result.error) {
      console.log(`  ${RED}Error: ${result.error}${R}\n`);
      continue;
    }

    if (!diff.trim()) {
      console.log(`  ${DIM}No file changes${R}\n`);
      continue;
    }

    // Print coloured unified diff
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git") || line.startsWith("index ")) {
        console.log(`  ${DIM}${line}${R}`);
      } else if (line.startsWith("+++") || line.startsWith("---")) {
        console.log(`  ${BOLD}${line}${R}`);
      } else if (line.startsWith("+")) {
        console.log(`  ${GREEN}${line}${R}`);
      } else if (line.startsWith("-")) {
        console.log(`  ${RED}${line}${R}`);
      } else if (line.startsWith("@@")) {
        console.log(`  ${CYAN}${line}${R}`);
      } else {
        console.log(`  ${line}`);
      }
    }
    console.log();
  }

  // Summary table
  console.log(`${BOLD}Summary${R}`);
  for (let i = 0; i < results.length; i++) {
    const { agentId, diff, result } = results[i];
    const color = agentColor(i);
    const adds = (diff.match(/^\+(?!\+\+)/gm) ?? []).length;
    const dels = (diff.match(/^-(?!--)/gm) ?? []).length;
    const files = new Set(diff.match(/^diff --git .+ b\/(.+)$/gm) ?? []).size;
    const statusIcon = result.status === "done" ? `${GREEN}done${R}` : `${RED}error${R}`;
    console.log(
      `  ${color}${agentId.padEnd(30)}${R}  ${statusIcon}  ` +
      `${files} file(s)  ${GREEN}+${adds}${R}  ${RED}-${dels}${R}`
    );
  }
  console.log();
}

export function printError(msg: string): void {
  console.error(`\n${RED}Error: ${msg}${R}\n`);
}
