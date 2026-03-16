import {
  RST, BOLD, DIM, ITAL, FG, BOX, ICON,
  bold, dim, colorize, agentColor, hr,
  box, scoreBar, progressBar, elapsed,
  stripAnsi, padEnd, center, termWidth,
} from "./theme";

// ── Header ───────────────────────────────────────────────────────────────────

export function printHeader(): void {
  const w = Math.min(termWidth(), 64);
  console.log();
  console.log(center(`${FG.brightCyan}${BOLD}${BOX.tl}${BOX.h.repeat(w - 4)}${BOX.tr}${RST}`, termWidth()));
  console.log(center(`${FG.brightCyan}${BOX.v}${RST}${" ".repeat(w - 4)}${FG.brightCyan}${BOX.v}${RST}`, termWidth()));
  console.log(center(`${FG.brightCyan}${BOX.v}${RST}   ${BOLD}${FG.brightWhite}${ICON.scales}  C O U N C I L${RST}${" ".repeat(w - 25)}${FG.brightCyan}${BOX.v}${RST}`, termWidth()));
  console.log(center(`${FG.brightCyan}${BOX.v}${RST}   ${DIM}Parallel AI Agent Orchestrator${RST}${" ".repeat(w - 37)}${FG.brightCyan}${BOX.v}${RST}`, termWidth()));
  console.log(center(`${FG.brightCyan}${BOX.v}${RST}${" ".repeat(w - 4)}${FG.brightCyan}${BOX.v}${RST}`, termWidth()));
  console.log(center(`${FG.brightCyan}${BOLD}${BOX.bl}${BOX.h.repeat(w - 4)}${BOX.br}${RST}`, termWidth()));
  console.log();
}

// ── Compare Mode ─────────────────────────────────────────────────────────────

export function printAgentPlan(agents: Array<{ id: string; cli: string; model: string }>): void {
  const lines = agents.map((a, i) => {
    const color = agentColor(i);
    const hint = a.cli === "iloom" ? "swarm pipeline" : a.model;
    return `${color}${ICON.bullet}${RST} ${bold(a.id)}  ${dim(hint)}`;
  }).join("\n");
  console.log(box(`${ICON.target} Agents`, lines));
  console.log();
}

export function printTask(task: string): void {
  console.log(`  ${FG.gray}${ICON.arrowR}${RST} ${bold("Task:")} ${task}`);
  console.log();
}

// ── Diff Display ─────────────────────────────────────────────────────────────

interface DiffResult {
  agentId: string;
  diff: string;
  result: { status: string; error?: string };
}

export function printDiffs(results: DiffResult[]): void {
  console.log();
  console.log(`  ${bold(`${ICON.chart} Results`)}`);
  console.log(`  ${dim(hr(BOX.h, 60))}`);
  console.log();

  for (let i = 0; i < results.length; i++) {
    const { agentId, diff, result } = results[i];
    const color = agentColor(i);
    const icon = result.status === "done" ? `${FG.brightGreen}${ICON.check}${RST}` : `${FG.brightRed}${ICON.cross}${RST}`;

    console.log(`  ${color}${BOLD}${BOX.h.repeat(3)} ${agentId} ${BOX.h.repeat(Math.max(1, 50 - agentId.length))}${RST}`);
    console.log(`  ${icon}  ${dim(`status: ${result.status}`)}`);

    if (result.error) {
      console.log(`  ${FG.brightRed}${result.error}${RST}`);
      console.log();
      continue;
    }

    if (!diff.trim()) {
      console.log(`  ${dim("No file changes")}`);
      console.log();
      continue;
    }

    // Print colorized diff
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git") || line.startsWith("index ")) {
        console.log(`  ${dim(line)}`);
      } else if (line.startsWith("+++") || line.startsWith("---")) {
        console.log(`  ${bold(line)}`);
      } else if (line.startsWith("+")) {
        console.log(`  ${FG.brightGreen}${line}${RST}`);
      } else if (line.startsWith("-")) {
        console.log(`  ${FG.brightRed}${line}${RST}`);
      } else if (line.startsWith("@@")) {
        console.log(`  ${FG.brightCyan}${line}${RST}`);
      } else {
        console.log(`  ${line}`);
      }
    }
    console.log();
  }

  // Summary table
  printSummaryTable(results);
}

