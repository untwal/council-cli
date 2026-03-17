import { Role, buildRolePrompt } from "./roles";
import {
  Artifact, ArtifactType, saveArtifact, formatArtifactsForPrompt,
  savePipelineState, PipelineState, RoleMetrics,
} from "./artifacts";
import { ModelDef } from "./models";
import { parseAgentSpec } from "./parse-agent-spec";
import { createWorktree, getDiff, removeWorktree, applyDiff, Worktree } from "./worktree";
import { getRunner, hasStreamingSupport, AgentRunnerOpts } from "./agents";
import { streamClaude, streamCodex, streamGemini, StreamCallback, StreamOpts } from "./streaming";
import { LiveDashboard } from "./ui/dashboard";
import { StreamView } from "./ui/stream-view";
import { pickDiverseDefaults, pickCompareAgents } from "./ui/prompt";
import { prompt, confirm } from "./ui/prompt";
import {
  printDiffs, printInfo, printSuccess, printWarning, printError,
} from "./ui/render";
import { RST, BOLD, DIM, FG, ICON, agentColor } from "./ui/theme";
import { trackWorktree, setBeforeExit, killAgent } from "./process";
import { notifyPipelineStart, notifyRoleComplete, notifyPipelineComplete, notifyPipelineError } from "./notify";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineOpts {
  featureRequest: string;
  roles: Role[];
  repoPath: string;
  runId: string;
  availableAgents: ModelDef[];
  maxRetries: number;
  agentTimeoutMs?: number;  // per-agent timeout, default 15 minutes
  resumeArtifacts?: Artifact[];  // artifacts from a previous interrupted run
  autoSelect?: boolean;  // auto-pick first valid diff in compare mode (for bot/CI)
  userSpecifiedAgents?: boolean;  // true when --agents flag was used (use ALL, don't filter)
  onRoleComplete?: (role: string, artifact: Artifact) => void;  // callback after each role
}

export interface PipelineResult {
  artifacts: Artifact[];
  accepted: boolean;
  totalTimeMs: number;
}

interface CeoDecision {
  decision: "approve" | "reject";
  reasoning: string;
  send_back_to?: string;
}

// ── Phase bar for company pipeline ───────────────────────────────────────────

function printCompanyPhase(roles: Role[], currentIdx: number): void {
  const parts = roles.map((role, i) => {
    const label = role.title;
    if (i < currentIdx) return `${FG.brightGreen}${ICON.check} ${label}${RST}`;
    if (i === currentIdx) return `${FG.brightCyan}${BOLD}${ICON.bullet} ${label}${RST}`;
    return `${DIM}${ICON.circle} ${label}${RST}`;
  });
  console.log();
  console.log(`  ${parts.join(`  ${FG.gray}${ICON.arrow}${RST}  `)}`);
  console.log();
}

// ── Main pipeline runner ─────────────────────────────────────────────────────

