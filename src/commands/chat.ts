import * as readline from "readline";
import { findRepoRoot, createWorktree, getDiff, removeWorktree, applyDiff, Worktree } from "../worktree";
import { discoverModels, ModelDef } from "../models";
import { parseAgentSpecs } from "../parse-agent-spec";
import { getRunner, hasStreamingSupport, AgentResult } from "../agents";
import { ChatSession } from "../api/session";
import { Vendor, ChatTurnResult } from "../api/runner";
import { streamClaude, streamCodex, streamGemini, StreamEvent, StreamOpts } from "../streaming";
import {
  printAgentResponse, ThinkingIndicator, printChatDiffSummary,
  printChatHelp, printChatWelcome,
} from "../ui/chat-display";
import { printError, printInfo, printSuccess, printDiffs } from "../ui/render";
import { selectAgents } from "../ui/prompt";
import { RST, BOLD, DIM, FG, ICON, agentColor } from "../ui/theme";
import { trackWorktree, setBeforeExit, gracefulShutdown } from "../process";
import { loadConfig } from "../config";

const CLI_RUNNERS = new Set(["claude", "codex", "gemini-cli", "iloom"]);
const API_RUNNERS = new Set(["anthropic", "openai", "gemini"]);

const VENDOR_MAP: Record<string, Vendor> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "google",
};

interface ChatAgent {
  def: ModelDef;
  colorIndex: number;
  worktree: Worktree;
  // API-based agents get a session for multi-turn
  session: ChatSession | null;
  turnCount: number;
}

export async function runChat(agentFlag: string | null): Promise<void> {
  const repoPath = findRepoRoot();
  const config = loadConfig(repoPath);

  // ── Resolve agents — use ALL discovered models, not just API ───────────
  let agents: ModelDef[];
  if (agentFlag) {
    agents = parseAgentSpecs(agentFlag);
  } else if (config.agents && config.agents.length > 0) {
    printInfo(`Using agents from .council.yml`);
    agents = parseAgentSpecs(config.agents.join(","));
  } else {
    printInfo("Discovering agents...");
    const available = await discoverModels();
    if (available.length === 0) {
      printError("No agents found. Install claude, codex, or gemini CLI, or set API keys.");
      process.exit(1);
    }
    printSuccess(`Found ${available.length} agents`);
    agents = await selectAgents(available);
  }

  // ── Create worktrees and sessions ──────────────────────────────────────
  printInfo("Creating worktrees...");
  const chatAgents: ChatAgent[] = [];

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const wt = createWorktree(repoPath, `chat-${agent.id}`);
    trackWorktree(wt, repoPath);

    let session: ChatSession | null = null;

    // Only create API session for API runners (they need API keys)
    if (API_RUNNERS.has(agent.cli)) {
      const vendor = resolveVendor(agent.cli);
      const apiKey = getApiKey(vendor);
      if (!apiKey) {
        printError(`No API key for ${agent.cli}. Skipping.`);
        removeWorktree(repoPath, wt);
        continue;
      }
      session = new ChatSession(agent.id, vendor, agent.model, wt, apiKey);
    }
    // CLI runners don't need API keys — they have their own auth

    chatAgents.push({ def: agent, colorIndex: i, worktree: wt, session, turnCount: 0 });
    console.log(`    ${agentColor(i)}${ICON.check}${RST} ${agent.id} ${DIM}${ICON.arrow} ${wt.path}${RST}`);
  }

  if (chatAgents.length === 0) {
    printError("No valid agent sessions created.");
    process.exit(1);
  }

  printChatWelcome(chatAgents.map((a) => ({ id: a.def.id, colorIndex: a.colorIndex })));

  // ── REPL ───────────────────────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `  ${FG.brightCyan}you ${ICON.arrowR}${RST} `,
  });

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) { rl.prompt(); return; }

    // ── Slash commands ─────────────────────────────────────────────────
    if (trimmed.startsWith("/")) {
      await handleSlashCommand(trimmed, chatAgents, repoPath, rl);
      return;
    }

    // ── Send to all agents in parallel ─────────────────────────────────
    rl.pause();

    const thinking = new ThinkingIndicator();
    chatAgents.forEach((a) => thinking.add(a.def.id, a.colorIndex));
    thinking.start();

    const results = await Promise.allSettled(
      chatAgents.map(async (agent) => {
        const start = Date.now();
        agent.turnCount++;
        let result: ChatTurnResult;

        if (agent.session) {
          // API-based: multi-turn session
          result = await agent.session.send(trimmed, () => {});
        } else {
          // CLI-based: spawn the CLI tool per message in the same worktree
          result = await runCliTurn(agent, trimmed);
        }

        const duration = Date.now() - start;
        thinking.done(agent.def.id);
        return { agent, result, duration };
      })
    );

    thinking.stop();

    for (const r of results) {
      if (r.status === "fulfilled") {
        const { agent, result, duration } = r.value;
        printAgentResponse(agent.def.id, agent.colorIndex, result, duration);
      } else {
        printError(`Agent failed: ${r.reason}`);
      }
    }

    console.log();
    rl.resume();
    rl.prompt();
  });

  setBeforeExit(() => rl.close());
  rl.on("close", () => gracefulShutdown(0));
  rl.on("SIGINT", () => { console.log(); gracefulShutdown(130); });
}

