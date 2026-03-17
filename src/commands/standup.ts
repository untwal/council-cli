import { spawnSync } from "child_process";
import { findRepoRoot } from "../worktree";
import { printInfo, printError } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON } from "../ui/theme";

export async function runStandup(since: string | null): Promise<void> {
  const repoPath = findRepoRoot();
  const period = since ?? "yesterday";

  // Validate period — reject shell metacharacters
  if (/[;&|`$(){}!<>]/.test(period)) {
    printError(`Invalid --since value: "${period}". Use a git date format like "yesterday", "2 days ago", "2026-03-01".`);
    return;
  }

  printInfo(`Generating standup for changes since ${period}...`);
  console.log();

  // All git commands use spawnSync with array args — no shell injection
  const gitLog = git(repoPath, "log", `--since=${period}`, "--oneline", "--no-merges");
  const gitDiffStat = git(repoPath, "diff", "--stat", "HEAD~5");
  const branch = git(repoPath, "branch", "--show-current");
  const uncommitted = git(repoPath, "status", "--short");
  const authorsRaw = git(repoPath, "log", `--since=${period}`, "--format=%an", "--no-merges");
  const authors = [...new Set(authorsRaw.split("\n").filter(Boolean))].sort().join("\n");

  if (!gitLog.trim() && !uncommitted.trim()) {
    console.log(`  ${DIM}No changes found since ${period}.${RST}`);
    return;
  }

  console.log(`  ${FG.brightCyan}${BOLD}${ICON.chart} Standup Report${RST}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RST}`);
  console.log();

  if (branch.trim()) {
    console.log(`  ${BOLD}Branch:${RST} ${FG.brightGreen}${branch.trim()}${RST}`);
    console.log();
  }

  if (authors.trim()) {
    const authorList = authors.trim().split("\n").filter(Boolean);
    if (authorList.length > 0) {
      console.log(`  ${BOLD}Contributors:${RST} ${authorList.join(", ")}`);
      console.log();
    }
  }

  if (gitLog.trim()) {
    console.log(`  ${BOLD}${ICON.check} Completed${RST} ${DIM}(commits since ${period})${RST}`);
    for (const line of gitLog.trim().split("\n").slice(0, 15)) {
      const [hash, ...rest] = line.split(" ");
      console.log(`    ${FG.gray}${hash}${RST} ${rest.join(" ")}`);
    }
    const totalCommits = gitLog.trim().split("\n").length;
    if (totalCommits > 15) {
      console.log(`    ${DIM}... and ${totalCommits - 15} more commits${RST}`);
    }
    console.log();
  }

  if (uncommitted.trim()) {
    const lines = uncommitted.trim().split("\n");
    const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M "));
    const added = lines.filter((l) => l.startsWith("??") || l.startsWith("A "));
    const deleted = lines.filter((l) => l.startsWith(" D") || l.startsWith("D "));

    console.log(`  ${BOLD}${ICON.gear} In Progress${RST} ${DIM}(uncommitted)${RST}`);
    if (modified.length > 0) {
      console.log(`    ${FG.brightYellow}Modified:${RST} ${modified.length} files`);
      for (const f of modified.slice(0, 5)) console.log(`      ${DIM}${f.trim().slice(2).trim()}${RST}`);
      if (modified.length > 5) console.log(`      ${DIM}... +${modified.length - 5} more${RST}`);
    }
    if (added.length > 0) {
      console.log(`    ${FG.brightGreen}Added:${RST} ${added.length} files`);
    }
    if (deleted.length > 0) {
      console.log(`    ${FG.brightRed}Deleted:${RST} ${deleted.length} files`);
    }
    console.log();
  }

  if (gitDiffStat.trim()) {
    const lastLine = gitDiffStat.trim().split("\n").pop() ?? "";
    if (lastLine.includes("changed")) {
      console.log(`  ${BOLD}${ICON.chart} Stats:${RST} ${DIM}${lastLine.trim()}${RST}`);
      console.log();
    }
  }
}

function git(cwd: string, ...args: string[]): string {
  try {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    return r.stdout ?? "";
  } catch {
    return "";
  }
}
