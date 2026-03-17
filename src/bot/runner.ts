import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { WebhookContext, BotCommand } from "./commands";
import { GitHubClient, createClient, addComment, updateComment, addReaction, createPR, getDefaultBranch } from "./github";
import { RunProgress, formatProgressComment, formatPRBody, formatArtifactComment, formatStatusComment, formatErrorComment, formatHelpComment } from "./formatter";
import { DEFAULT_ROLES, Role, createCustomRole } from "../roles";
import { Artifact, createRunId, loadPipelineState } from "../artifacts";
import { runPipeline, PipelineResult } from "../pipeline";
import { discoverModels, getDiscoveryWarnings, ModelDef } from "../models";
import { parseAgentSpecs } from "../parse-agent-spec";
import { loadConfig } from "../config";
import { findRepoRoot } from "../worktree";

// ── Active run tracking ──────────────────────────────────────────────────────

interface ActiveRun {
  runId: string;
  issueNumber: number;
  status: "running" | "done" | "failed" | "cancelled";
  progressCommentId: number;
  progress: RunProgress;
  startedAt: number;
}

const activeRuns = new Map<number, ActiveRun>();

export function getRunForIssue(issueNumber: number): ActiveRun | undefined {
  return activeRuns.get(issueNumber);
}

export function cancelRun(issueNumber: number): boolean {
  const run = activeRuns.get(issueNumber);
  if (!run || run.status !== "running") return false;
  run.status = "cancelled";
  run.progress.status = "cancelled";
  return true;
}

// ── Command dispatcher ───────────────────────────────────────────────────────

export async function executeCommand(
  ctx: WebhookContext,
  command: BotCommand,
  botConfig: { githubToken: string; botUsername: string; repoPath: string }
): Promise<void> {
  const client = createClient(botConfig.githubToken, ctx.owner, ctx.repo);

  switch (command.type) {
    case "help":
      await addComment(client, ctx.issueNumber, formatHelpComment(botConfig.botUsername));
      return;

    case "status":
      await handleStatus(client, ctx);
      return;

    case "cancel":
      await handleCancel(client, ctx);
      return;

    case "retry":
      await handleRetry(client, ctx, command, botConfig);
      return;

    case "company":
      await handleCompany(client, ctx, command, botConfig);
      return;

    case "compare":
      await addComment(client, ctx.issueNumber, ":construction: Compare mode via bot is coming soon. Use `council company` instead.");
      return;
  }
}

// ── /company handler ─────────────────────────────────────────────────────────

