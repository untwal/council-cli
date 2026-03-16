import { findRepoRoot } from "../worktree";
import { listPipelineRuns } from "../artifacts";
import { printInfo, printError } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON, padEnd } from "../ui/theme";

export async function runBoard(): Promise<void> {
  const repoPath = findRepoRoot();
  const runs = listPipelineRuns(repoPath);

  if (runs.length === 0) {
    printInfo("No pipeline runs found. Start one with: council company \"feature request\"");
    return;
  }

  console.log();
  console.log(`  ${BOLD}${ICON.chart} Pipeline Board${RST}`);
  console.log(`  ${DIM}${"─".repeat(70)}${RST}`);
  console.log();

  // Header
  console.log(`  ${DIM}${padEnd("Status", 10)} ${padEnd("Run ID", 28)} ${padEnd("Roles", 14)} ${padEnd("Feature", 30)}${RST}`);
  console.log(`  ${DIM}${"─".repeat(70)}${RST}`);

  for (const { runId, state } of runs) {
    const completed = state.completedRoles.length;
    const total = state.roleNames.length;
    const isComplete = completed === total;
    const accepted = state.accepted;

    let statusIcon: string;
    let statusLabel: string;
    if (accepted) {
      statusIcon = `${FG.brightGreen}${ICON.check}`;
      statusLabel = "shipped";
    } else if (isComplete) {
      statusIcon = `${FG.brightRed}${ICON.cross}`;
      statusLabel = "rejected";
    } else {
      statusIcon = `${FG.brightYellow}${ICON.gear}`;
      statusLabel = "paused";
    }

    const progress = `${completed}/${total}`;
    const feature = state.featureRequest.length > 28
      ? state.featureRequest.slice(0, 27) + "…"
      : state.featureRequest;

    const age = formatAge(state.startedAt);

    console.log(`  ${statusIcon}${RST} ${padEnd(statusLabel, 8)} ${DIM}${padEnd(runId, 28)}${RST} ${padEnd(progress, 14)} ${feature}`);
    console.log(`  ${" ".repeat(10)} ${DIM}${age} ago${RST}  ${DIM}last: ${state.completedRoles[state.completedRoles.length - 1] ?? "—"}${RST}`);
  }

  console.log();
  console.log(`  ${DIM}Resume with: council company --resume=<run-id>${RST}`);
  console.log();
}

function formatAge(timestamp: number): string {
  const ms = Date.now() - timestamp;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
