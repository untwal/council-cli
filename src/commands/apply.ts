import * as path from "path";
import * as fs from "fs";
import { getDiff, applyDiff, Worktree } from "../worktree";
import { printSuccess, printError, printInfo } from "../ui/render";
import { DIM, RST, ICON } from "../ui/theme";

export async function applyFromWorktree(repoPath: string, agentId: string): Promise<void> {
  const worktreeDir = path.join(repoPath, ".council-worktrees");

  if (!fs.existsSync(worktreeDir)) {
    printError("No council worktrees found. Run `council compare` first.");
    process.exit(1);
  }

  // Find matching worktree directory
  const entries = fs.readdirSync(worktreeDir);
  const safeId = agentId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const match = entries.find((e) => e.startsWith(safeId));

  if (!match) {
    printError(`No worktree found for agent "${agentId}"`);
    printInfo(`Available worktrees:`);
    for (const entry of entries) {
      console.log(`    ${DIM}${ICON.arrowR}${RST} ${entry}`);
    }
    process.exit(1);
  }

  const wtPath = path.join(worktreeDir, match);
  const worktree: Worktree = {
    agentId,
    path: wtPath,
    branch: `council/${match}`,
  };

  printInfo(`Reading diff from ${agentId}...`);
  const diff = getDiff(worktree);

  if (!diff.trim()) {
    printError("No changes found in this worktree");
    process.exit(1);
  }

  const adds = (diff.match(/^\+(?!\+\+)/gm) ?? []).length;
  const dels = (diff.match(/^-(?!--)/gm) ?? []).length;
  const files = new Set(diff.match(/^diff --git /gm) ?? []).size;
  printInfo(`${files} file(s), +${adds} -${dels}`);

  applyDiff(repoPath, diff);
  printSuccess(`Applied changes from ${agentId} to your working tree`);
}