export async function runPipeline(opts: PipelineOpts): Promise<PipelineResult> {
  const { featureRequest, roles, repoPath, runId, availableAgents, maxRetries } = opts;
  if (opts.agentTimeoutMs) setAgentTimeout(opts.agentTimeoutMs);
  const startTime = Date.now();
  const artifacts: Artifact[] = [...(opts.resumeArtifacts ?? [])];
  let accepted = false;
  const completedRoles: string[] = (opts.resumeArtifacts ?? []).map((a) => a.producerRole);
  const roleMetrics: RoleMetrics[] = [];

  notifyPipelineStart(featureRequest, runId, roles.map((r) => r.name)).catch(() => {});

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];

    // Skip roles already completed in a previous run (resume)
    if (completedRoles.includes(role.name)) {
      printCompanyPhase(roles, i);
      printSuccess(`${role.title} — resumed from checkpoint`);
      continue;
    }

    printCompanyPhase(roles, i);
    const roleAgentHint = role.mode === "compare" ? ` ${DIM}(${role.mode} mode — multiple agents racing)${RST}` : "";
    console.log(`  ${FG.brightCyan}${ICON.gear}${RST} ${BOLD}${role.title}${RST} is working...${roleAgentHint}`);
    console.log(`  ${DIM}Reading codebase, generating ${role.artifactType}...${RST}`);
    console.log();

    const artifactBlock = formatArtifactsForPrompt(artifacts, role.inputArtifacts);
    const taskPrompt = buildRolePrompt(role, featureRequest, artifactBlock);

    // Resolve agent(s) for this role
    const roleAgents = resolveRoleAgents(role, availableAgents, opts.userSpecifiedAgents);

    const roleStart = Date.now();
    let artifact: Artifact;

    if (role.mode === "compare" && roleAgents.length >= 2) {
      artifact = await runCompareRole(role, roleAgents, taskPrompt, repoPath, runId, opts.autoSelect);
    } else {
      artifact = await runSingleRole(role, roleAgents[0], taskPrompt, repoPath, runId);
    }

    const roleDurationMs = Date.now() - roleStart;
    roleMetrics.push({ role: role.name, agent: artifact.producerAgent, durationMs: roleDurationMs, retries: 0 });

    artifacts.push(artifact);
    completedRoles.push(role.name);
    saveArtifact(repoPath, artifact, i);

    // Save pipeline checkpoint after each role
    savePipelineState(repoPath, {
      runId,
      featureRequest,
      roleNames: roles.map((r) => r.name),
      completedRoles: [...completedRoles],
      artifacts: [...artifacts],
      roleMetrics: [...roleMetrics],
      accepted,
      startedAt: startTime,
    });

    printSuccess(`${role.title} produced: ${artifact.type} (${(artifact.content.length / 1024).toFixed(1)}KB) ${DIM}${Math.round(roleDurationMs / 1000)}s${RST}`);
    opts.onRoleComplete?.(role.name, artifact);
    notifyRoleComplete(featureRequest, role.name, role.title, Math.round(roleDurationMs / 1000)).catch(() => {});

    // CEO gate
    if (role.name === "ceo") {
      const decision = parseCeoDecision(artifact.content);
      if (decision.decision === "approve") {
        accepted = true;
        console.log(`  ${FG.brightGreen}${ICON.trophy}${RST} ${BOLD}CEO approved:${RST} ${decision.reasoning}`);
      } else {
        console.log(`  ${FG.brightRed}${ICON.cross}${RST} ${BOLD}CEO rejected:${RST} ${decision.reasoning}`);

        // Retry loop — validate send_back_to target
        const retryFrom = decision.send_back_to ?? "developer";
        let retryIdx = roles.findIndex((r) => r.name === retryFrom);
        if (retryIdx < 0 || retryIdx >= i) {
          // Invalid target — fall back to developer
          printWarning(`Invalid send_back_to "${retryFrom}", falling back to developer`);
          retryIdx = roles.findIndex((r) => r.name === "developer");
          if (retryIdx < 0) retryIdx = Math.max(0, i - 1);
        }
        {
          let retryCount = 0;
          while (!accepted && retryCount < maxRetries) {
            retryCount++;
            console.log();
            printWarning(`Retry ${retryCount}/${maxRetries}: sending back to ${roles[retryIdx].title}`);

            // Re-run from retryIdx through CEO
            for (let j = retryIdx; j <= i; j++) {
              const retryRole = roles[j];
              printCompanyPhase(roles, j);
              console.log(`  ${FG.brightYellow}${ICON.gear}${RST} ${BOLD}${retryRole.title}${RST} (retry ${retryCount})...`);
              console.log();

              const retryArtifactBlock = formatArtifactsForPrompt(artifacts, retryRole.inputArtifacts);
              const feedback = j === retryIdx
                ? `\n\n## CEO Feedback (Retry ${retryCount})\n${decision.reasoning}\n\nPlease address the CEO's feedback and try again.`
                : "";
              const retryPrompt = buildRolePrompt(retryRole, featureRequest, retryArtifactBlock) + feedback;

              const retryAgents = resolveRoleAgents(retryRole, availableAgents, opts.userSpecifiedAgents);
              let retryArtifact: Artifact;

              const retryStart = Date.now();
              if (retryRole.mode === "compare" && retryAgents.length >= 2) {
                retryArtifact = await runCompareRole(retryRole, retryAgents, retryPrompt, repoPath, runId);
              } else {
                retryArtifact = await runSingleRole(retryRole, retryAgents[0], retryPrompt, repoPath, runId);
              }
              const retryDurationMs = Date.now() - retryStart;

              // Update metrics — increment retries for this role
              const existingMetric = roleMetrics.find((m) => m.role === retryRole.name);
              if (existingMetric) {
                existingMetric.retries = retryCount;
                existingMetric.durationMs += retryDurationMs;
              } else {
                roleMetrics.push({ role: retryRole.name, agent: retryArtifact.producerAgent, durationMs: retryDurationMs, retries: retryCount });
              }

              // Replace the old artifact of this type
              const existingIdx = artifacts.findIndex((a) => a.type === retryArtifact.type);
              if (existingIdx >= 0) artifacts[existingIdx] = retryArtifact;
              else artifacts.push(retryArtifact);
              saveArtifact(repoPath, retryArtifact, j);

              printSuccess(`${retryRole.title} produced: ${retryArtifact.type}`);

              if (retryRole.name === "ceo") {
                const retryDecision = parseCeoDecision(retryArtifact.content);
                if (retryDecision.decision === "approve") {
                  accepted = true;
                  console.log(`  ${FG.brightGreen}${ICON.trophy}${RST} ${BOLD}CEO approved:${RST} ${retryDecision.reasoning}`);
                } else {
                  console.log(`  ${FG.brightRed}${ICON.cross}${RST} ${BOLD}CEO rejected again:${RST} ${retryDecision.reasoning}`);
                }
              }
            }
          }
        }
      }
    }
  }

  notifyPipelineComplete(featureRequest, runId, accepted, Date.now() - startTime, artifacts.length).catch(() => {});

  // Final checkpoint
  savePipelineState(repoPath, {
    runId, featureRequest,
    roleNames: roles.map((r) => r.name),
    completedRoles: [...completedRoles],
    artifacts: [...artifacts],
    roleMetrics: [...roleMetrics],
    accepted,
    startedAt: startTime,
    finishedAt: Date.now(),
  });

  return { artifacts, accepted, totalTimeMs: Date.now() - startTime };
}

