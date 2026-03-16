import {
  RST, BOLD, DIM, FG, BOX, ICON,
  agentColor, progressBar, elapsed, stripAnsi, padEnd, truncate,
} from "./theme";

const STALE_WARN_MS  = 30_000;
const STALE_ERROR_MS = 120_000;

interface AgentState {
  id: string;
  colorIndex: number;
  status: "pending" | "running" | "done" | "error";
  lastLine: string;
  lastActivity: number;
  startTime: number;
  linesReceived: number;
  label?: string;
}

// Spinner frames for running agents
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class LiveDashboard {
  private agents: Map<string, AgentState> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private rendered = 0;
  private frame = 0;
  private title: string;

  constructor(title = "Running agents") {
    this.title = title;
  }

  register(agentId: string, colorIndex: number, label?: string): void {
    this.agents.set(agentId, {
      id: agentId,
      colorIndex,
      status: "pending",
      lastLine: "waiting...",
      lastActivity: Date.now(),
      startTime: Date.now(),
      linesReceived: 0,
      label,
    });
  }

  update(agentId: string, line: string): void {
    const a = this.agents.get(agentId);
    if (!a) return;
    a.status = "running";
    a.lastLine = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim().slice(0, 120);
    a.lastActivity = Date.now();
    a.linesReceived++;
    this.render();
  }

  done(agentId: string, status: "done" | "error"): void {
    const a = this.agents.get(agentId);
    if (!a) return;
    a.status = status;
    a.lastLine = status === "done" ? "finished" : "failed";
    this.render();
  }

  start(): void {
    this.render();
    this.timer = setInterval(() => {
      this.frame++;
      this.render();
    }, 80);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clear();
  }

  private clear(): void {
    if (this.rendered === 0) return;
    process.stdout.write(`\x1b[${this.rendered}A\x1b[0J`);
    this.rendered = 0;
  }

  private render(): void {
    this.clear();
    const lines: string[] = [];
    const total = this.agents.size;
    const doneCount = [...this.agents.values()].filter((a) => a.status === "done" || a.status === "error").length;
    const ratio = total > 0 ? doneCount / total : 0;

    // Title bar
    lines.push(`  ${FG.gray}${BOX.tl}${BOX.h.repeat(56)}${BOX.tr}${RST}`);
    lines.push(`  ${FG.gray}${BOX.v}${RST}  ${BOLD}${this.title}${RST}  ${progressBar(ratio, 20)}  ${DIM}${doneCount}/${total}${RST}${" ".repeat(Math.max(0, 18 - String(doneCount).length - String(total).length))}${FG.gray}${BOX.v}${RST}`);
    lines.push(`  ${FG.gray}${BOX.bl}${BOX.h.repeat(56)}${BOX.br}${RST}`);
    lines.push("");

    // Agent rows
    for (const a of this.agents.values()) {
      const color = agentColor(a.colorIndex);
      const time = elapsed(Date.now() - a.startTime);
      const silentMs = Date.now() - a.lastActivity;

      let statusIcon: string;
      let statusSuffix = "";

      if (a.status === "done") {
        statusIcon = `${FG.brightGreen}${ICON.check}${RST}`;
      } else if (a.status === "error") {
        statusIcon = `${FG.brightRed}${ICON.cross}${RST}`;
      } else if (a.status === "pending") {
        statusIcon = `${FG.gray}${ICON.circle}${RST}`;
      } else if (silentMs > STALE_ERROR_MS) {
        statusIcon = `${FG.brightRed}?${RST}`;
        statusSuffix = `  ${FG.brightRed}stuck ${Math.round(silentMs / 1000)}s${RST}`;
      } else if (silentMs > STALE_WARN_MS) {
        statusIcon = `${FG.brightYellow}~${RST}`;
        statusSuffix = `  ${FG.brightYellow}quiet ${Math.round(silentMs / 1000)}s${RST}`;
      } else {
        const spin = SPINNER[this.frame % SPINNER.length];
        statusIcon = `${color}${spin}${RST}`;
      }

      const label = a.label ?? a.id;
      const lineCount = `${DIM}${a.linesReceived} lines${RST}`;
      lines.push(`  ${statusIcon} ${color}${BOLD}${padEnd(label, 24)}${RST} ${DIM}${padEnd(time, 6)}${RST} ${lineCount}${statusSuffix}`);
      lines.push(`    ${DIM}${truncate(a.lastLine, 50)}${RST}`);
    }

    process.stdout.write(lines.join("\n") + "\n");
    this.rendered = lines.length;
  }
}
