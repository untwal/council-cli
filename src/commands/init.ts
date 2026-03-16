import * as fs from "fs";
import * as path from "path";
import { prompt, confirm, isTTY } from "../ui/prompt";
import { printInfo, printSuccess, printError, printWarning } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON } from "../ui/theme";

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, ".council.yml");

  if (fs.existsSync(configPath)) {
    const overwrite = await confirm(`${BOLD}.council.yml already exists. Overwrite?${RST}`, false);
    if (!overwrite) {
      printWarning("Cancelled.");
      return;
    }
  }

  console.log();
  console.log(`  ${BOLD}${ICON.gear} Council Setup Wizard${RST}`);
  console.log(`  ${DIM}${"─".repeat(40)}${RST}`);
  console.log();

  // Detect project type
  const projectType = detectProjectType(cwd);
  if (projectType) {
    printInfo(`Detected: ${projectType}`);
    console.log();
  }

  // Agents
  const agentLines: string[] = [];
  const hasClaude = commandExists("claude");
  const hasCodex = commandExists("codex");
  const hasGemini = commandExists("gemini");

  if (hasClaude) agentLines.push("  - claude:claude-sonnet-4-6");
  if (hasCodex) agentLines.push("  - codex:o3-mini");
  if (hasGemini) agentLines.push("  - gemini-cli:gemini-2.5-flash");

  if (agentLines.length === 0) {
    printWarning("No AI agent CLIs detected. Set API keys or install claude/codex/gemini CLI.");
    agentLines.push("  # - claude:claude-sonnet-4-6");
    agentLines.push("  # - codex:o3-mini");
  }

  // Eval commands
  const evalLines = detectEvalCommands(cwd);

  // Build config
  const lines: string[] = [];
  lines.push("# Council CLI configuration");
  lines.push("# Docs: https://github.com/council-cli");
  lines.push("");
  lines.push("# Default agents for compare/chat mode");
  lines.push("agents:");
  lines.push(...agentLines);
  lines.push("");

  if (evalLines.length > 0) {
    lines.push("# Evaluation commands (run after agents produce changes)");
    lines.push("evaluate:");
    for (const cmd of evalLines) lines.push(`  - ${cmd}`);
    lines.push("");
  }

  lines.push("# Company pipeline settings");
  lines.push("company:");
  lines.push("  maxRetries: 2");
  lines.push("");
  lines.push("  # Override default role settings");
  lines.push("  roles:");
  lines.push("    developer:");
  lines.push("        mode: compare");
  if (hasClaude) {
    lines.push("    ceo:");
    lines.push("        agent: claude:claude-opus-4-6:reasoning");
  }
  lines.push("");
  lines.push("  # Custom roles (uncomment to add)");
  lines.push("  # customRoles:");
  lines.push("  #   security:");
  lines.push("  #     title: Security Auditor");
  lines.push("  #     prompt: Review for OWASP Top 10 vulnerabilities");
  lines.push("  #     after: qa");
  lines.push("");

  const config = lines.join("\n") + "\n";

  // Show preview
  console.log(`  ${BOLD}Preview:${RST}`);
  console.log();
  for (const line of config.split("\n")) {
    console.log(`  ${DIM}${line}${RST}`);
  }
  console.log();

  const save = await confirm(`${BOLD}Write .council.yml?${RST}`);
  if (!save) {
    printWarning("Cancelled.");
    return;
  }

  fs.writeFileSync(configPath, config, "utf-8");
  printSuccess("Created .council.yml");

  // Add to .gitignore if needed
  const gitignorePath = path.join(cwd, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    const entries = [".council-worktrees/", ".council-artifacts/"];
    const missing = entries.filter((e) => !gitignore.includes(e));
    if (missing.length > 0) {
      const addIgnore = await confirm(`Add ${missing.join(", ")} to .gitignore?`);
      if (addIgnore) {
        fs.appendFileSync(gitignorePath, "\n# Council\n" + missing.join("\n") + "\n");
        printSuccess("Updated .gitignore");
      }
    }
  }

  console.log();
  console.log(`  ${BOLD}Next steps:${RST}`);
  console.log(`  ${DIM}1.${RST} council company "Your first feature"`);
  console.log(`  ${DIM}2.${RST} council standup`);
  console.log(`  ${DIM}3.${RST} council --help`);
  console.log();
}

function detectProjectType(cwd: string): string | null {
  const exists = (f: string) => fs.existsSync(path.join(cwd, f));
  if (exists("package.json") && exists("tsconfig.json")) return "TypeScript/Node.js";
  if (exists("package.json")) return "Node.js";
  if (exists("Gemfile")) return "Ruby/Rails";
  if (exists("pyproject.toml") || exists("setup.py")) return "Python";
  if (exists("go.mod")) return "Go";
  if (exists("Cargo.toml")) return "Rust";
  if (exists("pom.xml") || exists("build.gradle")) return "Java";
  return null;
}

function detectEvalCommands(cwd: string): string[] {
  const cmds: string[] = [];
  const exists = (f: string) => fs.existsSync(path.join(cwd, f));

  if (exists("tsconfig.json")) cmds.push("npx tsc --noEmit");

  if (exists("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
      if (pkg.scripts?.test && !pkg.scripts.test.includes("no test specified")) cmds.push("npm test");
      if (pkg.scripts?.lint) cmds.push("npm run lint");
    } catch {}
  }

  if (exists("Gemfile")) {
    if (exists("spec")) cmds.push("bundle exec rspec");
    cmds.push("bundle exec rubocop");
  }

  if (exists("pyproject.toml")) {
    const toml = fs.readFileSync(path.join(cwd, "pyproject.toml"), "utf-8");
    if (toml.includes("pytest")) cmds.push("python -m pytest --tb=short -q");
    if (toml.includes("ruff")) cmds.push("ruff check .");
  }

  if (exists("go.mod")) {
    cmds.push("go build ./...");
    cmds.push("go vet ./...");
  }

  if (exists("Cargo.toml")) cmds.push("cargo check");

  return cmds;
}

function commandExists(cmd: string): boolean {
  try {
    const { spawnSync } = require("child_process");
    const r = spawnSync("which", [cmd], { stdio: "ignore", timeout: 5_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
