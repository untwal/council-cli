import { describe, it, expect } from "vitest";
import {
  formatProgressComment, formatPRBody, formatArtifactComment,
  formatStatusComment, formatErrorComment, formatHelpComment,
  RunProgress,
} from "../bot/formatter";
import { DEFAULT_ROLES } from "../roles";

describe("formatProgressComment", () => {
  it("shows running state with completed and pending roles", () => {
    const progress: RunProgress = {
      runId: "company-123",
      featureRequest: "Add dark mode",
      roles: DEFAULT_ROLES.slice(0, 3),
      completedRoles: new Map([["pm", { agent: "claude", durationMs: 5000 }]]),
      status: "running",
    };

    const result = formatProgressComment(progress);
    expect(result).toContain("Council Pipeline");
    expect(result).toContain("Add dark mode");
    expect(result).toContain(":white_check_mark: Done");
    expect(result).toContain(":hourglass_flowing_sand: Running");
    expect(result).toContain(":white_circle: Pending");
  });

  it("shows done state with PR link", () => {
    const progress: RunProgress = {
      runId: "company-123",
      featureRequest: "Test",
      roles: DEFAULT_ROLES.slice(0, 1),
      completedRoles: new Map([["pm", { agent: "claude", durationMs: 3000 }]]),
      status: "done",
      prUrl: "https://github.com/o/r/pull/42",
    };

    const result = formatProgressComment(progress);
    expect(result).toContain(":rocket:");
    expect(result).toContain("https://github.com/o/r/pull/42");
  });

  it("shows failed state with error", () => {
    const progress: RunProgress = {
      runId: "company-123",
      featureRequest: "Test",
      roles: [],
      completedRoles: new Map(),
      status: "failed",
      error: "Agent timed out",
    };

    const result = formatProgressComment(progress);
    expect(result).toContain(":x:");
    expect(result).toContain("Agent timed out");
  });
});

describe("formatPRBody", () => {
  it("includes feature request and stats", () => {
    const artifacts = [
      { type: "spec" as const, content: "spec...", producerRole: "pm", producerAgent: "claude", timestamp: 1, runId: "r" },
      { type: "code" as const, content: "diff...", producerRole: "developer", producerAgent: "codex", timestamp: 2, runId: "r" },
    ];

    const result = formatPRBody("Add dark mode", artifacts, 120000, true);
    expect(result).toContain("Add dark mode");
    expect(result).toContain("2m");
    expect(result).toContain("Approved");
    expect(result).toContain("spec");
    expect(result).toContain("code");
  });
});

describe("formatArtifactComment", () => {
  it("wraps long artifacts in collapsible details", () => {
    const artifact = {
      type: "spec" as const,
      content: "x".repeat(600),
      producerRole: "pm",
      producerAgent: "claude",
      timestamp: 1,
      runId: "r",
    };

    const result = formatArtifactComment(artifact);
    expect(result).toContain("<details>");
    expect(result).toContain("</details>");
    expect(result).toContain("Click to expand");
  });

  it("shows short artifacts inline", () => {
    const artifact = {
      type: "decision" as const,
      content: '{"decision":"approve","reasoning":"Ship it"}',
      producerRole: "ceo",
      producerAgent: "claude",
      timestamp: 1,
      runId: "r",
    };

    const result = formatArtifactComment(artifact);
    expect(result).not.toContain("<details>");
    expect(result).toContain("approve");
  });

  it("wraps code artifacts in diff code blocks", () => {
    const artifact = {
      type: "code" as const,
      content: "+new line\n-old line",
      producerRole: "developer",
      producerAgent: "claude",
      timestamp: 1,
      runId: "r",
    };

    const result = formatArtifactComment(artifact);
    expect(result).toContain("```diff");
  });
});

describe("formatHelpComment", () => {
  it("lists all commands", () => {
    const result = formatHelpComment("council-bot");
    expect(result).toContain("/company");
    expect(result).toContain("/compare");
    expect(result).toContain("/status");
    expect(result).toContain("/retry");
    expect(result).toContain("/cancel");
    expect(result).toContain("/help");
    expect(result).toContain("council-bot");
  });
});

describe("formatStatusComment", () => {
  it("shows progress info", () => {
    const result = formatStatusComment("company-123", "running", ["pm", "architect"], 6);
    expect(result).toContain("company-123");
    expect(result).toContain("running");
    expect(result).toContain("2/6");
    expect(result).toContain("pm");
  });
});

describe("formatErrorComment", () => {
  it("formats error with retry hint", () => {
    const result = formatErrorComment("Something went wrong");
    expect(result).toContain("Something went wrong");
    expect(result).toContain("/retry");
  });
});
