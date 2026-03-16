import { findRepoRoot } from "../worktree";
import { loadPipelineState, listPipelineRuns, PipelineState, RoleMetrics } from "../artifacts";
import { printInfo, printError, printSuccess, printWarning } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON, padEnd, elapsed } from "../ui/theme";

export async function runRetro(runIdArg: string | null): Promise<void> {
  const repoPath = findRepoRoot();

  // Resolve run
  let state: PipelineState | null = null;
  let runId = runIdArg ?? "latest";

  if (runId === "latest" || !runIdArg) {
    const runs = listPipelineRuns(repoPath);
    if (runs.length === 0) {
      printError("No pipeline runs found. Run a pipeline first with: council company \"feature\"");
      return;
    }
    const completed = runs.find((r) => r.state.finishedAt);
    const pick = completed ?? runs[0];
    state = pick.state;
    runId = pick.runId;
  } else {
    state = loadPipelineState(repoPath, runId);
  }

  if (!state) {
    printError(`No pipeline state found for: ${runId}`);
    return;
  }

  const totalMs = (state.finishedAt ?? Date.now()) - state.startedAt;
  const metrics = state.roleMetrics ?? [];

  // ── Header ────────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${BOLD}${ICON.brain} Retrospective${RST}`);
  console.log(`  ${DIM}${"─".repeat(60)}${RST}`);
  console.log();
  console.log(`  ${BOLD}Feature:${RST} ${state.featureRequest}`);
  console.log(`  ${BOLD}Run ID:${RST}  ${DIM}${runId}${RST}`);
  console.log(`  ${BOLD}Status:${RST}  ${state.accepted ? `${FG.brightGreen}Shipped${RST}` : `${FG.brightRed}Not Shipped${RST}`}`);
  console.log(`  ${BOLD}Total:${RST}   ${elapsed(totalMs)}`);
  console.log();

  // ── Timeline ──────────────────────────────────────────────────────────
  console.log(`  ${BOLD}${ICON.chart} Timeline${RST}`);
  console.log();

  if (metrics.length === 0) {
    printWarning("No timing data available for this run.");
    console.log();
  } else {
    const maxDuration = Math.max(...metrics.map((m) => m.durationMs));

    for (const m of metrics) {
      const barWidth = Math.max(1, Math.round((m.durationMs / maxDuration) * 30));
      const bar = "█".repeat(barWidth);
      const pct = totalMs > 0 ? Math.round((m.durationMs / totalMs) * 100) : 0;
      const roleLabel = padEnd(m.role, 12);
      const timeLabel = elapsed(m.durationMs);
      const retryLabel = m.retries > 0 ? ` ${FG.brightYellow}(${m.retries} retries)${RST}` : "";

      console.log(`  ${roleLabel} ${FG.brightCyan}${bar}${RST} ${timeLabel} ${DIM}(${pct}%)${RST}${retryLabel}`);
      console.log(`  ${" ".repeat(12)} ${DIM}${m.agent}${RST}`);
    }
    console.log();
  }

  // ── Bottleneck analysis ───────────────────────────────────────────────
  if (metrics.length >= 2) {
    const sorted = [...metrics].sort((a, b) => b.durationMs - a.durationMs);
    const slowest = sorted[0];
    const fastest = sorted[sorted.length - 1];

    console.log(`  ${BOLD}${ICON.target} Insights${RST}`);
    console.log();
    console.log(`  ${FG.brightRed}${ICON.arrowR}${RST} ${BOLD}Bottleneck:${RST} ${slowest.role} took ${elapsed(slowest.durationMs)} (${Math.round((slowest.durationMs / totalMs) * 100)}% of total)`);
    console.log(`  ${FG.brightGreen}${ICON.arrowR}${RST} ${BOLD}Fastest:${RST} ${fastest.role} took ${elapsed(fastest.durationMs)}`);

    // Retries
    const totalRetries = metrics.reduce((sum, m) => sum + m.retries, 0);
    if (totalRetries > 0) {
      console.log(`  ${FG.brightYellow}${ICON.arrowR}${RST} ${BOLD}Retries:${RST} ${totalRetries} total — CEO sent work back`);
    }
    console.log();
  }

  // ── Artifact summary ──────────────────────────────────────────────────
  console.log(`  ${BOLD}${ICON.plan} Artifacts${RST}`);
  console.log();

  for (const artifact of state.artifacts) {
    const sizeKb = (artifact.content.length / 1024).toFixed(1);
    const icon = artifact.type === "code" ? ICON.gear
      : artifact.type === "decision" ? (state.accepted ? ICON.check : ICON.cross)
      : ICON.bullet;
    console.log(`  ${FG.brightCyan}${icon}${RST} ${padEnd(artifact.type, 12)} ${DIM}${sizeKb}KB${RST}  ${DIM}by ${artifact.producerRole} (${artifact.producerAgent})${RST}`);
  }
  console.log();

  // ── Recommendations ───────────────────────────────────────────────────
  console.log(`  ${BOLD}${ICON.brain} Recommendations${RST}`);
  console.log();

  if (metrics.length > 0) {
    const slowest = [...metrics].sort((a, b) => b.durationMs - a.durationMs)[0];
    if (slowest.durationMs > 5 * 60 * 1000) {
      console.log(`  ${DIM}•${RST} ${slowest.role} took over 5 min — consider using a faster model or splitting the task`);
    }
    if (!state.accepted) {
      console.log(`  ${DIM}•${RST} Pipeline was rejected — review CEO feedback in the decision artifact`);
      console.log(`  ${DIM}•${RST} Resume with: ${BOLD}council company --resume=${runId}${RST}`);
    }
    const devMetric = metrics.find((m) => m.role === "developer");
    if (devMetric && devMetric.durationMs > 10 * 60 * 1000) {
      console.log(`  ${DIM}•${RST} Developer took ${elapsed(devMetric.durationMs)} — try a simpler model or break the feature into sub-tasks`);
    }
  }

  if (state.accepted) {
    console.log(`  ${DIM}•${RST} ${FG.brightGreen}Run was successful.${RST} No action needed.`);
  }

  console.log();
}