async function handleCompany(
  client: GitHubClient,
  ctx: WebhookContext,
  command: BotCommand,
  botConfig: { githubToken: string; repoPath: string }
): Promise<void> {
  // Prevent duplicate runs — check and reserve atomically
  const existing = activeRuns.get(ctx.issueNumber);
  if (existing?.status === "running") {
    await addComment(client, ctx.issueNumber, `:warning: Pipeline already running for this issue (\`${existing.runId}\`). Use \`/cancel\` to stop it.`);
    return;
  }

  const featureRequest = command.task;
  if (!featureRequest) {
    await addComment(client, ctx.issueNumber, ":x: No feature description provided. Usage: `@council-bot /company Add dark mode`");
    return;
  }

  const runId = createRunId();

  // Reserve the slot immediately to prevent race conditions
  const placeholder: ActiveRun = {
    runId, issueNumber: ctx.issueNumber, status: "running",
    progressCommentId: 0, progress: { runId, featureRequest, roles: [], completedRoles: new Map(), status: "running" },
    startedAt: Date.now(),
  };
  activeRuns.set(ctx.issueNumber, placeholder);

  // Acknowledge
  await addReaction(client, ctx.commentId, "eyes").catch(() => {});

  const repoPath = botConfig.repoPath || findRepoRoot();
  const config = loadConfig(repoPath);

  // Resolve roles
  let roles: Role[] = DEFAULT_ROLES.map((r) => ({ ...r }));
  if (command.roles) {
    const roleNames = command.roles.split(",").map((r) => r.trim().toLowerCase());
    roles = roles.filter((r) => roleNames.includes(r.name));
  }
  const companyConfig = config.company;
  if (companyConfig?.roles) {
    for (const role of roles) {
      const override = companyConfig.roles[role.name];
      if (!override) continue;
      if (override.agent) role.agentSpec = override.agent;
      if (override.mode === "single" || override.mode === "compare") role.mode = override.mode;
      if (override.enabled === false) roles = roles.filter((r) => r.name !== role.name);
    }
  }

  // Discover agents
  let agents: ModelDef[];
  if (command.agents) {
    agents = parseAgentSpecs(command.agents);
  } else {
    agents = await discoverModels();
  }

  if (agents.length === 0) {
    activeRuns.delete(ctx.issueNumber); // release the slot
    await addComment(client, ctx.issueNumber, formatErrorComment("No AI agents found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or install CLIs."));
    return;
  }

  // Create progress comment
  const progress: RunProgress = {
    runId,
    featureRequest,
    roles,
    completedRoles: new Map(),
    status: "running",
  };

  const progressCommentId = await addComment(client, ctx.issueNumber, formatProgressComment(progress));

  // Update the placeholder with real progress data
  const run: ActiveRun = { runId, issueNumber: ctx.issueNumber, status: "running", progressCommentId, progress, startedAt: Date.now() };
  activeRuns.set(ctx.issueNumber, run); // overwrite placeholder

  // Run pipeline in background
  try {
    const result = await runPipeline({
      featureRequest,
      roles,
      repoPath,
      runId,
      availableAgents: agents,
      maxRetries: companyConfig?.maxRetries ?? 2,
      autoSelect: true,
      onRoleComplete: (roleName, artifact) => {
        progress.completedRoles.set(roleName, {
          agent: artifact.producerAgent,
          durationMs: Date.now() - run.startedAt,
        });
        updateComment(client, progressCommentId, formatProgressComment(progress)).catch(() => {});
      },
    });

    run.status = "done";
    progress.status = "done";

    // Create PR if code was produced
    const codeArtifact = result.artifacts.find((a) => a.type === "code");
    if (codeArtifact && !codeArtifact.content.startsWith("(No")) {
      const prResult = await createPRFromPipeline(client, ctx, botConfig, result, featureRequest, runId);
      progress.prUrl = prResult.html_url;

      // Post artifacts as comments on the PR
      for (const artifact of result.artifacts) {
        await addComment(client, prResult.number, formatArtifactComment(artifact)).catch(() => {});
      }
    }

    // Update progress comment
    await updateComment(client, progressCommentId, formatProgressComment(progress));

  } catch (err) {
    run.status = "failed";
    progress.status = "failed";
    progress.error = (err as Error).message ?? String(err);
    await updateComment(client, progressCommentId, formatProgressComment(progress)).catch(() => {});
  }
}

// ── PR creation ──────────────────────────────────────────────────────────────