function printSummaryTable(results: DiffResult[]): void {
  const w = 66;
  console.log(`  ${FG.gray}${BOX.tl}${BOX.h.repeat(w)}${BOX.tr}${RST}`);
  console.log(`  ${FG.gray}${BOX.v}${RST} ${bold(padEnd("Agent", 28))} ${padEnd("Status", 8)} ${padEnd("Files", 6)} ${padEnd("+Lines", 7)} ${padEnd("-Lines", 6)} ${FG.gray}${BOX.v}${RST}`);
  console.log(`  ${FG.gray}${BOX.ltee}${BOX.h.repeat(w)}${BOX.rtee}${RST}`);

  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < results.length; i++) {
    const { agentId, diff, result } = results[i];
    const color = agentColor(i);
    const adds = (diff.match(/^\+(?!\+\+)/gm) ?? []).length;
    const dels = (diff.match(/^-(?!--)/gm) ?? []).length;
    const files = new Set(diff.match(/^diff --git .+ b\/(.+)$/gm) ?? []).size;
    const statusIcon = result.status === "done" ? `${FG.brightGreen}done${RST}  ` : `${FG.brightRed}error${RST} `;

    // Simple heuristic: more additions + fewer deletions = more substantial work
    const score = files > 0 && result.status === "done" ? adds - dels * 0.5 + files * 10 : -1;
    if (score > bestScore) { bestScore = score; bestIdx = i; }

    const name = `${color}${ICON.bullet}${RST} ${padEnd(agentId, 26)}`;
    console.log(`  ${FG.gray}${BOX.v}${RST} ${name} ${statusIcon} ${padEnd(String(files), 6)} ${FG.brightGreen}${padEnd(`+${adds}`, 7)}${RST} ${FG.brightRed}${padEnd(`-${dels}`, 6)}${RST} ${FG.gray}${BOX.v}${RST}`);
  }

  console.log(`  ${FG.gray}${BOX.bl}${BOX.h.repeat(w)}${BOX.br}${RST}`);

  if (bestIdx >= 0 && results.length >= 2) {
    const winner = results[bestIdx];
    const color = agentColor(bestIdx);
    console.log();
    console.log(`  ${ICON.trophy} ${bold("Winner:")} ${color}${BOLD}${winner.agentId}${RST}`);
    console.log(`  ${dim(`Apply with:`)} ${bold(`council apply ${winner.agentId}`)}`);
  }
  console.log();
}

// ── Orchestrator UI ──────────────────────────────────────────────────────────

const PHASE_LABELS = ["Context", "Plan", "Approve", "Execute", "Review", "Merge", "Done"];

export function printPhaseBar(currentPhase: string): void {
  const phaseMap: Record<string, number> = {
    gathering_context: 0, planning: 1, awaiting_approval: 2,
    executing: 3, reviewing: 4, iterating: 4, merging: 5, complete: 6,
  };
  const idx = phaseMap[currentPhase] ?? -1;

  const parts = PHASE_LABELS.map((label, i) => {
    if (i < idx) return `${FG.brightGreen}${ICON.check} ${label}${RST}`;
    if (i === idx) return `${FG.brightCyan}${BOLD}${ICON.bullet} ${label}${RST}`;
    return `${DIM}${ICON.circle} ${label}${RST}`;
  });

  console.log(`  ${parts.join(`  ${FG.gray}${ICON.arrow}${RST}  `)}`);
  console.log();
}

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  category: string;
  assignedAgent: string;
  dependencies: string[];
  priority: number;
}

export interface Plan {
  summary: string;
  reasoning: string;
  tasks: PlanTask[];
  qualityCriteria: Record<string, string[]>;
}

