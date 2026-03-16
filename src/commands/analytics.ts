import { findRepoRoot } from "../worktree";
import { generateAnalytics } from "../analytics";
import { printInfo, printError } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON, padEnd, elapsed } from "../ui/theme";

export async function runAnalytics(): Promise<void> {
  const repoPath = findRepoRoot();
  const report = generateAnalytics(repoPath);

  if (report.totalRuns === 0) {
    printInfo("No pipeline runs found. Run some pipelines first.");
    return;
  }

  console.log();
  console.log(`  ${BOLD}${ICON.chart} Council Analytics${RST}`);
  console.log(`  ${DIM}${"─".repeat(55)}${RST}`);
  console.log();

  // Overview
  console.log(`  ${BOLD}Overview${RST}`);
  console.log(`  Total runs:     ${report.totalRuns}`);
  console.log(`  Approved:       ${FG.brightGreen}${report.totalApproved}${RST}`);
  console.log(`  Rejected:       ${FG.brightRed}${report.totalRejected}${RST}`);
  if (report.totalInProgress > 0) {
    console.log(`  In progress:    ${FG.brightYellow}${report.totalInProgress}${RST}`);
  }
  console.log(`  Approval rate:  ${BOLD}${Math.round((report.totalApproved / Math.max(1, report.totalApproved + report.totalRejected)) * 100)}%${RST}`);
  console.log(`  Avg pipeline:   ${elapsed(report.avgPipelineMs)}`);
  console.log();

  // Agent leaderboard
  if (report.agentStats.length > 0) {
    console.log(`  ${BOLD}${ICON.trophy} Agent Leaderboard${RST}`);
    console.log();
    console.log(`  ${DIM}${padEnd("Agent", 35)} ${padEnd("Runs", 6)} ${padEnd("Approval", 10)} ${padEnd("Avg Time", 10)} ${padEnd("Retries", 8)}${RST}`);
    console.log(`  ${DIM}${"─".repeat(55)}${RST}`);

    for (let i = 0; i < report.agentStats.length; i++) {
      const stat = report.agentStats[i];
      const medal = i === 0 ? `${FG.brightYellow}#1${RST}` : i === 1 ? `${FG.gray}#2${RST}` : `${DIM}#${i + 1}${RST}`;
      const rate = `${Math.round(stat.approvalRate * 100)}%`;
      const rateColor = stat.approvalRate >= 0.8 ? FG.brightGreen : stat.approvalRate >= 0.5 ? FG.brightYellow : FG.brightRed;

      console.log(`  ${medal} ${padEnd(stat.agent, 32)} ${padEnd(String(stat.totalRuns), 6)} ${rateColor}${padEnd(rate, 10)}${RST} ${padEnd(elapsed(stat.avgDurationMs), 10)} ${stat.totalRetries > 0 ? `${FG.brightYellow}${stat.totalRetries}${RST}` : `${DIM}0${RST}`}`);
    }
    console.log();
  }

  // Role performance
  if (Object.keys(report.avgRoleDurations).length > 0) {
    console.log(`  ${BOLD}${ICON.gear} Role Performance${RST}`);
    console.log();

    const maxDuration = Math.max(...Object.values(report.avgRoleDurations));

    const sortedRoles = Object.entries(report.avgRoleDurations)
      .sort((a, b) => b[1] - a[1]);

    for (const [role, avgMs] of sortedRoles) {
      const barWidth = Math.max(1, Math.round((avgMs / maxDuration) * 25));
      const bar = "█".repeat(barWidth);
      const isBottleneck = role === report.bottleneckRole;
      const label = isBottleneck ? `${FG.brightRed}${padEnd(role, 14)} ${bar}${RST}` : `${padEnd(role, 14)} ${FG.brightCyan}${bar}${RST}`;
      const tag = isBottleneck ? ` ${FG.brightRed}← bottleneck${RST}` : "";
      console.log(`  ${label} ${elapsed(avgMs)}${tag}`);
    }
    console.log();
  }

  // Recommendations
  console.log(`  ${BOLD}${ICON.brain} Recommendations${RST}`);
  console.log();

  if (report.bottleneckRole) {
    const bottleneckMs = report.avgRoleDurations[report.bottleneckRole];
    if (bottleneckMs > 5 * 60 * 1000) {
      console.log(`  ${DIM}${ICON.arrowR}${RST} ${report.bottleneckRole} averages ${elapsed(bottleneckMs)} — consider a faster model`);
    }
  }

  const worstAgent = report.agentStats.find((s) => s.approvalRate < 0.5 && s.totalRuns >= 2);
  if (worstAgent) {
    console.log(`  ${DIM}${ICON.arrowR}${RST} ${worstAgent.agent} has ${Math.round(worstAgent.approvalRate * 100)}% approval — consider replacing it`);
  }

  const retryHeavy = report.agentStats.find((s) => s.totalRetries > 2);
  if (retryHeavy) {
    console.log(`  ${DIM}${ICON.arrowR}${RST} ${retryHeavy.agent} has ${retryHeavy.totalRetries} retries — may need better prompts`);
  }

  if (report.totalApproved === report.totalRuns) {
    console.log(`  ${DIM}${ICON.arrowR}${RST} ${FG.brightGreen}100% approval rate — your pipeline is running well${RST}`);
  }

  console.log();
}
