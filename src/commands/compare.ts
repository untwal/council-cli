import { findRepoRoot, createWorktree, getDiff, removeWorktree, Worktree } from "../worktree";
import { getRunner, hasStreamingSupport, AgentResult, AgentRunnerOpts } from "../agents";
import { discoverModels, ModelDef } from "../models";
import { parseAgentSpecs } from "../parse-agent-spec";
import { streamClaude, streamCodex, streamGemini, StreamCallback, StreamOpts } from "../streaming";
import { StreamView, printEvalResults } from "../ui/stream-view";
import { LiveDashboard } from "../ui/dashboard";
import { printAgentPlan, printTask, printDiffs, printError, printInfo, printSuccess, printWarning } from "../ui/render";
import { prompt, confirm, selectAgents } from "../ui/prompt";
import { RST, BOLD, DIM, FG, ICON, agentColor, elapsed } from "../ui/theme";
import { trackWorktree, setBeforeExit } from "../process";
import { loadConfig } from "../config";
import { evaluate, EvalResult } from "../eval";

export async function runCompare(taskArg: string | null, agentFlag: string | null): Promise<void> {
  const repoPath = findRepoRoot();
  const config = loadConfig(repoPath);
  const startTime = Date.now();

  // ── Get task ───────────────────────────────────────────────────────────
  const task = taskArg || await prompt(`${BOLD}Task:${RST} `);
  if (!task) { printError("No task provided"); process.exit(1); }
  printTask(task);

  // ── Resolve agents ─────────────────────────────────────────────────────
  let agents: ModelDef[];
  if (agentFlag) {
    agents = parseAgentSpecs(agentFlag);
  } else if (config.agents && config.agents.length >= 2) {
    printInfo(`Using agents from .council.yml`);
    agents = parseAgentSpecs(config.agents.join(","));
  } else {
    printInfo("Discovering available agents...");
    const available = await discoverModels();
    if (available.length < 2) {
      printError("Not enough agents found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.");
      process.exit(1);
    }
    printSuccess(`Found ${available.length} agents`);
    agents = await selectAgents(available);
  }

  printAgentPlan(agents);

  // ── Create worktrees ───────────────────────────────────────────────────
  printInfo("Creating worktrees...");
  const worktreeMap = new Map<string, Worktree>();
  for (const agent of agents) {
    try {
      const wt = createWorktree(repoPath, agent.id);
      worktreeMap.set(agent.id, wt);
      trackWorktree(wt, repoPath);
      console.log(`    ${agentColor(agents.indexOf(agent))}${ICON.check}${RST} ${agent.id} ${DIM}${ICON.arrow} ${wt.path}${RST}`);
    } catch (err) {
      for (const wt of worktreeMap.values()) removeWorktree(repoPath, wt);
      printError(`Failed to create worktree for ${agent.id}: ${err}`);
      process.exit(1);
    }
  }
  console.log();

  // ── Decide: streaming or classic dashboard ─────────────────────────────
  const allStreaming = agents.every((a) => hasStreamingSupport(a.cli));

  if (allStreaming) {
    await runWithStreaming(agents, worktreeMap, task);
  } else {
    await runWithDashboard(agents, worktreeMap, task);
  }

  // ── Collect diffs ──────────────────────────────────────────────────────
  const diffs = agents.map((agent) => {
    const wt = worktreeMap.get(agent.id)!;
    return { agentId: agent.id, diff: getDiff(wt), result: { status: "done" as const } };
  });

  printDiffs(diffs);

  // ── Real evaluation ────────────────────────────────────────────────────
  const evalCmds = config.evaluate ?? [];
  const hasDiffs = diffs.some((d) => d.diff.trim());

  if (hasDiffs) {
    const shouldEval = evalCmds.length > 0
      ? true
      : await confirm(`${BOLD}Run evaluation checks?${RST} ${DIM}(auto-detects tsc, tests, lint)${RST}`);

    if (shouldEval) {
      printInfo("Running evaluation...");
      console.log();
      const evalResults: EvalResult[] = [];
      for (const agent of agents) {
        const wt = worktreeMap.get(agent.id)!;
        const diff = diffs.find((d) => d.agentId === agent.id);
        if (!diff?.diff.trim()) continue;
        const result = evaluate(wt, evalCmds.length > 0 ? evalCmds : undefined);
        evalResults.push(result);
      }
      if (evalResults.length > 0) {
        printEvalResults(evalResults);
      } else {
        printWarning("No agents produced changes to evaluate");
      }
    }
  }

  // ── Apply ──────────────────────────────────────────────────────────────
  const doneDiffs = diffs.filter((d) => d.diff.trim());
  if (doneDiffs.length > 0) {
    const applyAnswer = await prompt(
      `${BOLD}Apply an agent's changes?${RST} ${DIM}(enter agent number or n)${RST} `
    );
    if (applyAnswer && applyAnswer !== "n" && applyAnswer !== "N") {
      const idx = parseInt(applyAnswer, 10) - 1;
      const target = idx >= 0 && idx < diffs.length ? diffs[idx] : doneDiffs[0];
      try {
        const { applyDiff } = await import("../worktree");
        applyDiff(repoPath, target.diff);
        printSuccess(`Applied changes from ${target.agentId}`);
      } catch (err) {
        printError(`Failed to apply: ${err}`);
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  const doCleanup = await confirm("Clean up worktrees?");
  if (doCleanup) {
    for (const wt of worktreeMap.values()) removeWorktree(repoPath, wt);
    printSuccess("Cleaned up");
  } else {
    console.log(`\n  ${DIM}Worktrees kept:${RST}`);
    for (const [id, wt] of worktreeMap) console.log(`    ${id}: ${wt.path}`);
  }

  console.log(`\n  ${DIM}Total time: ${elapsed(Date.now() - startTime)}${RST}\n`);
}

// ── Streaming execution ──────────────────────────────────────────────────────

async function runWithStreaming(
  agents: ModelDef[],
  worktreeMap: Map<string, Worktree>,
  task: string
): Promise<void> {
  const view = new StreamView();
  agents.forEach((a, i) => view.register(a.id, i));
  setBeforeExit(() => view.stop());
  view.start();

  const promises = agents.map((agent) => {
    const wt = worktreeMap.get(agent.id)!;
    const onEvent: StreamCallback = (id, event) => view.handleEvent(id, event);
    const onLog = () => {};
    const streamOpts: StreamOpts = agent.reasoning ? { reasoning: true } : {};

    switch (agent.cli) {
      case "claude":     return streamClaude(wt, task, agent.model, onEvent, onLog, streamOpts);
      case "codex":      return streamCodex(wt, task, agent.model, onEvent, onLog);
      case "gemini-cli": return streamGemini(wt, task, agent.model, onEvent, onLog);
      default:           throw new Error(`No streaming for ${agent.cli}`);
    }
  });

  await Promise.allSettled(promises);
  view.stop();
}

// ── Classic dashboard (fallback for API-based agents) ────────────────────────

async function runWithDashboard(
  agents: ModelDef[],
  worktreeMap: Map<string, Worktree>,
  task: string
): Promise<void> {
  const dashboard = new LiveDashboard("Comparing agents");
  agents.forEach((a, i) => dashboard.register(a.id, i, a.label));
  setBeforeExit(() => dashboard.stop());
  dashboard.start();

  const promises = agents.map((agent) => {
    const wt = worktreeMap.get(agent.id)!;
    const runner = getRunner(agent.cli);
    const opts: AgentRunnerOpts = agent.reasoning ? { reasoning: true } : {};
    return runner(wt, task, agent.model, (id, line) => {
      dashboard.update(id, line);
    }, opts).then((result) => {
      dashboard.done(agent.id, result.status === "done" ? "done" : "error");
      return result;
    });
  });

  await Promise.allSettled(promises);
  dashboard.stop();
}