async function createPRFromPipeline(
  client: GitHubClient,
  ctx: WebhookContext,
  botConfig: { githubToken: string; repoPath: string },
  result: PipelineResult,
  featureRequest: string,
  runId: string
): Promise<{ number: number; html_url: string }> {
  const repoPath = botConfig.repoPath || findRepoRoot();
  const baseBranch = await getDefaultBranch(client);
  const headBranch = `council/bot-${ctx.issueNumber}-${Date.now()}`;

  const env = { ...process.env, GIT_AUTHOR_NAME: "council-bot", GIT_AUTHOR_EMAIL: "council-bot@users.noreply.github.com", GIT_COMMITTER_NAME: "council-bot", GIT_COMMITTER_EMAIL: "council-bot@users.noreply.github.com" } as Record<string, string>;

  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repoPath, env, stdio: "pipe", timeout: 30_000 });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr ?? "").toString().slice(0, 200)}`);
    return r;
  };

  try {
    git("checkout", "-b", headBranch);

    const codeArtifact = result.artifacts.find((a) => a.type === "code");
    if (codeArtifact && !codeArtifact.content.startsWith("(No")) {
      const { applyDiff } = require("../worktree");
      applyDiff(repoPath, codeArtifact.content);
    }

    git("add", "-A");

    // Safe commit — write message to temp file, no shell interpolation
    const subject = featureRequest.slice(0, 50).replace(/[\r\n]/g, " ");
    const msgFile = path.join(repoPath, `.council-msg-${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(msgFile, `feat: ${subject}\n\nCouncil pipeline: ${runId}\nCloses #${ctx.issueNumber}\n`, { mode: 0o600 });
    try {
      git("commit", "-F", msgFile, "--allow-empty");
    } finally {
      try { fs.unlinkSync(msgFile); } catch { /**/ }
    }

    // Safe push — use credential helper env var, never put token in args
    const pushUrl = `https://github.com/${ctx.repoFullName}.git`;
    const pushEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
    // Set credential via git config for this push only
    spawnSync("git", ["config", "--local", "credential.helper", `!f() { echo "password=${botConfig.githubToken}"; echo "username=x-access-token"; }; f`],
      { cwd: repoPath, env: pushEnv, stdio: "pipe", timeout: 5_000 });
    try {
      const pushResult = spawnSync("git", ["push", pushUrl, headBranch], { cwd: repoPath, env: pushEnv, stdio: "pipe", timeout: 60_000 });
      if (pushResult.status !== 0) throw new Error(`git push failed: ${(pushResult.stderr ?? "").toString().slice(0, 200)}`);
    } finally {
      // Remove the credential helper after push
      spawnSync("git", ["config", "--local", "--unset", "credential.helper"], { cwd: repoPath, stdio: "pipe", timeout: 5_000 });
    }
  } finally {
    try { spawnSync("git", ["checkout", baseBranch], { cwd: repoPath, env, stdio: "pipe", timeout: 30_000 }); } catch { /**/ }
  }

  // Create PR
  const title = featureRequest.length > 65 ? featureRequest.slice(0, 64) + "…" : featureRequest;
  const body = formatPRBody(featureRequest, result.artifacts, result.totalTimeMs, result.accepted);

  return createPR(client, {
    title,
    body,
    head: headBranch,
    base: baseBranch,
    labels: ["council-bot"],
  });
}

// ── /status handler ──────────────────────────────────────────────────────────

async function handleStatus(client: GitHubClient, ctx: WebhookContext): Promise<void> {
  const run = activeRuns.get(ctx.issueNumber);
  if (!run) {
    await addComment(client, ctx.issueNumber, ":information_source: No pipeline running for this issue.");
    return;
  }

  const completedList = Array.from(run.progress.completedRoles.keys());
  await addComment(client, ctx.issueNumber,
    formatStatusComment(run.runId, run.status, completedList, run.progress.roles.length, run.progress.error)
  );
}

// ── /cancel handler ──────────────────────────────────────────────────────────

async function handleCancel(client: GitHubClient, ctx: WebhookContext): Promise<void> {
  const cancelled = cancelRun(ctx.issueNumber);
  if (cancelled) {
    await addComment(client, ctx.issueNumber, ":stop_sign: Pipeline cancelled.");
  } else {
    await addComment(client, ctx.issueNumber, ":information_source: No running pipeline to cancel.");
  }
}

// ── /retry handler ───────────────────────────────────────────────────────────

async function handleRetry(
  client: GitHubClient,
  ctx: WebhookContext,
  command: BotCommand,
  botConfig: { githubToken: string; botUsername: string; repoPath: string }
): Promise<void> {
  const lastRun = activeRuns.get(ctx.issueNumber);
  if (!lastRun || lastRun.status === "running") {
    await addComment(client, ctx.issueNumber, ":information_source: No failed pipeline to retry.");
    return;
  }

  // Load the state and retry
  const repoPath = botConfig.repoPath || findRepoRoot();
  const state = loadPipelineState(repoPath, lastRun.runId);
  if (!state) {
    await addComment(client, ctx.issueNumber, `:x: Could not load state for run \`${lastRun.runId}\`.`);
    return;
  }

  const retryCommand: BotCommand = {
    type: "company",
    task: state.featureRequest,
    agents: command.agents,
    roles: command.roles,
  };

  await handleCompany(client, ctx, retryCommand, botConfig);
}
