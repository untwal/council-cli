import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { printInfo, printSuccess, printError, printWarning } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON } from "../ui/theme";

interface Check {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export async function runDoctor(): Promise<void> {
  console.log();
  console.log(`  ${BOLD}${ICON.gear} Council Doctor${RST}`);
  console.log(`  ${DIM}${"─".repeat(40)}${RST}`);
  console.log();

  const checks: Check[] = [];

  // Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  checks.push({
    name: "Node.js",
    status: major >= 18 ? "pass" : "fail",
    detail: `${nodeVersion}${major < 18 ? " (need >= 18)" : ""}`,
  });

  // Git
  checks.push(checkCommand("Git", "git --version", /git version/));

  // AI Agent CLIs
  checks.push(checkCommand("Claude Code CLI", "claude --version", /\d/));
  checks.push(checkCommand("OpenAI Codex CLI", "codex --version", /\d/));
  checks.push(checkCommand("Gemini CLI", "gemini --version", /\d/));
  checks.push(checkCommand("iloom CLI", "il --version", /\d/));

  // API Keys
  checks.push({
    name: "ANTHROPIC_API_KEY",
    status: process.env.ANTHROPIC_API_KEY ? "pass" : "warn",
    detail: process.env.ANTHROPIC_API_KEY ? "set" : "not set (needed for API-based Claude)",
  });
  checks.push({
    name: "OPENAI_API_KEY",
    status: process.env.OPENAI_API_KEY ? "pass" : "warn",
    detail: process.env.OPENAI_API_KEY ? "set" : "not set (needed for API-based GPT)",
  });
  checks.push({
    name: "GOOGLE_API_KEY",
    status: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? "pass" : "warn",
    detail: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? "set" : "not set (needed for API-based Gemini)",
  });

  // Bot env vars
  checks.push({
    name: "COUNCIL_GITHUB_TOKEN",
    status: process.env.COUNCIL_GITHUB_TOKEN ? "pass" : "warn",
    detail: process.env.COUNCIL_GITHUB_TOKEN ? "set" : "not set (needed for bot mode)",
  });
  checks.push({
    name: "COUNCIL_SLACK_WEBHOOK",
    status: process.env.COUNCIL_SLACK_WEBHOOK ? "pass" : "warn",
    detail: process.env.COUNCIL_SLACK_WEBHOOK ? "set" : "not set (optional: Slack notifications)",
  });

  // Git repo check
  const isGitRepo = fs.existsSync(path.join(process.cwd(), ".git"));
  checks.push({
    name: "Git repository",
    status: isGitRepo ? "pass" : "fail",
    detail: isGitRepo ? process.cwd() : "not in a git repository",
  });

  // Config file
  const configExists = [".council.yml", ".council.yaml", "council.yml", "council.yaml"]
    .some((f) => fs.existsSync(path.join(process.cwd(), f)));
  checks.push({
    name: ".council.yml",
    status: configExists ? "pass" : "warn",
    detail: configExists ? "found" : "not found (run `council init` to create)",
  });

  // Worktree cleanup check
  const wtDir = path.join(process.cwd(), ".council-worktrees");
  const orphanedWorktrees = fs.existsSync(wtDir) ? fs.readdirSync(wtDir).length : 0;
  if (orphanedWorktrees > 0) {
    checks.push({
      name: "Orphaned worktrees",
      status: "warn",
      detail: `${orphanedWorktrees} found (run \`council cleanup\`)`,
    });
  }

  // Print results
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const check of checks) {
    const icon = check.status === "pass" ? `${FG.brightGreen}${ICON.check}`
      : check.status === "warn" ? `${FG.brightYellow}${ICON.warning}`
      : `${FG.brightRed}${ICON.cross}`;
    console.log(`  ${icon}${RST} ${BOLD}${check.name}${RST} ${DIM}${check.detail}${RST}`);

    if (check.status === "pass") passCount++;
    else if (check.status === "warn") warnCount++;
    else failCount++;
  }

  console.log();
  console.log(`  ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);
  console.log();

  if (failCount === 0 && warnCount === 0) {
    printSuccess("All checks passed. Council is ready to use.");
    console.log(`  ${DIM}Try: council company --dry-run "Add a feature"${RST}`);
  } else if (failCount === 0) {
    printInfo("Core checks passed. Warnings are optional features you can enable later.");
    if (!configExists) {
      console.log(`  ${DIM}Get started: council init${RST}`);
    }
  } else {
    printWarning("Fix the failed checks above before using council.");
  }
  console.log();
}

function checkCommand(name: string, cmd: string, pattern: RegExp): Check {
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
    return { name, status: "pass", detail: output.trim().split("\n")[0].slice(0, 50) };
  } catch {
    return { name, status: "warn", detail: "not installed" };
  }
}
