import { findRepoRoot, createWorktree, getDiff, removeWorktree, Worktree } from "../worktree";
import { getRunner, AgentResult, AgentRunnerOpts, LogCallback } from "../agents";
import { discoverModels, getDiscoveryWarnings, ModelDef } from "../models";
import { generatePlan, reviewDiff } from "../orchestrator/planner";
import { ImplementationPlan, SubTask, OrchestratorPhase, ReviewResult } from "../orchestrator/types";
import { LiveDashboard } from "../ui/dashboard";
import {
  printPhaseBar, printPlan, printReview, printDecision,
  printMergePreview, printComplete, printError, printInfo, printSuccess, printWarning,
} from "../ui/render";
import { prompt, confirm } from "../ui/prompt";
import { RST, BOLD, FG, ICON, dim, elapsed } from "../ui/theme";
import { trackWorktree, setBeforeExit } from "../process";

const MAX_REVIEW_ITERATIONS = 2;

export async function runOrchestrate(descriptionArg: string | null): Promise<void> {
  const repoPath = findRepoRoot();
  const startTime = Date.now();

  // ── 1. Gather description ──────────────────────────────────────────────
  const description = descriptionArg || await prompt(`${BOLD}Feature description:${RST} `);
  if (!description) {
    printError("No feature description provided");
    process.exit(1);
  }

  // Ask for constraints
  let constraints: string[] = [];
  const constraintInput = await prompt(`${dim("Constraints (comma-separated, or Enter to skip):")} `);
  if (constraintInput) {
    constraints = constraintInput.split(",").map((s) => s.trim()).filter(Boolean);
  }

  // ── 2. Discover agents ─────────────────────────────────────────────────
  setPhase("gathering_context");
  printInfo("Discovering available agents...");

  const available = await discoverModels();
  for (const w of getDiscoveryWarnings()) printWarning(w);
  if (available.length === 0) {
    printError("No agents found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.");
    process.exit(1);
  }

  printSuccess(`Found ${available.length} agents`);
  console.log();

  // ── 3. Generate plan ───────────────────────────────────────────────────
  setPhase("planning");
  printInfo("CTO is analyzing your request and creating a plan...");
  console.log();

  let plan: ImplementationPlan;
  try {
    plan = generatePlan(repoPath, description, constraints, available);
  } catch (err) {
    printError(`Planning failed: ${err}`);
    process.exit(1);
  }

  // ── 4. Show plan and await approval ────────────────────────────────────
  setPhase("awaiting_approval");
  printPlan({
    summary: plan.summary,
    reasoning: plan.reasoning,
    tasks: plan.tasks.map((t) => ({
      ...t,
      assignedAgent: t.assignedAgent,
    })),
    qualityCriteria: plan.qualityCriteria,
  });

  const approved = await confirm(`${BOLD}Approve this plan?${RST}`);
  if (!approved) {
    printWarning("Plan rejected. Exiting.");
    return;
  }

  // ── 5. Execute tasks ───────────────────────────────────────────────────
  setPhase("executing");
  console.log();

  const worktreeMap = new Map<string, Worktree>();
  const taskDiffs = new Map<string, string>();
  const taskResults = new Map<string, AgentResult>();

  // Create worktrees for all tasks
  for (const task of plan.tasks) {
    try {
      const wt = createWorktree(repoPath, `orch-${task.id}`);
      worktreeMap.set(task.id, wt);
      trackWorktree(wt, repoPath);
    } catch (err) {
      printError(`Worktree for ${task.id} failed: ${err}`);
    }
  }

  // Topological sort and parallel execution
  const batches = topologicalSort(plan.tasks);
  const dashboard = new LiveDashboard("Orchestrator: Executing");

  for (const batch of batches) {
    // Register batch agents
    for (const task of batch) {
      const agentDef = available.find((a) => a.id === task.assignedAgent) ?? available[0];
      const idx = plan.tasks.indexOf(task);
      dashboard.register(task.id, idx, `${task.id}: ${task.title}`);
    }
  }

  setBeforeExit(() => dashboard.stop());
  dashboard.start();

  for (const batch of batches) {
    const promises = batch.map(async (task) => {
      const wt = worktreeMap.get(task.id);
      if (!wt) return;

      const agentDef = available.find((a) => a.id === task.assignedAgent) ?? available[0];
      const runner = getRunner(agentDef.cli);
      const opts: AgentRunnerOpts = agentDef.reasoning ? { reasoning: true } : {};

      const result = await runner(wt, task.description, agentDef.model, (id, line) => {
        dashboard.update(task.id, line);
      }, opts);

      dashboard.done(task.id, result.status === "done" ? "done" : "error");
      taskResults.set(task.id, result);

      const diff = getDiff(wt);
      taskDiffs.set(task.id, diff);
    });

    await Promise.all(promises);
  }

  dashboard.stop();

  // ── 6. Review phase ────────────────────────────────────────────────────
  setPhase("reviewing");
  console.log();
  printInfo("CTO is reviewing each task output...");
  console.log();

  const reviews = new Map<string, ReviewResult>();

  for (const task of plan.tasks) {
    const diff = taskDiffs.get(task.id) ?? "";
    if (!diff.trim()) {
      printWarning(`${task.id}: No changes produced`);
      continue;
    }

    let review = reviewDiff(task.title, task.description, diff, plan.qualityCriteria);
    const reviewResult: ReviewResult = {
      taskId: task.id,
      passed: review.passed,
      score: {
        codeQuality: review.score.codeQuality ?? 5,
        correctness: review.score.correctness ?? 5,
        completeness: review.score.completeness ?? 5,
        maintainability: review.score.maintainability ?? 5,
        overall: review.score.overall ?? 5,
      },
      feedback: review.feedback,
    };

    printReview(task.id, task.title, reviewResult.score, reviewResult.feedback, reviewResult.passed);

    // Iterate if failed
    let iteration = 0;
    while (!reviewResult.passed && iteration < MAX_REVIEW_ITERATIONS) {
      iteration++;
      setPhase("iterating");
      printDecision("iterating", `Re-running ${task.title} with feedback`, review.feedback);

      const wt = worktreeMap.get(task.id);
      if (!wt) break;

      const agentDef = available.find((a) => a.id === task.assignedAgent) ?? available[0];
      const runner = getRunner(agentDef.cli);
      const retryOpts: AgentRunnerOpts = agentDef.reasoning ? { reasoning: true } : {};
      const feedbackPrompt = `${task.description}\n\nPrevious attempt scored ${review.score.overall}/10. Reviewer feedback:\n${review.feedback}\n\nPlease fix the issues.`;

      const retryDashboard = new LiveDashboard(`Iterating: ${task.title}`);
      retryDashboard.register(task.id, plan.tasks.indexOf(task), task.title);
      retryDashboard.start();

      await runner(wt, feedbackPrompt, agentDef.model, (id, line) => {
        retryDashboard.update(task.id, line);
      }, retryOpts);
      retryDashboard.done(task.id, "done");
      retryDashboard.stop();

      const newDiff = getDiff(wt);
      taskDiffs.set(task.id, newDiff);

      review = reviewDiff(task.title, task.description, newDiff, plan.qualityCriteria);
      reviewResult.passed = review.passed;
      reviewResult.score = review.score as ReviewResult["score"];
      reviewResult.feedback = review.feedback;

      printReview(task.id, task.title, reviewResult.score, reviewResult.feedback, reviewResult.passed);
    }

    reviews.set(task.id, reviewResult);
  }

  // ── 7. Merge preview ───────────────────────────────────────────────────
  setPhase("merging");

  const mergeItems: Array<{ taskTitle: string; files: number; additions: number; deletions: number }> = [];
  for (const task of plan.tasks) {
    const diff = taskDiffs.get(task.id) ?? "";
    if (!diff.trim()) continue;
    const adds = (diff.match(/^\+(?!\+\+)/gm) ?? []).length;
    const dels = (diff.match(/^-(?!--)/gm) ?? []).length;
    const files = new Set(diff.match(/^diff --git /gm) ?? []).size;
    mergeItems.push({ taskTitle: task.title, files, additions: adds, deletions: dels });
  }

  printMergePreview(mergeItems);

  const doMerge = await confirm(`${BOLD}Apply all changes to your working tree?${RST}`);
  if (doMerge) {
    let applied = 0;
    for (const task of plan.tasks) {
      const diff = taskDiffs.get(task.id) ?? "";
      if (!diff.trim()) continue;

      try {
        const { applyDiff } = await import("../worktree");
        applyDiff(repoPath, diff);
        applied++;
        printSuccess(`Applied: ${task.title}`);
      } catch (err) {
        printError(`Failed to apply ${task.title}: ${err}`);
      }
    }
    printSuccess(`Applied ${applied} task(s) to your working tree`);
  }

  // ── 8. Cleanup ─────────────────────────────────────────────────────────
  const doCleanup = await confirm("Clean up worktrees?");
  if (doCleanup) {
    for (const wt of worktreeMap.values()) {
      removeWorktree(repoPath, wt);
    }
    printSuccess("Worktrees cleaned up");
  }

  setPhase("complete");
  printComplete(plan.summary, Date.now() - startTime);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function setPhase(phase: OrchestratorPhase): void {
  console.log();
  printPhaseBar(phase);
}

function topologicalSort(tasks: SubTask[]): SubTask[][] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, task.dependencies.filter((d) => taskMap.has(d)).length);
    for (const dep of task.dependencies) {
      if (!adj.has(dep)) adj.set(dep, []);
      adj.get(dep)!.push(task.id);
    }
  }

  const batches: SubTask[][] = [];
  const remaining = new Set(tasks.map((t) => t.id));

  while (remaining.size > 0) {
    const batch: SubTask[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        const task = taskMap.get(id);
        if (task) batch.push(task);
      }
    }

    if (batch.length === 0) {
      for (const id of remaining) {
        const task = taskMap.get(id);
        if (task) batch.push(task);
      }
      batches.push(batch);
      break;
    }

    for (const task of batch) {
      remaining.delete(task.id);
      for (const next of adj.get(task.id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 1) - 1);
      }
    }
    batches.push(batch);
  }

  return batches;
}