// ── Single-role execution ────────────────────────────────────────────────────

async function runSingleRole(
  role: Role,
  agent: ModelDef,
  taskPrompt: string,
  repoPath: string,
  runId: string
): Promise<Artifact> {
  const wt = createWorktree(repoPath, `company-${role.name}`);
  trackWorktree(wt, repoPath);

  console.log(`    ${agentColor(0)}${ICON.check}${RST} ${agent.id} ${DIM}${ICON.arrow} ${wt.path}${RST}`);
  console.log();

  let content: string;

  try {
    if (role.artifactType === "code" || role.artifactType === "qa_report") {
      const log = await runAgent(wt, taskPrompt, agent);
      const diff = getDiff(wt);
      content = role.artifactType === "code"
        ? diff || "(No file changes produced)"
        : extractModelOutput(log) + (diff ? `\n\n## Changes Made\n\`\`\`diff\n${diff}\n\`\`\`` : "");
    } else {
      const log = await runAgent(wt, taskPrompt, agent);
      content = extractModelOutput(log);
    }
  } finally {
    removeWorktree(repoPath, wt);
  }

  return {
    type: role.artifactType,
    content,
    producerRole: role.name,
    producerAgent: agent.id,
    timestamp: Date.now(),
    runId,
  };
}

// ── Compare-role execution (Developer) ───────────────────────────────────────

async function runCompareRole(
  role: Role,
  agents: ModelDef[],
  taskPrompt: string,
  repoPath: string,
  runId: string,
  autoSelect = false
): Promise<Artifact> {
  const worktreeMap = new Map<string, Worktree>();
  let winnerDiff = "";
  let winnerAgent = agents[0].id;

  try {
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const wt = createWorktree(repoPath, `company-${role.name}-${i}`);
      worktreeMap.set(agent.id, wt);
      trackWorktree(wt, repoPath);
      console.log(`    ${agentColor(i)}${ICON.check}${RST} ${agent.id} ${DIM}${ICON.arrow} ${wt.path}${RST}`);
    }
    console.log();

    const allStreaming = agents.every((a) => hasStreamingSupport(a.cli));

    if (allStreaming) {
      await runCompareStreaming(agents, worktreeMap, taskPrompt);
    } else {
      await runCompareDashboard(agents, worktreeMap, taskPrompt);
    }

    const diffs = agents.map((agent) => {
      const wt = worktreeMap.get(agent.id)!;
      return { agentId: agent.id, diff: getDiff(wt), result: { status: "done" as const } };
    });

    printDiffs(diffs);

    const doneDiffs = diffs.filter((d) => d.diff.trim());

    if (doneDiffs.length > 0) {
      let target: typeof diffs[0];
      if (autoSelect) {
        target = doneDiffs[0];
      } else {
        const answer = await prompt(
          `${BOLD}Pick the winning implementation:${RST} ${DIM}(number or Enter for best)${RST} `
        );
        const idx = answer ? parseInt(answer, 10) - 1 : -1;
        target = idx >= 0 && idx < diffs.length ? diffs[idx] : doneDiffs[0];
      }
      winnerDiff = target.diff;
      winnerAgent = target.agentId;
      printSuccess(`Selected: ${winnerAgent}`);

      try {
        applyDiff(repoPath, winnerDiff);
      } catch {
        printWarning("Could not auto-apply diff to working tree");
      }
    }
  } finally {
    // Always cleanup worktrees, even on error
    for (const wt of worktreeMap.values()) {
      try { removeWorktree(repoPath, wt); } catch { /**/ }
    }
  }

  return {
    type: role.artifactType,
    content: winnerDiff || "(No file changes produced)",
    producerRole: role.name,
    producerAgent: winnerAgent,
    timestamp: Date.now(),
    runId,
  };
}

