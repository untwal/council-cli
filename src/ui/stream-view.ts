/**
 * Real-time streaming view — shows live output from multiple agents
 * simultaneously. Each agent gets a lane showing what it's doing RIGHT NOW.
 */
import { StreamEvent } from "../streaming";
import { EvalResult, EvalCheck } from "../eval";
import {
  RST, BOLD, DIM, FG, BOX, ICON,
  agentColor, elapsed, progressBar, scoreBar, stripAnsi, padEnd,
} from "./theme";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface AgentLane {
  id: string;
  colorIndex: number;
  status: "running" | "done" | "error";
  lastText: string;
  lastTool: string;
  toolCount: number;
  startTime: number;
  tokenUsage: { input: number; output: number } | null;
}

export class StreamView {
  private lanes: Map<string, AgentLane> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private rendered = 0;
  private frame = 0;

  register(agentId: string, colorIndex: number): void {
    this.lanes.set(agentId, {
      id: agentId,
      colorIndex,
      status: "running",
      lastText: "",
      lastTool: "",
      toolCount: 0,
      startTime: Date.now(),
      tokenUsage: null,
    });
  }

  handleEvent(agentId: string, event: StreamEvent): void {
    const lane = this.lanes.get(agentId);
    if (!lane) return;

    switch (event.type) {
      case "text":
        lane.lastText = event.text ?? "";
        break;
      case "tool_call":
        lane.lastTool = `${event.toolName}(${(event.toolArgs ?? "").slice(0, 40)})`;
        lane.toolCount++;
        break;
      case "tool_result":
        // Just update tool count display
        break;
      case "done":
        lane.status = "done";
        if (event.tokenUsage) lane.tokenUsage = event.tokenUsage;
        break;
      case "error":
        lane.status = "error";
        lane.lastText = event.text ?? "Failed";
        break;
    }

    this.render();
  }

  start(): void {
    this.render();
    this.timer = setInterval(() => { this.frame++; this.render(); }, 80);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clear();
  }

  private clear(): void {
    if (this.rendered > 0) {
      process.stdout.write(`\x1b[${this.rendered}A\x1b[0J`);
      this.rendered = 0;
    }
  }

  private render(): void {
    this.clear();
    const lines: string[] = [];
    const w = Math.min(process.stdout.columns ?? 80, 76);

    // Header
    const total = this.lanes.size;
    const doneCount = [...this.lanes.values()].filter((l) => l.status !== "running").length;
    lines.push(`  ${FG.gray}${BOX.tl}${BOX.h.repeat(w - 4)}${BOX.tr}${RST}`);
    lines.push(`  ${FG.gray}${BOX.v}${RST}  ${BOLD}Live${RST}  ${progressBar(doneCount / total, 16)}  ${DIM}${doneCount}/${total} complete${RST}${" ".repeat(Math.max(0, w - 42))}${FG.gray}${BOX.v}${RST}`);
    lines.push(`  ${FG.gray}${BOX.bl}${BOX.h.repeat(w - 4)}${BOX.br}${RST}`);

    // Agent lanes
    for (const lane of this.lanes.values()) {
      const color = agentColor(lane.colorIndex);
      const time = elapsed(Date.now() - lane.startTime);

      let statusIcon: string;
      if (lane.status === "done") {
        statusIcon = `${FG.brightGreen}${ICON.check}${RST}`;
      } else if (lane.status === "error") {
        statusIcon = `${FG.brightRed}${ICON.cross}${RST}`;
      } else {
        statusIcon = `${color}${SPINNER[this.frame % SPINNER.length]}${RST}`;
      }

      const tokens = lane.tokenUsage
        ? `  ${DIM}${lane.tokenUsage.input + lane.tokenUsage.output} tok${RST}`
        : "";
      const tools = lane.toolCount > 0
        ? `  ${DIM}${lane.toolCount} tools${RST}`
        : "";

      lines.push("");
      lines.push(`  ${statusIcon} ${color}${BOLD}${lane.id}${RST}  ${DIM}${time}${RST}${tools}${tokens}`);

      // Show what the agent is doing right now
      if (lane.status === "running") {
        if (lane.lastTool) {
          lines.push(`    ${FG.brightBlue}${ICON.gear}${RST} ${DIM}${lane.lastTool.slice(0, w - 10)}${RST}`);
        }
        if (lane.lastText) {
          const textLine = lane.lastText.replace(/\n/g, " ").slice(0, w - 8);
          lines.push(`    ${DIM}${textLine}${RST}`);
        }
      } else if (lane.status === "done") {
        if (lane.lastText) {
          const textLine = lane.lastText.replace(/\n/g, " ").slice(0, w - 8);
          lines.push(`    ${DIM}${textLine}${RST}`);
        }
      } else {
        lines.push(`    ${FG.brightRed}${lane.lastText.slice(0, w - 8)}${RST}`);
      }
    }

    lines.push("");
    process.stdout.write(lines.join("\n") + "\n");
    this.rendered = lines.length;
  }
}

// ── Eval results display ─────────────────────────────────────────────────────

export function printEvalResults(results: EvalResult[]): void {
  console.log();
  console.log(`  ${BOLD}${ICON.target} Evaluation Results${RST}`);
  console.log(`  ${DIM}${BOX.h.repeat(60)}${RST}`);
  console.log();

  for (const result of results) {
    const allPassed = result.allPassed;
    const icon = allPassed
      ? `${FG.brightGreen}${ICON.check}${RST}`
      : `${FG.brightRed}${ICON.cross}${RST}`;
    const passCount = result.checks.filter((c) => c.passed).length;

    console.log(`  ${icon} ${BOLD}${result.agentId}${RST}  ${passCount}/${result.checks.length} passed  ${DIM}${elapsed(result.totalDurationMs)}${RST}`);

    for (const check of result.checks) {
      const checkIcon = check.passed
        ? `${FG.brightGreen}${ICON.check}${RST}`
        : `${FG.brightRed}${ICON.cross}${RST}`;
      console.log(`    ${checkIcon} ${DIM}${check.command}${RST}  ${DIM}${elapsed(check.durationMs)}${RST}`);

      if (!check.passed && check.output) {
        // Show first few lines of error output
        const errorLines = check.output.split("\n").slice(0, 5);
        for (const line of errorLines) {
          console.log(`      ${FG.brightRed}${line.slice(0, 70)}${RST}`);
        }
      }
    }
    console.log();
  }

  // Summary
  const allPassed = results.every((r) => r.allPassed);
  if (allPassed) {
    console.log(`  ${FG.brightGreen}${ICON.check} All agents passed evaluation${RST}`);
  } else {
    const passed = results.filter((r) => r.allPassed).map((r) => r.agentId);
    const failed = results.filter((r) => !r.allPassed).map((r) => r.agentId);
    if (passed.length > 0) {
      console.log(`  ${FG.brightGreen}${ICON.check} Passed:${RST} ${passed.join(", ")}`);
    }
    if (failed.length > 0) {
      console.log(`  ${FG.brightRed}${ICON.cross} Failed:${RST} ${failed.join(", ")}`);
    }
  }
  console.log();
}
