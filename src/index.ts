#!/usr/bin/env node
import { printHeader, printError, printInfo } from "./ui/render";
import { RST, BOLD, DIM, FG, ICON } from "./ui/theme";
import { findRepoRoot, removeAll } from "./worktree";
import { installSignalHandlers } from "./process";

// ── CLI Argument Parsing ─────────────────────────────────────────────────────

interface ParsedArgs {
  command: "chat" | "compare" | "orchestrate" | "company" | "workspace" | "run" | "bg" | "standup" | "board" | "retro" | "history" | "analytics" | "bot" | "init" | "doctor" | "export" | "apply" | "cleanup" | "help" | "version";
  dryRun?: boolean;
  task: string | null;
  agentFlag: string | null;
  rolesFlag: string | null;
  target: string | null;  // for apply
}

function extractFlag(args: string[], prefix: string): string | null {
  return args.find((a) => a.startsWith(`--${prefix}=`))?.split("=").slice(1).join("=") ?? null;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    return { command: "help", task: null, agentFlag: null, rolesFlag: null, target: null };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { command: "version", task: null, agentFlag: null, rolesFlag: null, target: null };
  }
  if (args.includes("--cleanup") || args[0] === "cleanup") {
    return { command: "cleanup", task: null, agentFlag: null, rolesFlag: null, target: null };
  }

  const subcommand = args[0];

  if (subcommand === "chat") {
    const rest = args.slice(1);
    return { command: "chat", task: null, agentFlag: extractFlag(rest, "agents"), rolesFlag: null, target: null };
  }

  if (subcommand === "orchestrate" || subcommand === "orch") {
    const rest = args.slice(1).filter((a) => !a.startsWith("--"));
    return { command: "orchestrate", task: rest.join(" ") || null, agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "standup") {
    const rest = args.slice(1).filter((a) => !a.startsWith("--"));
    const sinceFlag = extractFlag(args.slice(1), "since");
    return { command: "standup", task: sinceFlag ?? (rest[0] || null), agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "board") {
    return { command: "board", task: null, agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "retro") {
    const rest = args.slice(1).filter((a) => !a.startsWith("--"));
    return { command: "retro", task: rest[0] ?? "latest", agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "history") {
    const rest = args.slice(1).filter((a) => !a.startsWith("--"));
    return { command: "history", task: rest[0] ?? null, agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "bg") {
    const rest = args.slice(1);
    const agentFlag = extractFlag(rest, "agents");
    const rolesFlag = extractFlag(rest, "roles");
    const taskParts = rest.filter((a) => !a.startsWith("--"));
    return { command: "bg", task: taskParts.join(" ") || null, agentFlag, rolesFlag, target: null };
  }

  if (subcommand === "init") {
    return { command: "init", task: null, agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "doctor") {
    return { command: "doctor", task: null, agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "export") {
    const rest = args.slice(1);
    const output = extractFlag(rest, "output");
    const taskParts = rest.filter((a) => !a.startsWith("--"));
    return { command: "export", task: taskParts[0] ?? "latest", agentFlag: null, rolesFlag: null, target: output };
  }

  if (subcommand === "run") {
    const rest = args.slice(1).filter((a) => !a.startsWith("--"));
    const templateName = rest[0] ?? null;
    const description = rest.slice(1).join(" ") || null;
    return { command: "run", task: templateName, agentFlag: description, rolesFlag: null, target: null };
  }

  if (subcommand === "workspace" || subcommand === "ws") {
    const rest = args.slice(1);
    const agentFlag = extractFlag(rest, "agents");
    const taskParts = rest.filter((a) => !a.startsWith("--"));
    return { command: "workspace", task: taskParts.join(" ") || null, agentFlag, rolesFlag: null, target: null };
  }

  if (subcommand === "analytics" || subcommand === "stats") {
    return { command: "analytics", task: null, agentFlag: null, rolesFlag: null, target: null };
  }

  if (subcommand === "bot") {
    const rest = args.slice(1);
    const portStr = extractFlag(rest, "port") ?? "3000";
    const isSetup = rest.includes("--setup");
    return { command: "bot", task: portStr, agentFlag: null, rolesFlag: null, target: isSetup ? "setup" : null };
  }

  if (subcommand === "company") {
    const rest = args.slice(1);
    const agentFlag = extractFlag(rest, "agents");
    const rolesFlag = extractFlag(rest, "roles");
    const resumeFlag = extractFlag(rest, "resume");
    const dryRun = rest.includes("--dry-run");
    const taskParts = rest.filter((a) => !a.startsWith("--"));
    return { command: "company", task: taskParts.join(" ") || null, agentFlag, rolesFlag, target: resumeFlag, dryRun };
  }

  if (subcommand === "apply") {
    return { command: "apply", task: null, agentFlag: null, rolesFlag: null, target: args[1] ?? null };
  }

  if (subcommand === "compare") {
    const rest = args.slice(1);
    const agentFlag = extractFlag(rest, "agents");
    const taskParts = rest.filter((a) => !a.startsWith("--"));
    return { command: "compare", task: taskParts.join(" ") || null, agentFlag, rolesFlag: null, target: null };
  }

  // Default: no subcommand
  const agentFlag = extractFlag(args, "agents");
  const taskParts = args.filter((a) => !a.startsWith("--"));
  const task = taskParts.join(" ") || null;

  if (task) {
    return { command: "compare", task, agentFlag, rolesFlag: null, target: null };
  }
  return { command: "chat", task: null, agentFlag, rolesFlag: null, target: null };
}

// ── Help Text ────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
  ${BOLD}${FG.brightCyan}${ICON.scales}  Council${RST} — AI Company in a CLI

  ${BOLD}QUICK START${RST}

    ${DIM}# Run a feature through PM → Architect → Developer → QA → CEO${RST}
    ${BOLD}council company${RST} "Add dark mode with system preference detection"

    ${DIM}# Compare 2+ agents on the same task, pick the winner${RST}
    ${BOLD}council${RST} "Fix the authentication bug"

    ${DIM}# Fix a bug using the bugfix template${RST}
    ${BOLD}council run bugfix${RST} "Login fails on Safari"

    ${DIM}# Preview what the pipeline will do (no agents executed)${RST}
    ${BOLD}council company --dry-run${RST} "Add user avatars"

  ${BOLD}ALL COMMANDS${RST}

    ${BOLD}council${RST}                               Interactive chat (default)
    ${BOLD}council chat${RST}                           Same as above, explicitly
    ${BOLD}council${RST} [task]                        Compare agents on a one-shot task
    ${BOLD}council compare${RST} [task]                Same as above, explicitly
    ${BOLD}council orchestrate${RST} [description]     CTO mode: plan, delegate, review, merge
    ${BOLD}council company${RST} [feature]             AI company: PM → Architect → Dev → QA → CEO
    ${BOLD}council standup${RST}                       Generate standup report from git history
    ${BOLD}council board${RST}                         View all pipeline runs (kanban board)
    ${BOLD}council retro${RST} [run-id]                Post-mortem analysis of a pipeline run
    ${BOLD}council workspace${RST} [feature]            Multi-repo: run pipeline across repos
    ${BOLD}council analytics${RST}                     Agent performance leaderboard and insights
    ${BOLD}council history${RST} [filter]              Search and manage past pipeline runs
    ${BOLD}council bot${RST}                           Start GitHub webhook bot server
    ${BOLD}council bot --setup${RST}                   Show bot setup guide
    ${BOLD}council bg${RST} "feature"                  Run pipeline in background (detached process)
    ${BOLD}council run${RST} <template> "desc"          Run from a template (bugfix, refactor, test, ...)
    ${BOLD}council run${RST} list                      List available templates
    ${BOLD}council init${RST}                           Setup wizard — generates .council.yml
    ${BOLD}council doctor${RST}                         Health check — verify setup and dependencies
    ${BOLD}council export${RST} [run-id]                Export pipeline run as HTML report
    ${BOLD}council apply${RST} <agent-id>              Apply a worktree's changes to main tree
    ${BOLD}council cleanup${RST}                       Remove all council worktrees and branches

  ${BOLD}OPTIONS${RST}

    --agents=cli:model,cli:model     Select agents directly
                                     e.g. ${DIM}--agents=claude:claude-sonnet-4-6,codex:gpt-4o${RST}
                                     Append ${BOLD}:reasoning${RST} for extended thinking
                                     e.g. ${DIM}--agents=claude:claude-opus-4-6:reasoning${RST}
    --roles=pm,architect,developer   Select company pipeline roles (company mode)
    --dry-run                        Show pipeline plan and cost estimate without running
    --help, -h                       Show this help
    --version, -v                    Show version

  ${BOLD}CHAT MODE${RST}  ${DIM}(default — just run \`council\`)${RST}

    Interactive REPL where every message goes to all agents in parallel.
    Each agent works in its own worktree. Use /diff, /apply, /compare.

    ${DIM}$ council${RST}
    ${DIM}$ council chat --agents=anthropic:claude-sonnet-4-6,gemini:gemini-2.0-flash${RST}

  ${BOLD}COMPARE MODE${RST}  ${DIM}(one-shot — \`council "task"\`)${RST}

    Run the same task across 2+ AI agents in parallel, each in an
    isolated git worktree. View diffs side-by-side, pick a winner,
    and apply the changes.

    ${DIM}$ council "Add input validation to the registration form"${RST}
    ${DIM}$ council compare --agents=claude:claude-sonnet-4-6,codex:o3-mini "Fix the auth bug"${RST}

  ${BOLD}ORCHESTRATOR MODE${RST}  ${DIM}(council orchestrate)${RST}

    A CTO/PM persona that:
    1. Analyzes your codebase and feature request
    2. Creates a structured implementation plan with subtasks
    3. Delegates each subtask to the best-fit agent
    4. Reviews each output and iterates on failures
    5. Merges approved changes into your working tree

    ${DIM}$ council orchestrate "Add dark mode with system preference detection"${RST}
    ${DIM}$ council orch "Refactor auth to use JWT tokens"${RST}

  ${BOLD}COMPANY MODE${RST}  ${DIM}(council company)${RST}

    A full AI company pipeline that processes a feature request through:
      PM ${ICON.arrow} Architect ${ICON.arrow} Developer ${ICON.arrow} EM ${ICON.arrow} QA ${ICON.arrow} CEO

    Each role has a specialized persona and passes artifacts to the next.
    The Developer role uses compare mode (multiple agents race).
    The CEO can approve, reject, or send work back for revision.

    ${DIM}$ council company "Add dark mode with system preference detection"${RST}
    ${DIM}$ council company --roles=pm,architect,developer "Quick prototype"${RST}
    ${DIM}$ council company --resume=latest                 Resume last interrupted run${RST}
    ${DIM}$ council company --resume=company-1234567890     Resume specific run${RST}

  ${BOLD}SUPPORTED AGENTS${RST}

    ${DIM}CLI-based (spawns external binary — full agent capabilities):${RST}
    ${FG.brightCyan}claude${RST}      Claude Code CLI    ${DIM}(ANTHROPIC_API_KEY or claude auth)${RST}
    ${FG.brightMagenta}codex${RST}       OpenAI Codex CLI   ${DIM}(OPENAI_API_KEY or codex auth)${RST}
    ${FG.brightGreen}gemini-cli${RST}  Gemini CLI         ${DIM}(GOOGLE_API_KEY or gemini auth)${RST}
    ${FG.brightYellow}iloom${RST}       iloom agent swarm  ${DIM}(il CLI installed)${RST}

    ${DIM}API-based (direct HTTP with agentic tool loop — no CLI needed):${RST}
    ${FG.brightCyan}anthropic${RST}  Claude models     ${DIM}(ANTHROPIC_API_KEY)${RST}
    ${FG.brightMagenta}openai${RST}    GPT models        ${DIM}(OPENAI_API_KEY)${RST}
    ${FG.brightGreen}gemini${RST}    Gemini models     ${DIM}(GOOGLE_API_KEY or GEMINI_API_KEY)${RST}

    Council auto-discovers all available agents at runtime.
    If you have the CLI installed, it prefers the CLI runner.
    If you only have an API key, it uses the built-in agentic runner.

  ${BOLD}EXAMPLES${RST}

    ${DIM}# API-based: pit Anthropic vs Google directly${RST}
    council --agents=anthropic:claude-sonnet-4-6,gemini:gemini-2.0-flash "Add dark mode"

    ${DIM}# Mix CLI and API agents${RST}
    council --agents=claude:claude-sonnet-4-6,gemini:gemini-1.5-pro-latest "Fix auth bug"

`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  installSignalHandlers();
  const parsed = parseArgs();

  switch (parsed.command) {
    case "help":
      printHelp();
      return;

    case "version":
      console.log("council 0.4.0");
      return;

    case "cleanup": {
      const repoPath = findRepoRoot();
      removeAll(repoPath);
      printHeader();
      printInfo("All council worktrees and branches removed.");
      console.log();
      return;
    }

    case "chat": {
      printHeader();
      const { runChat } = await import("./commands/chat");
      await runChat(parsed.agentFlag);
      return;
    }

    case "compare": {
      printHeader();
      const { runCompare } = await import("./commands/compare");
      await runCompare(parsed.task, parsed.agentFlag);
      return;
    }

    case "orchestrate": {
      printHeader();
      const { runOrchestrate } = await import("./commands/orchestrate");
      await runOrchestrate(parsed.task);
      return;
    }

    case "standup": {
      printHeader();
      const { runStandup } = await import("./commands/standup");
      await runStandup(parsed.task);
      return;
    }

    case "board": {
      printHeader();
      const { runBoard } = await import("./commands/board");
      await runBoard();
      return;
    }

    case "retro": {
      printHeader();
      const { runRetro } = await import("./commands/retro");
      await runRetro(parsed.task);
      return;
    }

    case "history": {
      printHeader();
      const { runHistory } = await import("./commands/history");
      await runHistory(parsed.task);
      return;
    }

    case "bg": {
      printHeader();
      const { runBackground } = await import("./commands/bg");
      await runBackground(parsed.task, parsed.agentFlag, parsed.rolesFlag);
      return;
    }

    case "init": {
      const { runInit } = await import("./commands/init");
      await runInit();
      return;
    }

    case "doctor": {
      printHeader();
      const { runDoctor } = await import("./commands/doctor");
      await runDoctor();
      return;
    }

    case "export": {
      printHeader();
      const { runExport } = await import("./commands/export");
      await runExport(parsed.task, parsed.target);
      return;
    }

    case "run": {
      printHeader();
      const { runTemplate } = await import("./commands/run");
      await runTemplate(parsed.task, parsed.agentFlag);
      return;
    }

    case "workspace": {
      printHeader();
      const { runWorkspace } = await import("./commands/workspace");
      await runWorkspace(parsed.task, parsed.agentFlag);
      return;
    }

    case "analytics": {
      printHeader();
      const { runAnalytics } = await import("./commands/analytics");
      await runAnalytics();
      return;
    }

    case "bot": {
      printHeader();
      const { startBot } = await import("./bot/server");
      await startBot(parseInt(parsed.task ?? "3000", 10), parsed.target === "setup");
      return;
    }

    case "company": {
      printHeader();
      const { runCompany } = await import("./commands/company");
      await runCompany(parsed.task, parsed.agentFlag, parsed.rolesFlag, parsed.target, parsed.dryRun);
      return;
    }

    case "apply": {
      if (!parsed.target) {
        printError("Usage: council apply <agent-id>");
        printInfo("Agent IDs are shown after running council compare.");
        process.exit(1);
      }
      printHeader();
      const repoPath = findRepoRoot();
      const { applyFromWorktree } = await import("./commands/apply");
      await applyFromWorktree(repoPath, parsed.target);
      return;
    }
  }
}

main().catch((err) => {
  printError(err.message ?? String(err));
  process.exit(1);
});
