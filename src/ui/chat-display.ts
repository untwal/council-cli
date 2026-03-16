import {
  RST, BOLD, DIM, FG, BOX, ICON,
  agentColor, stripAnsi, padEnd, elapsed, box,
} from "./theme";
import { ChatTurnResult } from "../api/runner";

// ── Response rendering ───────────────────────────────────────────────────────

export function printAgentResponse(
  agentId: string,
  colorIndex: number,
  result: ChatTurnResult,
  duration: number
): void {
  const color = agentColor(colorIndex);
  const w = Math.min(process.stdout.columns ?? 80, 78);
  const inner = w - 6;

  // Header
  const toolInfo = result.toolCalls > 0
    ? `  ${DIM}${result.toolCalls} tool call${result.toolCalls > 1 ? "s" : ""}${RST}`
    : "";
  const timeInfo = `${DIM}${elapsed(duration)}${RST}`;
  console.log();
  console.log(`  ${color}${BOLD}${BOX.tl}${BOX.h} ${agentId} ${BOX.h.repeat(Math.max(1, inner - agentId.length - 2))}${BOX.tr}${RST}`);

  // Body
  if (result.error) {
    const errLine = `${FG.brightRed}${ICON.cross} ${result.error}${RST}`;
    console.log(`  ${color}${BOX.v}${RST} ${errLine}`);
  } else if (result.assistantText) {
    const lines = wordWrap(result.assistantText, inner);
    for (const line of lines) {
      console.log(`  ${color}${BOX.v}${RST} ${line}`);
    }
  } else {
    console.log(`  ${color}${BOX.v}${RST} ${DIM}(no text response)${RST}`);
  }

  // Footer
  console.log(`  ${color}${BOLD}${BOX.bl}${BOX.h.repeat(inner + 2)}${BOX.br}${RST}  ${timeInfo}${toolInfo}`);
}

// ── Thinking indicator ───────────────────────────────────────────────────────

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class ThinkingIndicator {
  private agents: Array<{ id: string; colorIndex: number; done: boolean }> = [];
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private rendered = 0;

  add(agentId: string, colorIndex: number): void {
    this.agents.push({ id: agentId, colorIndex, done: false });
  }

  done(agentId: string): void {
    const a = this.agents.find((x) => x.id === agentId);
    if (a) a.done = true;
    this.render();
  }

  start(): void {
    this.render();
    this.timer = setInterval(() => { this.frame++; this.render(); }, 80);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clear();
    this.agents = [];
  }

  private clear(): void {
    if (this.rendered > 0) {
      process.stdout.write(`\x1b[${this.rendered}A\x1b[0J`);
      this.rendered = 0;
    }
  }

  private render(): void {
    this.clear();
    const parts = this.agents.map((a) => {
      const color = agentColor(a.colorIndex);
      if (a.done) return `  ${FG.brightGreen}${ICON.check}${RST} ${color}${a.id}${RST}`;
      const spin = SPINNER[this.frame % SPINNER.length];
      return `  ${color}${spin}${RST} ${color}${a.id}${RST} ${DIM}thinking...${RST}`;
    });
    const line = parts.join("   ");
    process.stdout.write(line + "\n");
    this.rendered = 1;
  }
}

// ── Diff summary for /compare ────────────────────────────────────────────────

export function printChatDiffSummary(
  agents: Array<{ id: string; colorIndex: number; diff: string }>
): void {
  console.log();
  console.log(`  ${BOLD}${ICON.chart} Changes by agent${RST}`);
  console.log(`  ${DIM}${BOX.h.repeat(60)}${RST}`);

  for (const a of agents) {
    const color = agentColor(a.colorIndex);
    if (!a.diff.trim()) {
      console.log(`  ${color}${ICON.bullet}${RST} ${BOLD}${a.id}${RST}  ${DIM}no changes${RST}`);
      continue;
    }
    const adds = (a.diff.match(/^\+(?!\+\+)/gm) ?? []).length;
    const dels = (a.diff.match(/^-(?!--)/gm) ?? []).length;
    const files = new Set(a.diff.match(/^diff --git /gm) ?? []).size;
    console.log(`  ${color}${ICON.bullet}${RST} ${BOLD}${a.id}${RST}  ${files} files  ${FG.brightGreen}+${adds}${RST}  ${FG.brightRed}-${dels}${RST}`);
  }
  console.log();
}

// ── Help ─────────────────────────────────────────────────────────────────────

export function printChatHelp(): void {
  console.log(`
  ${BOLD}Chat Commands${RST}

    ${FG.brightCyan}/diff${RST}              Show what each agent changed
    ${FG.brightCyan}/diff <agent>${RST}       Show diff for one agent
    ${FG.brightCyan}/apply <agent>${RST}      Apply an agent's changes to your working tree
    ${FG.brightCyan}/compare${RST}            Side-by-side summary of all agents' changes
    ${FG.brightCyan}/reset${RST}              Clear conversation history for all agents
    ${FG.brightCyan}/status${RST}             Show agent info and turn counts
    ${FG.brightCyan}/help${RST}               Show this help
    ${FG.brightCyan}/quit${RST}               Exit chat mode
  `);
}

// ── Welcome banner ───────────────────────────────────────────────────────────

export function printChatWelcome(agents: Array<{ id: string; colorIndex: number }>): void {
  const agentList = agents
    .map((a) => `${agentColor(a.colorIndex)}${ICON.bullet}${RST} ${BOLD}${a.id}${RST}`)
    .join("  ");

  console.log();
  console.log(`  ${BOLD}Chat mode${RST} — every message goes to all agents in parallel`);
  console.log(`  Agents: ${agentList}`);
  console.log(`  Type ${FG.brightCyan}/help${RST} for commands, ${FG.brightCyan}/quit${RST} to exit`);
  console.log();
}

// ── Utility ──────────────────────────────────────────────────────────────────

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current += (current ? " " : "") + word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}
