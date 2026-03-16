import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { generateAnalytics } from "../analytics";
import { savePipelineState, PipelineState } from "../artifacts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync("/tmp/council-analytics-");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateAnalytics", () => {
  it("returns empty report for no runs", () => {
    const report = generateAnalytics(tmpDir);
    expect(report.totalRuns).toBe(0);
    expect(report.agentStats).toHaveLength(0);
  });

  it("calculates correct stats for single run", () => {
    const state: PipelineState = {
      runId: "company-100",
      featureRequest: "Add dark mode",
      roleNames: ["pm", "developer", "ceo"],
      completedRoles: ["pm", "developer", "ceo"],
      artifacts: [],
      roleMetrics: [
        { role: "pm", agent: "claude:sonnet", durationMs: 5000, retries: 0 },
        { role: "developer", agent: "codex:o3", durationMs: 30000, retries: 0 },
        { role: "ceo", agent: "claude:sonnet", durationMs: 3000, retries: 0 },
      ],
      accepted: true,
      startedAt: 1000,
      finishedAt: 39000,
    };

    savePipelineState(tmpDir, state);
    const report = generateAnalytics(tmpDir);

    expect(report.totalRuns).toBe(1);
    expect(report.totalApproved).toBe(1);
    expect(report.totalRejected).toBe(0);
    expect(report.agentStats.length).toBeGreaterThan(0);
    expect(report.bottleneckRole).toBe("developer");
  });

  it("tracks multiple agents across runs", () => {
    const state1: PipelineState = {
      runId: "company-100",
      featureRequest: "F1",
      roleNames: ["pm"],
      completedRoles: ["pm"],
      artifacts: [],
      roleMetrics: [{ role: "pm", agent: "claude:sonnet", durationMs: 5000, retries: 0 }],
      accepted: true,
      startedAt: 100,
      finishedAt: 5100,
    };
    const state2: PipelineState = {
      runId: "company-200",
      featureRequest: "F2",
      roleNames: ["pm"],
      completedRoles: ["pm"],
      artifacts: [],
      roleMetrics: [{ role: "pm", agent: "codex:o3", durationMs: 8000, retries: 1 }],
      accepted: false,
      startedAt: 200,
      finishedAt: 8200,
    };

    savePipelineState(tmpDir, state1);
    savePipelineState(tmpDir, state2);

    const report = generateAnalytics(tmpDir);
    expect(report.totalRuns).toBe(2);
    expect(report.agentStats).toHaveLength(2);

    const claudeStats = report.agentStats.find((s) => s.agent === "claude:sonnet");
    expect(claudeStats?.approvalRate).toBe(1);

    const codexStats = report.agentStats.find((s) => s.agent === "codex:o3");
    expect(codexStats?.approvalRate).toBe(0);
    expect(codexStats?.totalRetries).toBe(1);
  });

  it("sorts agents by approval rate descending", () => {
    const makeState = (runId: string, agent: string, accepted: boolean): PipelineState => ({
      runId,
      featureRequest: "test",
      roleNames: ["pm"],
      completedRoles: ["pm"],
      artifacts: [],
      roleMetrics: [{ role: "pm", agent, durationMs: 1000, retries: 0 }],
      accepted,
      startedAt: parseInt(runId.split("-")[1]),
      finishedAt: parseInt(runId.split("-")[1]) + 1000,
    });

    savePipelineState(tmpDir, makeState("company-100", "agent-bad", false));
    savePipelineState(tmpDir, makeState("company-200", "agent-good", true));

    const report = generateAnalytics(tmpDir);
    expect(report.agentStats[0].agent).toBe("agent-good");
    expect(report.agentStats[1].agent).toBe("agent-bad");
  });
});