// ── Agent execution helpers ──────────────────────────────────────────────────

const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
let currentAgentTimeout = DEFAULT_AGENT_TIMEOUT_MS;

export function setAgentTimeout(ms: number): void {
  currentAgentTimeout = ms;
}

async function runAgent(wt: Worktree, task: string, agent: ModelDef): Promise<string[]> {
  const runner = getRunner(agent.cli);
  const opts: AgentRunnerOpts = agent.reasoning ? { reasoning: true } : {};
  const log: string[] = [];

  const agentPromise = runner(wt, task, agent.model, (_id, line) => log.push(line), opts);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Kill the agent process to prevent zombies
      killAgent(wt.agentId);
      reject(new Error(`Agent ${agent.id} timed out after ${Math.round(currentAgentTimeout / 60000)}min`));
    }, currentAgentTimeout);
  });

  try {
    await Promise.race([agentPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return log;
}

function extractModelOutput(log: string[]): string {
  // Filter for model text output — skip tool calls, iterations, meta lines
  const textLines = log.filter((l) =>
    !l.startsWith("[tool]") && !l.startsWith("[result]") && !l.startsWith("[iteration")
    && !l.startsWith("Model:") && !l.startsWith("Done —") && !l.startsWith("[error]")
    && !l.startsWith("[stderr]")
  );
  // Remove [model] prefix if present
  return textLines
    .map((l) => l.replace(/^\[model\]\s*/, ""))
    .join("\n")
    .trim() || "(No output)";
}

async function runCompareStreaming(
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

async function runCompareDashboard(
  agents: ModelDef[],
  worktreeMap: Map<string, Worktree>,
  task: string
): Promise<void> {
  const dashboard = new LiveDashboard("Developer: Implementing");
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

// ── CEO decision parsing ─────────────────────────────────────────────────────

export function parseCeoDecision(content: string): CeoDecision {
  try {
    const json = extractJson(content);
    const parsed = JSON.parse(json);
    if (parsed.decision === "approve" || parsed.decision === "reject") {
      return {
        decision: parsed.decision,
        reasoning: parsed.reasoning ?? "",
        send_back_to: parsed.send_back_to,
      };
    }
  } catch { /* fall through to keyword matching */ }

  // Keyword matching — require explicit "approve" to pass
  const lower = content.toLowerCase();
  if (lower.includes("approve") && !lower.includes("reject")) {
    return { decision: "approve", reasoning: content.slice(0, 200) };
  }
  // Default to reject — safer than auto-approving unparseable output
  return {
    decision: "reject",
    reasoning: content.includes("reject") ? content.slice(0, 200) : "Could not parse CEO decision — defaulting to reject for safety",
    send_back_to: "developer",
  };
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

// ── Agent resolution ─────────────────────────────────────────────────────────

function resolveRoleAgents(role: Role, available: ModelDef[], userSpecified = false): ModelDef[] {
  if (available.length === 0) {
    throw new Error(`No agents available for role "${role.name}". Set API keys or install agent CLIs.`);
  }

  // --agents flag (user CLI input) ALWAYS wins over config
  if (userSpecified) {
    if (role.mode === "compare") {
      return available.length >= 2 ? available : [available[0]];
    }
    return [available[0]];
  }

  // Role has an explicit agent spec from .council.yml config — use it as default
  if (role.agentSpec) {
    const specs = role.agentSpec.split(",").map((s) => parseAgentSpec(s.trim()));
    for (const spec of specs) {
      const known = ["claude", "codex", "gemini-cli", "iloom", "anthropic", "openai", "gemini"];
      if (!known.includes(spec.cli)) {
        printWarning(`Unknown agent CLI "${spec.cli}" for role ${role.name} — may fail at runtime`);
      }
    }
    return specs;
  }

  // Auto-discovery: pick diverse set for compare, best single for others
  if (role.mode === "compare") {
    return pickCompareAgents(available, false);
  }

  // Prefer reasoning/opus for architect/ceo
  if (role.name === "architect" || role.name === "ceo") {
    const reasoning = available.find((a) => a.reasoning);
    if (reasoning) return [reasoning];
    const opus = available.find((a) => /opus/i.test(a.model));
    if (opus) return [opus];
  }

  return [available[0]];
}
