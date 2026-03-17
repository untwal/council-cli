/**
 * Real evaluation — runs actual commands (tsc, eslint, npm test, etc.)
 * in each agent's worktree and reports pass/fail with real output.
 */
import { spawnSync } from "child_process";
import { Worktree } from "./worktree";
import { getConfig } from "./config";

export interface EvalCheck {
  command: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface EvalResult {
  agentId: string;
  checks: EvalCheck[];
  allPassed: boolean;
  totalDurationMs: number;
}

/**
 * Run all configured evaluation commands in a worktree.
 * Auto-detects project type if no commands configured.
 */
export function evaluate(worktree: Worktree, commands?: string[]): EvalResult {
  const config = getConfig();
  const cmds = commands ?? config.evaluate ?? [];
  const timeout = (config.evaluateTimeout ?? 120) * 1000;

  // Auto-detect if no commands configured
  const effectiveCmds = cmds.length > 0 ? cmds : autoDetectChecks(worktree.path);

  const checks: EvalCheck[] = [];
  let totalMs = 0;

  for (const cmd of effectiveCmds) {
    // Reject commands with shell chaining operators
    if (/[;&|`$()]/.test(cmd) && !cmd.startsWith("npm ") && !cmd.startsWith("npx ")) {
      checks.push({ command: cmd, passed: false, output: `Rejected: command contains shell metacharacters. Use simple commands only.`, durationMs: 0 });
      continue;
    }

    const start = Date.now();
    let passed = false;
    let output = "";

    try {
      // Use spawnSync with shell:true for npm/npx compatibility, but input is validated above
      const parts = cmd.split(/\s+/);
      const r = spawnSync(parts[0], parts.slice(1), {
        cwd: worktree.path,
        encoding: "utf-8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "true", NODE_ENV: "test" },
      });
      output = (r.stdout ?? "") + (r.stderr ?? "");
      passed = r.status === 0;
      if (r.error) {
        output = r.error.message ?? "Command failed";
        passed = false;
      }
    } catch (err: unknown) {
      output = (err as Error).message ?? "Command failed";
      passed = false;
    }

    const durationMs = Date.now() - start;
    totalMs += durationMs;

    // Truncate output to prevent flooding
    if (output.length > 2000) {
      output = output.slice(0, 1000) + "\n...\n" + output.slice(-800);
    }

    checks.push({ command: cmd, passed, output: output.trim(), durationMs });
  }

  return {
    agentId: worktree.agentId,
    checks,
    allPassed: checks.every((c) => c.passed),
    totalDurationMs: totalMs,
  };
}

/**
 * Auto-detect evaluation commands based on files present in the worktree.
 */
function autoDetectChecks(worktreePath: string): string[] {
  const fs = require("fs");
  const path = require("path");
  const checks: string[] = [];

  const exists = (f: string) => fs.existsSync(path.join(worktreePath, f));

  // TypeScript
  if (exists("tsconfig.json")) {
    checks.push("npx tsc --noEmit");
  }

  // Node.js / package.json
  if (exists("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(worktreePath, "package.json"), "utf-8"));
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        checks.push("npm test");
      }
      if (pkg.scripts?.lint) {
        checks.push("npm run lint");
      }
    } catch { /**/ }
  }

  // Python
  if (exists("pyproject.toml") || exists("setup.py")) {
    if (exists("pyproject.toml")) {
      try {
        const toml = fs.readFileSync(path.join(worktreePath, "pyproject.toml"), "utf-8");
        if (toml.includes("pytest")) checks.push("python -m pytest --tb=short -q");
        if (toml.includes("ruff")) checks.push("ruff check .");
        if (toml.includes("mypy")) checks.push("mypy .");
      } catch { /**/ }
    }
  }

  // Go
  if (exists("go.mod")) {
    checks.push("go build ./...");
    checks.push("go vet ./...");
  }

  // Rust
  if (exists("Cargo.toml")) {
    checks.push("cargo check");
  }

  return checks;
}
