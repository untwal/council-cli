import * as fs from "fs";
import * as path from "path";

export type ArtifactType = "spec" | "design" | "code" | "em_report" | "qa_report" | "decision";

export interface Artifact {
  type: ArtifactType;
  content: string;
  producerRole: string;
  producerAgent: string;
  timestamp: number;
  runId: string;
}

export function createRunId(): string {
  return `company-${Date.now()}`;
}

export function artifactDir(repoPath: string, runId: string): string {
  // Validate runId to prevent path traversal
  if (/[/\\]|\.\./.test(runId)) {
    throw new Error(`Invalid run ID: "${runId}" — must not contain path separators or ".."`);
  }
  return path.join(repoPath, ".council-artifacts", runId);
}

export function saveArtifact(repoPath: string, artifact: Artifact, stepIndex: number): void {
  const dir = artifactDir(repoPath, artifact.runId);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${String(stepIndex + 1).padStart(2, "0")}-${artifact.type}.md`;
  fs.writeFileSync(path.join(dir, fileName), artifact.content, "utf-8");

  const metaPath = path.join(dir, "metadata.json");
  const existing: Artifact[] = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, "utf-8"))
    : [];
  existing.push(artifact);
  fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2), "utf-8");
}

export function loadArtifacts(repoPath: string, runId: string): Artifact[] {
  const metaPath = path.join(artifactDir(repoPath, runId), "metadata.json");
  if (!fs.existsSync(metaPath)) return [];
  return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

export function formatArtifactsForPrompt(artifacts: Artifact[], types: ArtifactType[]): string {
  const relevant = artifacts.filter((a) => types.includes(a.type));
  if (relevant.length === 0) return "";

  const LABELS: Record<ArtifactType, string> = {
    spec: "Product Spec (from PM)",
    design: "Technical Design (from Architect)",
    code: "Implementation Diff (from Developer)",
    em_report: "Engineering Manager Report",
    qa_report: "QA Report (from QA Engineer)",
    decision: "CEO Decision",
  };

  return relevant.map((a) => {
    const label = LABELS[a.type] ?? a.type;
    return `## ${label}\n\n${a.content}`;
  }).join("\n\n---\n\n");
}

export function cleanupArtifacts(repoPath: string, runId: string): void {
  const dir = artifactDir(repoPath, runId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Pipeline state persistence (for --resume) ───────────────────────────────

export interface RoleMetrics {
  role: string;
  agent: string;
  durationMs: number;
  retries: number;
}

export interface PipelineState {
  runId: string;
  featureRequest: string;
  roleNames: string[];
  completedRoles: string[];
  artifacts: Artifact[];
  roleMetrics: RoleMetrics[];
  accepted: boolean;
  startedAt: number;
  finishedAt?: number;
}

export function savePipelineState(repoPath: string, state: PipelineState): void {
  const dir = artifactDir(repoPath, state.runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pipeline-state.json"), JSON.stringify(state, null, 2), "utf-8");
}

export function loadPipelineState(repoPath: string, runId: string): PipelineState | null {
  const statePath = path.join(artifactDir(repoPath, runId), "pipeline-state.json");
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf-8"));
}

export function listPipelineRuns(repoPath: string): Array<{ runId: string; state: PipelineState }> {
  const baseDir = path.join(repoPath, ".council-artifacts");
  if (!fs.existsSync(baseDir)) return [];

  const runs: Array<{ runId: string; state: PipelineState }> = [];
  for (const entry of fs.readdirSync(baseDir)) {
    if (!entry.startsWith("company-")) continue;
    const state = loadPipelineState(repoPath, entry);
    if (state) runs.push({ runId: entry, state });
  }
  return runs.sort((a, b) => b.state.startedAt - a.state.startedAt);
}
