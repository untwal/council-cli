import { loadWorkspaceConfig, validateWorkspace, WorkspaceRepo } from "../workspace";
import { DEFAULT_ROLES, Role, buildRolePrompt } from "../roles";
import { Artifact, createRunId, saveArtifact, formatArtifactsForPrompt, savePipelineState, RoleMetrics } from "../artifacts";
import { runPipeline, PipelineResult } from "../pipeline";
import { discoverModels, ModelDef } from "../models";
import { parseAgentSpecs } from "../parse-agent-spec";
import { loadConfig } from "../config";
import { prompt, confirm } from "../ui/prompt";
import {
  printInfo, printSuccess, printError, printWarning, printComplete,
} from "../ui/render";
import { RST, BOLD, DIM, FG, ICON, elapsed } from "../ui/theme";

export async function runWorkspace(taskArg: string | null, agentFlag: string | null): Promise<void> {
  const cwd = process.cwd();
  const wsConfig = loadWorkspaceConfig(cwd);

  if (!wsConfig) {
    printError("No council-workspace.yml found. Create one with repo definitions.");
    console.log();
    console.log(`  Example council-workspace.yml:`);
    console.log();
    console.log(`  ${DIM}repos:`);
    console.log(`    - name: frontend`);
    console.log(`      path: ../webapp`);
    console.log(`      roles: pm,architect,developer,qa`);
    console.log(`    - name: backend`);
    console.log(`      path: ../api-server`);
    console.log(`      roles: architect,developer,qa`);
    console.log(`  coordinator: claude:claude-opus-4-6:reasoning${RST}`);
    console.log();
    return;
  }

  // Validate
  const errors = validateWorkspace(wsConfig);
  if (errors.length > 0) {
    for (const err of errors) printError(err);
    return;
  }

  // Get feature request
  const featureRequest = taskArg || await prompt(`${BOLD}Feature request:${RST} `);
  if (!featureRequest) {
    printError("No feature request provided");
    return;
  }

  console.log();
  console.log(`  ${FG.brightCyan}${ICON.target}${RST} ${BOLD}Feature:${RST} ${featureRequest}`);
  console.log();

  // Show workspace plan
  console.log(`  ${BOLD}Workspace:${RST} ${wsConfig.repos.length} repos`);
  for (const repo of wsConfig.repos) {
    const roleList = repo.roles?.join(", ") ?? "all roles";
    console.log(`  ${FG.brightCyan}${ICON.bullet}${RST} ${BOLD}${repo.name}${RST} ${DIM}${repo.path}${RST}`);
    console.log(`    ${DIM}roles: ${roleList}${RST}`);
  }
  console.log();

  // Discover agents
  let agents: ModelDef[];
  if (agentFlag) {
    agents = parseAgentSpecs(agentFlag);
  } else {
    printInfo("Discovering agents...");
    agents = await discoverModels();
    if (agents.length === 0) {
      printError("No agents found.");
      return;
    }
    printSuccess(`Found ${agents.length} agents`);
  }
  console.log();

  const proceed = await confirm(`${BOLD}Run pipeline across ${wsConfig.repos.length} repos?${RST}`);
  if (!proceed) {
    printWarning("Cancelled.");
    return;
  }

  const startTime = Date.now();

  // Phase 1: Run PM once (shared spec across all repos)
  printInfo("Phase 1: Product Manager writes shared spec...");
  console.log();

  const sharedRunId = createRunId();
  const pmRoles = DEFAULT_ROLES.filter((r) => r.name === "pm").map((r) => ({ ...r }));
  const pmResult = await runPipeline({
    featureRequest,
    roles: pmRoles,
    repoPath: wsConfig.repos[0].path,
    runId: sharedRunId,
    availableAgents: agents,
    maxRetries: 0,
    autoSelect: true,
  });

  const sharedSpec = pmResult.artifacts.find((a) => a.type === "spec");
  if (!sharedSpec) {
    printError("PM failed to produce a spec.");
    return;
  }
  printSuccess(`Shared spec produced (${(sharedSpec.content.length / 1024).toFixed(1)}KB)`);
  console.log();

  // Phase 2: Run remaining pipeline per repo in parallel
  printInfo(`Phase 2: Running pipelines across ${wsConfig.repos.length} repos...`);
  console.log();

  const repoResults: Array<{ repo: WorkspaceRepo; result: PipelineResult; runId: string }> = [];

  // Run repos sequentially to avoid resource exhaustion
  for (const repo of wsConfig.repos) {
    console.log(`  ${FG.brightCyan}${ICON.gear}${RST} ${BOLD}${repo.name}${RST}`);

    const repoRunId = `${sharedRunId}-${repo.name}`;
    const config = loadConfig(repo.path);

    // Build roles for this repo (skip PM — shared spec already done)
    let roles = DEFAULT_ROLES.filter((r) => r.name !== "pm").map((r) => ({ ...r }));
    if (repo.roles) {
      const allowed = new Set(repo.roles);
      roles = roles.filter((r) => allowed.has(r.name));
    }

    // Inject the shared spec into the pipeline
    const result = await runPipeline({
      featureRequest,
      roles,
      repoPath: repo.path,
      runId: repoRunId,
      availableAgents: agents,
      maxRetries: config.company?.maxRetries ?? 1,
      autoSelect: true,
      resumeArtifacts: [sharedSpec],
    });

    repoResults.push({ repo, result, runId: repoRunId });

    const status = result.accepted ? `${FG.brightGreen}approved${RST}` : `${FG.brightYellow}needs work${RST}`;
    const files = result.artifacts.find((a) => a.type === "code")?.content.split("\n").length ?? 0;
    printSuccess(`${repo.name}: ${status} (${files} lines changed)`);
    console.log();
  }

  // Summary
  const totalMs = Date.now() - startTime;
  console.log();
  console.log(`  ${BOLD}${ICON.chart} Workspace Summary${RST}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RST}`);
  console.log();

  for (const { repo, result } of repoResults) {
    const icon = result.accepted ? `${FG.brightGreen}${ICON.check}` : `${FG.brightRed}${ICON.cross}`;
    const artifactCount = result.artifacts.length;
    console.log(`  ${icon}${RST} ${BOLD}${repo.name}${RST} — ${artifactCount} artifacts, ${Math.round(result.totalTimeMs / 1000)}s`);
  }

  const approved = repoResults.filter((r) => r.result.accepted).length;
  console.log();

  printComplete(
    `${approved}/${repoResults.length} repos approved`,
    totalMs
  );
}
