import { findRepoRoot } from "../worktree";
import { listPipelineRuns, cleanupArtifacts } from "../artifacts";
import { printInfo, printError, printSuccess } from "../ui/render";
import { prompt, confirm } from "../ui/prompt";
import { RST, BOLD, DIM, FG, ICON, padEnd, elapsed } from "../ui/theme";

export async function runHistory(filterArg: string | null): Promise<void> {
  const repoPath = findRepoRoot();
  const allRuns = listPipelineRuns(repoPath);

  if (allRuns.length === 0) {
    printInfo("No pipeline runs found.");
    return;
  }

  // Filter by keyword if provided
  const runs = filterArg
    ? allRuns.filter((r) =>
        r.state.featureRequest.toLowerCase().includes(filterArg.toLowerCase())
        || r.runId.includes(filterArg)
        || (r.state.accepted ? "shipped" : "rejected").includes(filterArg.toLowerCase())
      )
    : allRuns;

  if (runs.length === 0) {
    printInfo(`No runs matching "${filterArg}".`);
    return;
  }

  console.log();
  console.log(`  ${BOLD}${ICON.plan} Pipeline History${RST} ${DIM}(${runs.length} runs)${RST}`);
  console.log(`  ${DIM}${"─".repeat(70)}${RST}`);
  console.log();

  for (let idx = 0; idx < runs.length; idx++) {
    const { runId, state } = runs[idx];
    const completed = state.completedRoles.length;
    const total = state.roleNames.length;
    const isComplete = state.finishedAt != null;
    const duration = (state.finishedAt ?? Date.now()) - state.startedAt;

    let statusIcon: string;
    let statusLabel: string;
    if (state.accepted) {
      statusIcon = `${FG.brightGreen}${ICON.check}`;
      statusLabel = "shipped ";
    } else if (isComplete) {
      statusIcon = `${FG.brightRed}${ICON.cross}`;
      statusLabel = "rejected";
    } else {
      statusIcon = `${FG.brightYellow}${ICON.gear}`;
      statusLabel = "paused  ";
    }

    const date = new Date(state.startedAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

    const feature = state.featureRequest.length > 45
      ? state.featureRequest.slice(0, 44) + "…"
      : state.featureRequest;

    const metrics = state.roleMetrics ?? [];
    const totalRetries = metrics.reduce((sum, m) => sum + m.retries, 0);
    const retryNote = totalRetries > 0 ? ` ${FG.brightYellow}(${totalRetries} retries)${RST}` : "";

    console.log(`  ${BOLD}${idx + 1}.${RST} ${statusIcon}${RST} ${statusLabel}  ${feature}`);
    console.log(`     ${DIM}${runId}  ${dateStr}  ${elapsed(duration)}  roles: ${completed}/${total}${RST}${retryNote}`);

    // Show role breakdown
    const rolesSummary = state.roleNames.map((name) => {
      const done = state.completedRoles.includes(name);
      return done ? `${FG.brightGreen}${name}${RST}` : `${DIM}${name}${RST}`;
    }).join(" → ");
    console.log(`     ${rolesSummary}`);
    console.log();
  }

  // Actions
  const action = await prompt(`${BOLD}Action:${RST} ${DIM}(resume <#>, retro <#>, clean <#>, or Enter to exit)${RST} `);
  if (!action) return;

  const [cmd, numStr] = action.split(/\s+/);
  const num = parseInt(numStr ?? "1", 10) - 1;

  if (num < 0 || num >= runs.length) {
    printError(`Invalid run number. Choose 1-${runs.length}`);
    return;
  }

  const target = runs[num];

  switch (cmd) {
    case "resume": {
      printInfo(`Resume with: council company --resume=${target.runId}`);
      break;
    }
    case "retro": {
      printInfo(`View retro with: council retro ${target.runId}`);
      break;
    }
    case "clean": {
      const ok = await confirm(`Delete ${target.runId}?`, false);
      if (ok) {
        cleanupArtifacts(repoPath, target.runId);
        printSuccess("Deleted.");
      }
      break;
    }
    default:
      printError(`Unknown action: ${cmd}. Try: resume, retro, clean`);
  }
}