export function printPlan(plan: Plan): void {
  // Summary box
  console.log(box(`${ICON.plan} Implementation Plan`, plan.summary));
  console.log();

  if (plan.reasoning) {
    console.log(`  ${FG.gray}${ICON.brain} ${ITAL}${plan.reasoning}${RST}`);
    console.log();
  }

  // Tasks
  console.log(`  ${bold("Subtasks:")}`);
  console.log();

  for (const task of plan.tasks) {
    const catColor = categoryColor(task.category);
    const deps = task.dependencies.length > 0
      ? `  ${dim(`deps: ${task.dependencies.join(", ")}`)}`
      : "";
    console.log(`  ${FG.gray}${task.id}${RST}  ${catColor}[${task.category}]${RST}  ${bold(task.title)}${deps}`);
    console.log(`  ${" ".repeat(task.id.length + 2)}${dim(task.description.slice(0, 80))}${task.description.length > 80 ? dim("…") : ""}`);
    if (task.assignedAgent) {
      console.log(`  ${" ".repeat(task.id.length + 2)}${dim(`${ICON.arrow} ${task.assignedAgent}`)}`);
    }
    console.log();
  }

  // Quality criteria
  if (plan.qualityCriteria && Object.keys(plan.qualityCriteria).length > 0) {
    console.log(`  ${bold("Quality Criteria:")}`);
    for (const [key, criteria] of Object.entries(plan.qualityCriteria)) {
      if (!Array.isArray(criteria) || criteria.length === 0) continue;
      console.log(`  ${FG.gray}${ICON.arrowR}${RST} ${bold(key)}: ${dim(criteria.join("; "))}`);
    }
    console.log();
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case "architecture": return FG.brightCyan;
    case "frontend":     return FG.brightMagenta;
    case "backend":      return FG.brightBlue;
    case "tests":        return FG.brightGreen;
    case "docs":         return FG.brightYellow;
    case "refactor":     return FG.yellow;
    default:             return FG.gray;
  }
}

export interface ReviewScore {
  codeQuality: number;
  correctness: number;
  completeness: number;
  maintainability: number;
  overall: number;
}

export function printReview(taskId: string, taskTitle: string, score: ReviewScore, feedback: string, passed: boolean): void {
  const icon = passed ? `${FG.brightGreen}${ICON.check}${RST}` : `${FG.brightRed}${ICON.cross}${RST}`;
  const overallColor = score.overall >= 7 ? FG.brightGreen : score.overall >= 5 ? FG.brightYellow : FG.brightRed;

  console.log(`  ${icon} ${bold(taskTitle)}  ${overallColor}${BOLD}${score.overall.toFixed(1)}/10${RST}`);
  console.log(`    ${scoreBar(score.overall, 20)}`);
  console.log(`    ${dim("code:")} ${score.codeQuality.toFixed(1)}  ${dim("correct:")} ${score.correctness.toFixed(1)}  ${dim("complete:")} ${score.completeness.toFixed(1)}  ${dim("maint:")} ${score.maintainability.toFixed(1)}`);
  if (feedback && !passed) {
    console.log(`    ${FG.brightYellow}${ICON.arrowR}${RST} ${dim(feedback.slice(0, 120))}${feedback.length > 120 ? dim("…") : ""}`);
  }
  console.log();
}

export function printDecision(phase: string, decision: string, reasoning: string): void {
  console.log(`  ${FG.gray}${ICON.gear}${RST} ${dim(`[${phase}]`)} ${decision}`);
  if (reasoning) {
    console.log(`    ${dim(reasoning.slice(0, 100))}${reasoning.length > 100 ? dim("…") : ""}`);
  }
}

export function printMergePreview(diffs: Array<{ taskTitle: string; files: number; additions: number; deletions: number }>): void {
  console.log();
  console.log(box(`${ICON.merge} Merge Preview`, diffs.map((d) =>
    `${bold(d.taskTitle)}  ${dim(`${d.files} files`)}  ${FG.brightGreen}+${d.additions}${RST}  ${FG.brightRed}-${d.deletions}${RST}`
  ).join("\n")));
  console.log();
}

export function printComplete(summary: string, totalTime: number): void {
  console.log();
  console.log(`  ${ICON.rocket} ${FG.brightGreen}${BOLD}Complete${RST}  ${dim(elapsed(totalTime))}`);
  console.log(`  ${dim(summary)}`);
  console.log();
}

export function printError(msg: string): void {
  console.error(`\n  ${FG.brightRed}${ICON.cross} Error:${RST} ${msg}\n`);
}

export function printInfo(msg: string): void {
  console.log(`  ${FG.brightCyan}${ICON.arrowR}${RST} ${msg}`);
}

export function printSuccess(msg: string): void {
  console.log(`  ${FG.brightGreen}${ICON.check}${RST} ${msg}`);
}

export function printWarning(msg: string): void {
  console.log(`  ${FG.brightYellow}${ICON.warning}${RST} ${msg}`);
}
