// ── ANSI Escape Sequences ────────────────────────────────────────────────────

export const RST  = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM  = "\x1b[2m";
export const ITAL = "\x1b[3m";
export const ULINE = "\x1b[4m";

// Foreground
export const FG = {
  black:   "\x1b[30m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  // Bright
  gray:      "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen:  "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue:   "\x1b[94m",
  brightMagenta:"\x1b[95m",
  brightCyan:   "\x1b[96m",
  brightWhite:  "\x1b[97m",
} as const;

// Background
export const BG = {
  black:   "\x1b[40m",
  red:     "\x1b[41m",
  green:   "\x1b[42m",
  yellow:  "\x1b[43m",
  blue:    "\x1b[44m",
  magenta: "\x1b[45m",
  cyan:    "\x1b[46m",
  white:   "\x1b[47m",
} as const;

// ── Agent Color Palette ──────────────────────────────────────────────────────

const AGENT_PALETTE = [
  FG.brightCyan,
  FG.brightMagenta,
  FG.brightYellow,
  FG.brightBlue,
  FG.brightGreen,
  FG.brightRed,
] as const;

export function agentColor(index: number): string {
  return AGENT_PALETTE[index % AGENT_PALETTE.length];
}

// ── Unicode Box Drawing ──────────────────────────────────────────────────────

export const BOX = {
  // Heavy
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
  ltee: "├", rtee: "┤", ttee: "┬", btee: "┴", cross: "┼",
  // Double
  dh: "═", dv: "║",
  dtl: "╔", dtr: "╗", dbl: "╚", dbr: "╝",
} as const;

// ── Block Elements ───────────────────────────────────────────────────────────

export const BLOCK = {
  full:    "█",
  shade3:  "▓",
  shade2:  "▒",
  shade1:  "░",
  left1:   "▏",
  left2:   "▎",
  left3:   "▍",
  left4:   "▌",
  left5:   "▋",
  left6:   "▊",
  left7:   "▉",
} as const;

// Fractional block elements for smooth progress bars
const PARTIALS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];

// ── Icons ────────────────────────────────────────────────────────────────────

export const ICON = {
  check:    "✓",
  cross:    "✗",
  bullet:   "●",
  circle:   "○",
  diamond:  "◆",
  arrow:    "→",
  arrowR:   "▸",
  dash:     "─",
  ellipsis: "…",
  star:     "★",
  sparkle:  "✦",
  warning:  "⚠",
  clock:    "⏱",
  gear:     "⚙",
  brain:    "🧠",
  rocket:   "🚀",
  scales:   "⚖️",
  chart:    "📊",
  plan:     "📋",
  merge:    "🔀",
  lock:     "🔒",
  target:   "🎯",
  trophy:   "🏆",
  fire:     "🔥",
} as const;

// ── High-Level Formatting ────────────────────────────────────────────────────

export function bold(s: string): string { return `${BOLD}${s}${RST}`; }
export function dim(s: string): string { return `${DIM}${s}${RST}`; }
export function italic(s: string): string { return `${ITAL}${s}${RST}`; }

export function colorize(s: string, color: string): string {
  return `${color}${s}${RST}`;
}

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

export function hr(char = BOX.h, width?: number): string {
  return char.repeat(width ?? termWidth());
}

/** Smooth progress bar with fractional Unicode blocks */
export function progressBar(ratio: number, width = 20, filled: string = FG.brightCyan, empty: string = FG.gray): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const total = width;
  const complete = clamped * total;
  const fullBlocks = Math.floor(complete);
  const partialIdx = Math.round((complete - fullBlocks) * 8);

  let bar = "";
  bar += filled + BLOCK.full.repeat(fullBlocks);
  if (fullBlocks < total) {
    bar += PARTIALS[partialIdx];
    bar += empty + BLOCK.shade1.repeat(total - fullBlocks - 1);
  }
  bar += RST;
  return bar;
}

/** Score bar: 0-10, colored green/yellow/red based on value */
export function scoreBar(score: number, width = 10): string {
  const ratio = score / 10;
  const color = score >= 7 ? FG.brightGreen : score >= 5 ? FG.brightYellow : FG.brightRed;
  return progressBar(ratio, width, color, FG.gray);
}

/** Box with title and content */
export function box(title: string, content: string, width?: number): string {
  const w = width ?? Math.min(termWidth() - 4, 72);
  const inner = w - 4;
  const lines: string[] = [];

  const titleStr = ` ${title} `;
  const topPad = inner - stripAnsi(titleStr).length;
  lines.push(`  ${FG.gray}${BOX.tl}${BOX.h}${RST}${BOLD}${titleStr}${RST}${FG.gray}${BOX.h.repeat(Math.max(0, topPad))}${BOX.tr}${RST}`);

  for (const line of content.split("\n")) {
    const stripped = stripAnsi(line);
    const pad = inner - stripped.length;
    lines.push(`  ${FG.gray}${BOX.v}${RST} ${line}${" ".repeat(Math.max(0, pad))} ${FG.gray}${BOX.v}${RST}`);
  }

  lines.push(`  ${FG.gray}${BOX.bl}${BOX.h.repeat(inner + 2)}${BOX.br}${RST}`);
  return lines.join("\n");
}

/** Format elapsed time prettily */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Strip ANSI escape codes for length calculation */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Truncate string to width, respecting ANSI codes */
export function truncate(s: string, maxWidth: number): string {
  const stripped = stripAnsi(s);
  if (stripped.length <= maxWidth) return s;
  // Simple truncation — works for most cases
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < maxWidth - 1) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visible++;
    i++;
  }
  return s.slice(0, i) + ICON.ellipsis + RST;
}

/** Pad string on the right, accounting for ANSI */
export function padEnd(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, width - visible));
}

/** Center string */
export function center(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  const pad = Math.max(0, Math.floor((width - visible) / 2));
  return " ".repeat(pad) + s;
}
