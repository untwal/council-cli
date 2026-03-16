import { findRepoRoot } from "../worktree";
import { discoverModels, ModelDef } from "../models";
import { DEFAULT_ROLES, Role, createCustomRole } from "../roles";
import {
  createRunId, artifactDir, cleanupArtifacts,
  loadPipelineState, listPipelineRuns, Artifact,
} from "../artifacts";
import { runPipeline, PipelineResult } from "../pipeline";
import { parseAgentSpecs } from "../parse-agent-spec";
import { loadConfig } from "../config";
import { prompt, confirm } from "../ui/prompt";
import {
  printInfo, printSuccess, printError, printWarning, printComplete,
} from "../ui/render";
import { RST, BOLD, DIM, FG, ICON, elapsed } from "../ui/theme";

export async function runCompany(
  taskArg: string | null,
  agentFlag: string | null,
  rolesFlag: string | null,
  resumeFlag: string | null,
  dryRun = false
): Promise<void> {
  const repoPath = findRepoRoot();
  const config = loadConfig(repoPath);

  // ── Resume mode ──────────────────────────────────────────────────────
  let resumeRunId: string | null = null;
  let resumeArtifacts: Artifact[] | undefined;
  let featureRequest: string;

  if (resumeFlag) {
    // If "latest", find the most recent run
    if (resumeFlag === "latest") {
      const runs = listPipelineRuns(repoPath);
      if (runs.length === 0) {
        printError("No previous pipeline runs found to resume.");
        process.exit(1);
      }
      resumeRunId = runs[0].runId;
    } else {
      resumeRunId = resumeFlag;
    }

    const state = loadPipelineState(repoPath, resumeRunId);
    if (!state) {
      printError(`No pipeline state found for run: ${resumeRunId}`);
      process.exit(1);
    }

    featureRequest = state.featureRequest;
    resumeArtifacts = state.artifacts;
    const completed = state.completedRoles;
    const total = state.roleNames;

    console.log();
    printInfo(`Resuming run: ${resumeRunId}`);
    printInfo(`Feature: ${featureRequest}`);
    printSuccess(`Completed: ${completed.join(", ")} (${completed.length}/${total.length})`);
    console.log();
  } else {
    // ── Get feature request ────────────────────────────────────────────
    featureRequest = taskArg || await prompt(`${BOLD}Feature request:${RST} `);
    if (!featureRequest) {
      printError("No feature request provided");
      process.exit(1);
    }
  }

  console.log();
  console.log(`  ${FG.brightCyan}${ICON.target}${RST} ${BOLD}Feature:${RST} ${featureRequest}`);
  console.log();

  // ── Resolve roles ────────────────────────────────────────────────────
  let roles: Role[] = DEFAULT_ROLES.map((r) => ({ ...r }));

  if (rolesFlag) {
    const roleNames = rolesFlag.split(",").map((r) => r.trim().toLowerCase());
    roles = roles.filter((r) => roleNames.includes(r.name));
    if (roles.length === 0) {
      printError(`No valid roles found. Available: ${DEFAULT_ROLES.map((r) => r.name).join(", ")}`);
      process.exit(1);
    }
  }

  // Apply config overrides with validation
  const companyConfig = config.company;
  if (companyConfig?.roles) {
    const validModes = new Set(["single", "compare"]);
    const disabledRoles = new Set<string>();

    for (const role of roles) {
      const override = companyConfig.roles[role.name];
      if (!override) continue;
      if (override.agent) role.agentSpec = override.agent;
      if (override.mode) {
        if (validModes.has(override.mode)) {
          role.mode = override.mode as "single" | "compare";
        } else {
          printWarning(`Invalid mode "${override.mode}" for role ${role.name} — using "${role.mode}"`);
        }
      }
      if (override.prompt) role.systemPrompt = override.prompt;
      const enabled = (override as Record<string, unknown>).enabled;
      if (enabled === false || enabled === "false") {
        disabledRoles.add(role.name);
      }
    }

    if (disabledRoles.size > 0) {
      roles = roles.filter((r) => !disabledRoles.has(r.name));
    }
  }

  // Add custom roles from config
  if (companyConfig?.customRoles) {
    for (const [name, cfg] of Object.entries(companyConfig.customRoles)) {
      const custom = createCustomRole(name, cfg.title, cfg.prompt, {
        mode: cfg.mode as "single" | "compare" | undefined,
        agent: cfg.agent,
        output: cfg.output,
        after: cfg.after,
      });
      // Insert after the specified role, or at the end before CEO
      const afterIdx = cfg.after ? roles.findIndex((r) => r.name === cfg.after) : -1;
      if (afterIdx >= 0) {
        roles.splice(afterIdx + 1, 0, custom);
      } else {
        const ceoIdx = roles.findIndex((r) => r.name === "ceo");
        if (ceoIdx >= 0) roles.splice(ceoIdx, 0, custom);
        else roles.push(custom);
      }
    }
  }

  // Show pipeline
  console.log(`  ${BOLD}Pipeline:${RST}`);
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const mode = role.mode === "compare" ? ` ${DIM}(compare)${RST}` : "";
    const agent = role.agentSpec ? ` ${DIM}${ICON.arrow} ${role.agentSpec}${RST}` : "";
    const resumed = resumeArtifacts?.some((a) => a.producerRole === role.name) ? ` ${FG.brightGreen}${ICON.check}${RST}` : "";
    const connector = i < roles.length - 1 ? `  ${FG.gray}│${RST}` : "";
    console.log(`  ${FG.brightCyan}${ICON.bullet}${RST} ${BOLD}${role.title}${RST}${mode}${agent}${resumed}`);
    if (connector) console.log(connector);
  }
  console.log();

  // ── Discover agents ──────────────────────────────────────────────────
  let availableAgents: ModelDef[];

  if (agentFlag) {
    availableAgents = parseAgentSpecs(agentFlag);
    printInfo(`Using specified agents: ${availableAgents.map((a) => a.id).join(", ")}`);
  } else {
    printInfo("Discovering available agents...");
    availableAgents = await discoverModels();
    if (availableAgents.length === 0) {
      printError("No agents found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or install CLIs.");
      process.exit(1);
    }
    printSuccess(`Found ${availableAgents.length} agents`);
  }
  console.log();

  // ── Cost estimation ────────────────────────────────────────────────
  const estimate = estimatePipeline(roles);
  console.log(`  ${BOLD}${ICON.chart} Estimate:${RST} ${estimate.totalRoles} roles, ~${estimate.estimatedMinutes} min, ~${estimate.agentCalls} agent calls`);
  if (roles.some((r) => r.mode === "compare")) {
    console.log(`  ${DIM}Developer uses compare mode — runs ${estimate.compareAgents}+ agents in parallel${RST}`);
  }
  console.log();

  if (dryRun) {
    printInfo("Dry run complete — no agents executed.");
    return;
  }

  // ── Confirm ──────────────────────────────────────────────────────────
  const action = resumeRunId ? "Resume the pipeline?" : "Start the pipeline?";
  const proceed = await confirm(`${BOLD}${action}${RST}`);
  if (!proceed) {
    printWarning("Cancelled.");
    return;
  }

  // ── Run pipeline ─────────────────────────────────────────────────────
  const runId = resumeRunId ?? createRunId();
  printInfo(`Run ID: ${runId}`);
  console.log();

  const maxRetries = companyConfig?.maxRetries ?? 2;

  const result: PipelineResult = await runPipeline({
    featureRequest,
    roles,
    repoPath,
    runId,
    availableAgents,
    maxRetries,
    resumeArtifacts,
  });

  // ── Summary ──────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${BOLD}${ICON.chart} Pipeline Summary${RST}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RST}`);

  for (const artifact of result.artifacts) {
    const icon = artifact.type === "decision"
      ? (result.accepted ? `${FG.brightGreen}${ICON.check}` : `${FG.brightRed}${ICON.cross}`)
      : `${FG.brightCyan}${ICON.bullet}`;
    console.log(`  ${icon}${RST} ${BOLD}${artifact.type}${RST} ${DIM}by ${artifact.producerRole} (${artifact.producerAgent})${RST}`);
  }
  console.log();

  if (result.accepted) {
    printSuccess("Feature approved by CEO");

    const codeArtifact = result.artifacts.find((a) => a.type === "code");
    if (codeArtifact && codeArtifact.content && !codeArtifact.content.startsWith("(No")) {
      const shouldApply = await confirm(`${BOLD}Apply the code changes to your working tree?${RST}`);
      if (shouldApply) {
        try {
          const { applyDiff } = await import("../worktree");
          applyDiff(repoPath, codeArtifact.content);
          printSuccess("Code changes applied");
        } catch (err) {
          printError(`Failed to apply: ${err}`);
        }
      }
    }
  } else {
    printWarning("Feature not approved after all retries");
    printInfo(`Resume later with: council company --resume ${runId}`);
  }

  console.log(`  ${DIM}Artifacts saved to: ${artifactDir(repoPath, runId)}${RST}`);

  const doCleanup = await confirm("Clean up artifacts?", false);
  if (doCleanup) {
    cleanupArtifacts(repoPath, runId);
    printSuccess("Artifacts cleaned up");
  }

  printComplete(
    result.accepted ? "Feature shipped" : "Feature needs more work",
    result.totalTimeMs
  );
}

// ── Estimation ──────────────────────────────────────────────────────────

interface PipelineEstimate {
  totalRoles: number;
  estimatedMinutes: number;
  agentCalls: number;
  compareAgents: number;
}

function estimatePipeline(roles: Role[]): PipelineEstimate {
  let agentCalls = 0;
  let compareAgents = 2;

  for (const role of roles) {
    if (role.mode === "compare") {
      const specCount = role.agentSpec ? role.agentSpec.split(",").length : 2;
      agentCalls += specCount;
      compareAgents = Math.max(compareAgents, specCount);
    } else {
      agentCalls++;
    }
  }

  // Rough per-role time estimates (minutes)
  const TIME_PER_ROLE: Record<string, number> = {
    pm: 2, architect: 3, developer: 5, em: 2, qa: 4, ceo: 1,
  };
  let estimatedMinutes = 0;
  for (const role of roles) {
    const base = TIME_PER_ROLE[role.name] ?? 3;
    estimatedMinutes += role.mode === "compare" ? base : base;
  }

  return { totalRoles: roles.length, estimatedMinutes, agentCalls, compareAgents };
}
