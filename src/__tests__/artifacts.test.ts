import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  createRunId, artifactDir, saveArtifact, loadArtifacts,
  formatArtifactsForPrompt, cleanupArtifacts, Artifact,
  savePipelineState, loadPipelineState, listPipelineRuns, PipelineState,
} from "../artifacts";

let tmpDir: string;
let runId: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync("/tmp/council-artifact-test-");
  runId = createRunId();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createRunId", () => {
  it("generates a unique run ID with timestamp", () => {
    const id = createRunId();
    expect(id).toMatch(/^company-\d+$/);
  });

  it("starts with 'company-' prefix", () => {
    const id = createRunId();
    expect(id.startsWith("company-")).toBe(true);
    expect(id.length).toBeGreaterThan(8);
  });
});

describe("artifactDir", () => {
  it("returns correct path under .council-artifacts", () => {
    const dir = artifactDir("/repo", "company-123");
    expect(dir).toBe("/repo/.council-artifacts/company-123");
  });
});

describe("saveArtifact and loadArtifacts", () => {
  it("saves and loads a single artifact", () => {
    const artifact: Artifact = {
      type: "spec",
      content: "# Product Spec\n\nUser stories here.",
      producerRole: "pm",
      producerAgent: "claude:claude-opus-4-6",
      timestamp: Date.now(),
      runId,
    };

    saveArtifact(tmpDir, artifact, 0);

    const loaded = loadArtifacts(tmpDir, runId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].type).toBe("spec");
    expect(loaded[0].content).toContain("Product Spec");
  });

  it("saves multiple artifacts with sequential numbering", () => {
    const spec: Artifact = { type: "spec", content: "Spec content", producerRole: "pm", producerAgent: "a", timestamp: 1, runId };
    const design: Artifact = { type: "design", content: "Design content", producerRole: "architect", producerAgent: "b", timestamp: 2, runId };

    saveArtifact(tmpDir, spec, 0);
    saveArtifact(tmpDir, design, 1);

    const loaded = loadArtifacts(tmpDir, runId);
    expect(loaded).toHaveLength(2);

    // Check files exist with correct names
    const dir = artifactDir(tmpDir, runId);
    expect(fs.existsSync(path.join(dir, "01-spec.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "02-design.md"))).toBe(true);
  });

  it("creates directory recursively", () => {
    const deepDir = path.join(tmpDir, "deep", "nested");
    const artifact: Artifact = { type: "spec", content: "test", producerRole: "pm", producerAgent: "a", timestamp: 1, runId };

    // This should not throw even though deep/nested doesn't exist
    saveArtifact(deepDir, artifact, 0);
    expect(fs.existsSync(artifactDir(deepDir, runId))).toBe(true);
  });
});

describe("loadArtifacts", () => {
  it("returns empty array for non-existent run", () => {
    const loaded = loadArtifacts(tmpDir, "nonexistent-run");
    expect(loaded).toEqual([]);
  });
});

describe("formatArtifactsForPrompt", () => {
  it("formats selected artifact types for prompt injection", () => {
    const artifacts: Artifact[] = [
      { type: "spec", content: "User wants dark mode", producerRole: "pm", producerAgent: "a", timestamp: 1, runId },
      { type: "design", content: "Use CSS variables", producerRole: "architect", producerAgent: "b", timestamp: 2, runId },
      { type: "code", content: "diff --git ...", producerRole: "developer", producerAgent: "c", timestamp: 3, runId },
    ];

    const result = formatArtifactsForPrompt(artifacts, ["spec", "design"]);
    expect(result).toContain("Product Spec (from PM)");
    expect(result).toContain("User wants dark mode");
    expect(result).toContain("Technical Design (from Architect)");
    expect(result).toContain("Use CSS variables");
    expect(result).not.toContain("Implementation Diff");
  });

  it("returns empty string when no matching artifacts", () => {
    const artifacts: Artifact[] = [
      { type: "spec", content: "spec", producerRole: "pm", producerAgent: "a", timestamp: 1, runId },
    ];

    const result = formatArtifactsForPrompt(artifacts, ["code"]);
    expect(result).toBe("");
  });

  it("formats all artifact types correctly", () => {
    const artifacts: Artifact[] = [
      { type: "spec", content: "s", producerRole: "pm", producerAgent: "a", timestamp: 1, runId },
      { type: "design", content: "d", producerRole: "architect", producerAgent: "b", timestamp: 2, runId },
      { type: "code", content: "c", producerRole: "developer", producerAgent: "c", timestamp: 3, runId },
      { type: "qa_report", content: "q", producerRole: "qa", producerAgent: "d", timestamp: 4, runId },
      { type: "decision", content: "ok", producerRole: "ceo", producerAgent: "e", timestamp: 5, runId },
    ];

    const result = formatArtifactsForPrompt(artifacts, ["spec", "design", "code", "qa_report", "decision"]);
    expect(result).toContain("Product Spec");
    expect(result).toContain("Technical Design");
    expect(result).toContain("Implementation Diff");
    expect(result).toContain("QA Report");
    expect(result).toContain("CEO Decision");
  });
});

describe("cleanupArtifacts", () => {
  it("removes artifact directory", () => {
    const artifact: Artifact = { type: "spec", content: "test", producerRole: "pm", producerAgent: "a", timestamp: 1, runId };
    saveArtifact(tmpDir, artifact, 0);

    const dir = artifactDir(tmpDir, runId);
    expect(fs.existsSync(dir)).toBe(true);

    cleanupArtifacts(tmpDir, runId);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("does not throw for non-existent directory", () => {
    expect(() => cleanupArtifacts(tmpDir, "nonexistent")).not.toThrow();
  });
});

describe("pipeline state persistence", () => {
  it("saves and loads pipeline state", () => {
    const state: PipelineState = {
      runId,
      featureRequest: "Add dark mode",
      roleNames: ["pm", "architect", "developer", "qa", "ceo"],
      completedRoles: ["pm", "architect"],
      artifacts: [
        { type: "spec", content: "spec content", producerRole: "pm", producerAgent: "a", timestamp: 1, runId },
        { type: "design", content: "design content", producerRole: "architect", producerAgent: "b", timestamp: 2, runId },
      ],
      roleMetrics: [
        { role: "pm", agent: "a", durationMs: 5000, retries: 0 },
        { role: "architect", agent: "b", durationMs: 8000, retries: 0 },
      ],
      accepted: false,
      startedAt: Date.now(),
    };

    savePipelineState(tmpDir, state);
    const loaded = loadPipelineState(tmpDir, runId);

    expect(loaded).not.toBeNull();
    expect(loaded!.featureRequest).toBe("Add dark mode");
    expect(loaded!.completedRoles).toEqual(["pm", "architect"]);
    expect(loaded!.artifacts).toHaveLength(2);
    expect(loaded!.roleMetrics).toHaveLength(2);
    expect(loaded!.roleMetrics[0].durationMs).toBe(5000);
  });

  it("returns null for non-existent state", () => {
    expect(loadPipelineState(tmpDir, "nonexistent")).toBeNull();
  });

  it("lists pipeline runs sorted by most recent first", () => {
    const state1: PipelineState = {
      runId: "company-100",
      featureRequest: "Feature 1",
      roleNames: ["pm"],
      completedRoles: ["pm"],
      artifacts: [],
      roleMetrics: [],
      accepted: false,
      startedAt: 100,
    };
    const state2: PipelineState = {
      runId: "company-200",
      featureRequest: "Feature 2",
      roleNames: ["pm"],
      completedRoles: [],
      artifacts: [],
      roleMetrics: [],
      accepted: false,
      startedAt: 200,
    };

    savePipelineState(tmpDir, state1);
    savePipelineState(tmpDir, state2);

    const runs = listPipelineRuns(tmpDir);
    expect(runs).toHaveLength(2);
    expect(runs[0].runId).toBe("company-200");
    expect(runs[1].runId).toBe("company-100");
  });

  it("returns empty array when no runs exist", () => {
    expect(listPipelineRuns(tmpDir)).toEqual([]);
  });
});
