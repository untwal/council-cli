import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { findRepoRoot } from "../worktree";
import { createRunId, artifactDir } from "../artifacts";
import { printInfo, printSuccess, printError } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON } from "../ui/theme";

export async function runBackground(taskArg: string | null, agentFlag: string | null, rolesFlag: string | null): Promise<void> {
  if (!taskArg) {
    printError("Usage: council bg \"feature description\"");
    return;
  }

  const repoPath = findRepoRoot();
  const runId = createRunId();
  const logDir = artifactDir(repoPath, runId);
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "pipeline.log");

  // Build args for the council company command
  const args = ["company", taskArg];
  if (agentFlag) args.push(`--agents=${agentFlag}`);
  if (rolesFlag) args.push(`--roles=${rolesFlag}`);

  // Find the council binary
  const councilBin = path.resolve(__dirname, "..", "index.js");

  // Spawn detached child process
  const out = fs.openSync(logFile, "a");
  const child = spawn("node", [councilBin, ...args], {
    cwd: repoPath,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, COUNCIL_RUN_ID: runId, COUNCIL_NON_INTERACTIVE: "1" },
  });

  child.unref();
  // Close the file descriptor in the parent — child inherits its own copy
  fs.closeSync(out);

  console.log();
  console.log(`  ${FG.brightCyan}${ICON.rocket}${RST} ${BOLD}Pipeline launched in background${RST}`);
  console.log();
  console.log(`  ${BOLD}Run ID:${RST}  ${runId}`);
  console.log(`  ${BOLD}PID:${RST}     ${child.pid}`);
  console.log(`  ${BOLD}Log:${RST}     ${logFile}`);
  console.log();
  console.log(`  ${DIM}Track progress:${RST}  council board`);
  console.log(`  ${DIM}View logs:${RST}       tail -f ${logFile}`);
  console.log(`  ${DIM}View retro:${RST}      council retro ${runId}`);
  console.log();
}