// ── CLI turn: spawn with streaming or fallback to basic ──────────────────────

async function runCliTurn(agent: ChatAgent, message: string): Promise<ChatTurnResult> {
  const textParts: string[] = [];
  let toolCalls = 0;

  if (hasStreamingSupport(agent.def.cli)) {
    // Use streaming — get real-time events
    const streamOpts: StreamOpts = agent.def.reasoning ? { reasoning: true } : {};

    if (agent.def.cli === "claude") {
      await streamClaude(
        agent.worktree, message, agent.def.model,
        (_id, event: StreamEvent) => {
          if (event.type === "text" && event.text) textParts.push(event.text);
          if (event.type === "tool_call") toolCalls++;
        },
        () => {},
        streamOpts
      );
    } else {
      const streamFn = agent.def.cli === "codex" ? streamCodex : streamGemini;
      await streamFn(
        agent.worktree, message, agent.def.model,
        (_id, event: StreamEvent) => {
          if (event.type === "text" && event.text) textParts.push(event.text);
          if (event.type === "tool_call") toolCalls++;
        },
        () => {}
      );
    }
  } else {
    // Fallback to basic runner
    const runner = getRunner(agent.def.cli);
    const logs: string[] = [];
    const result = await runner(agent.worktree, message, agent.def.model, (_id, line) => logs.push(line));
    const textLines = logs.filter((l) =>
      !l.startsWith("[tool]") && !l.startsWith("[result]") && !l.startsWith("[iteration")
      && !l.startsWith("Model:") && !l.startsWith("Done")
    );
    textParts.push(textLines.join("\n").trim() || (result.error ?? "Done"));
    toolCalls = logs.filter((l) => l.startsWith("[tool]")).length;
    if (result.error) return { assistantText: result.error, toolCalls, messages: [], error: result.error };
  }

  return {
    assistantText: textParts.join("\n").trim() || "Done",
    toolCalls,
    messages: [],
  };
}

// ── Slash command dispatch ────────────────────────────────────────────────────

async function handleSlashCommand(
  input: string,
  agents: ChatAgent[],
  repoPath: string,
  rl: readline.Interface
): Promise<void> {
  const [cmd, ...args] = input.slice(1).split(/\s+/);

  switch (cmd) {
    case "quit": case "exit": case "q":
      await gracefulShutdown(0);
      return;

    case "help": case "h":
      printChatHelp();
      break;

    case "diff": {
      const target = args[0];
      if (target) {
        const match = agents.find((a) => a.def.id.includes(target));
        if (match) {
          printDiffs([{ agentId: match.def.id, diff: getDiff(match.worktree), result: { status: "done" } }]);
        } else {
          printError(`Agent not found: ${target}`);
        }
      } else {
        printDiffs(agents.map((a) => ({
          agentId: a.def.id,
          diff: getDiff(a.worktree),
          result: { status: "done" as const },
        })));
      }
      break;
    }

    case "apply": {
      const target = args[0];
      if (!target) { printError("Usage: /apply <agent>"); break; }
      const match = agents.find((a) => a.def.id.includes(target));
      if (!match) { printError(`Agent not found: ${target}`); break; }
      const diff = getDiff(match.worktree);
      if (!diff.trim()) { printError("No changes to apply"); break; }
      try {
        applyDiff(repoPath, diff);
        printSuccess(`Applied changes from ${match.def.id}`);
      } catch (err) {
        printError(`Failed: ${err}`);
      }
      break;
    }

    case "compare":
      printChatDiffSummary(agents.map((a) => ({
        id: a.def.id,
        colorIndex: a.colorIndex,
        diff: getDiff(a.worktree),
      })));
      break;

    case "reset":
      agents.forEach((a) => { a.session?.reset(); a.turnCount = 0; });
      printSuccess("All conversations reset");
      break;

    case "status":
      console.log();
      for (const a of agents) {
        const color = agentColor(a.colorIndex);
        const type = CLI_RUNNERS.has(a.def.cli) ? "CLI" : "API";
        console.log(`  ${color}${ICON.bullet}${RST} ${BOLD}${a.def.id}${RST}  ${DIM}[${type}] ${a.def.cli}:${a.def.model}${RST}  turns: ${a.turnCount}`);
      }
      console.log();
      break;

    default:
      printError(`Unknown command: /${cmd}. Type /help for commands.`);
  }

  rl.prompt();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveVendor(cli: string): Vendor {
  if (VENDOR_MAP[cli]) return VENDOR_MAP[cli];
  if (cli === "claude") return "anthropic";
  if (cli === "codex") return "openai";
  if (cli === "gemini-cli") return "google";
  return "anthropic";
}

function getApiKey(vendor: Vendor): string {
  switch (vendor) {
    case "anthropic": return process.env.ANTHROPIC_API_KEY ?? "";
    case "openai":    return process.env.OPENAI_API_KEY ?? "";
    case "google":    return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
    default:          return "";
  }
}
