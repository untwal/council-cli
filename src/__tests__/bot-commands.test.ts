import { describe, it, expect } from "vitest";
import { parseCommand, extractContext } from "../bot/commands";

describe("parseCommand", () => {
  const bot = "council-bot";

  it("parses /company command with task", () => {
    const result = parseCommand("@council-bot /company Add dark mode", bot);
    expect(result).toEqual({ type: "company", task: "Add dark mode", agents: undefined, roles: undefined });
  });

  it("parses /company with flags", () => {
    const result = parseCommand("@council-bot /company --agents=claude:opus Add dark mode", bot);
    expect(result?.type).toBe("company");
    expect(result?.agents).toBe("claude:opus");
    expect(result?.task).toBe("Add dark mode");
  });

  it("parses /company with roles flag", () => {
    const result = parseCommand("@council-bot /company --roles=pm,developer Build it", bot);
    expect(result?.roles).toBe("pm,developer");
    expect(result?.task).toBe("Build it");
  });

  it("parses /compare command", () => {
    const result = parseCommand("@council-bot /compare Fix auth bug", bot);
    expect(result).toEqual({ type: "compare", task: "Fix auth bug", agents: undefined, roles: undefined });
  });

  it("parses /status command", () => {
    const result = parseCommand("@council-bot /status", bot);
    expect(result).toEqual({ type: "status" });
  });

  it("parses /cancel command", () => {
    const result = parseCommand("@council-bot /cancel", bot);
    expect(result).toEqual({ type: "cancel" });
  });

  it("parses /retry command", () => {
    const result = parseCommand("@council-bot /retry", bot);
    expect(result).toEqual({ type: "retry" });
  });

  it("parses /help command", () => {
    const result = parseCommand("@council-bot /help", bot);
    expect(result).toEqual({ type: "help" });
  });

  it("returns help for bare mention", () => {
    const result = parseCommand("@council-bot", bot);
    expect(result).toEqual({ type: "help" });
  });

  it("returns null for non-mention", () => {
    const result = parseCommand("This is just a normal comment", bot);
    expect(result).toBeNull();
  });

  it("returns help for unknown command", () => {
    const result = parseCommand("@council-bot /unknown-command", bot);
    expect(result).toEqual({ type: "help" });
  });

  it("is case insensitive for bot name", () => {
    const result = parseCommand("@Council-Bot /status", bot);
    expect(result?.type).toBe("status");
  });

  it("handles multiline comments", () => {
    const result = parseCommand("@council-bot /company\nAdd dark mode with\nsystem preferences", bot);
    expect(result?.type).toBe("company");
    expect(result?.task).toContain("Add dark mode");
  });

  it("handles task with special characters", () => {
    const result = parseCommand("@council-bot /company Fix the N+1 query in users#index", bot);
    expect(result?.task).toBe("Fix the N+1 query in users#index");
  });
});

describe("extractContext", () => {
  it("extracts context from issue_comment payload", () => {
    const payload = {
      action: "created",
      comment: {
        id: 123,
        body: "@council-bot /company Test",
        user: { login: "testuser" },
      },
      issue: {
        number: 42,
      },
      repository: {
        full_name: "owner/repo",
        clone_url: "https://github.com/owner/repo.git",
      },
    };

    const ctx = extractContext(payload);
    expect(ctx).not.toBeNull();
    expect(ctx!.owner).toBe("owner");
    expect(ctx!.repo).toBe("repo");
    expect(ctx!.issueNumber).toBe(42);
    expect(ctx!.commentId).toBe(123);
    expect(ctx!.commentAuthor).toBe("testuser");
    expect(ctx!.isIssue).toBe(true);
  });

  it("returns null for non-created actions", () => {
    const payload = { action: "edited", comment: {}, issue: {}, repository: {} };
    expect(extractContext(payload)).toBeNull();
  });

  it("returns null for missing comment", () => {
    const payload = { action: "created", issue: {}, repository: {} };
    expect(extractContext(payload)).toBeNull();
  });

  it("detects PR comments vs issue comments", () => {
    const payload = {
      action: "created",
      comment: { id: 1, body: "test", user: { login: "u" } },
      issue: { number: 1, pull_request: { url: "..." } },
      repository: { full_name: "o/r", clone_url: "https://..." },
    };

    const ctx = extractContext(payload);
    expect(ctx!.isIssue).toBe(false);
  });
});
