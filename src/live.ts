import { agentColor } from "./display";

const R     = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const YELLOW= "\x1b[33m";

const STALE_WARN_MS  = 30_000;  // warn after 30s of silence
const STALE_ERROR_MS = 120_000; // flag as likely stuck after 2min

interface AgentState {
  id: string;
  colorIndex: number;
  status: "running" | "done" | "error";
  lastLine: string;
  lastActivity: number;
  startTime: number;
  linesReceived: number;
}

export class LiveDashboard {
  private agents: Map<string, AgentState> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private rendered = 0; // number of lines currently on screen

  register(agentId: string, colorIndex: number): void {
    this.agents.set(agentId, {
      id: agentId,
      colorIndex,
      status: "running",
      lastLine: "starting...",
      lastActivity: Date.now(),
      startTime: Date.now(),
      linesReceived: 0,
    });
  }

  update(agentId: string, line: string): void {
    const a = this.agents.get(agentId);
    if (!a) return;
    a.lastLine = line.replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 100);
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
    this.timer = setInterval(() => this.render(), 1000);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.clear();
  }

  private clear(): void {
    if (this.rendered === 0) return;
    process.stdout.write(`\x1b[${this.rendered}A\x1b[0J`); // move up N lines, clear to end
    this.rendered = 0;
  }

  private render(): void {
    this.clear();
    const lines: string[] = [];

    for (const a of this.agents.values()) {
      const color = agentColor(a.colorIndex);
      const elapsed = ((Date.now() - a.startTime) / 1000).toFixed(0);
      const silentMs = Date.now() - a.lastActivity;

      let statusIcon: string;
      let staleSuffix = "";

      if (a.status === "done") {
        statusIcon = `${GREEN}✓${R}`;
      } else if (a.status === "error") {
        statusIcon = `${RED}✗${R}`;
      } else if (silentMs > STALE_ERROR_MS) {
        statusIcon = `${RED}?${R}`;
        staleSuffix = `  ${RED}no output for ${Math.round(silentMs / 1000)}s — may be stuck${R}`;
      } else if (silentMs > STALE_WARN_MS) {
        statusIcon = `${YELLOW}~${R}`;
        staleSuffix = `  ${YELLOW}quiet for ${Math.round(silentMs / 1000)}s${R}`;
      } else {
        statusIcon = `${color}●${R}`;
      }

      const label  = `${color}${BOLD}${a.id}${R}`;
      const time   = `${DIM}${elapsed}s${R}`;
      const lineCount = `${DIM}(${a.linesReceived} lines)${R}`;
      const last   = `${DIM}${a.lastLine}${R}`;

      lines.push(`  ${statusIcon} ${label} ${time} ${lineCount}${staleSuffix}`);
      lines.push(`    ${last}`);
    }

    process.stdout.write(lines.join("\n") + "\n");
    this.rendered = lines.length;
  }
}
