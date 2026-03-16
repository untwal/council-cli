import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("https", () => ({
  request: vi.fn(),
}));

import * as https from "https";
import { notifyPipelineStart, notifyRoleComplete, notifyPipelineComplete, notifyPipelineError, getNotifyConfig } from "../notify";

function mockHttpSuccess(): void {
  (https.request as ReturnType<typeof vi.fn>).mockImplementation((_opts: unknown, callback?: (res: unknown) => void) => {
    if (callback) callback({ on: vi.fn() });
    return { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  });
}

describe("getNotifyConfig", () => {
  const origEnv = process.env.COUNCIL_SLACK_WEBHOOK;

  afterEach(() => {
    if (origEnv) process.env.COUNCIL_SLACK_WEBHOOK = origEnv;
    else delete process.env.COUNCIL_SLACK_WEBHOOK;
  });

  it("returns disabled when no webhook URL set", () => {
    delete process.env.COUNCIL_SLACK_WEBHOOK;
    const config = getNotifyConfig();
    expect(config.enabled).toBe(false);
    expect(config.slackWebhookUrl).toBeUndefined();
  });

  it("returns enabled when webhook URL is set", () => {
    process.env.COUNCIL_SLACK_WEBHOOK = "https://hooks.slack.com/test";
    const config = getNotifyConfig();
    expect(config.enabled).toBe(true);
  });
});

describe("notification functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COUNCIL_SLACK_WEBHOOK;
  });

  it("notifyPipelineStart does nothing when disabled", async () => {
    await notifyPipelineStart("test", "run-1", ["pm"]);
    expect(https.request).not.toHaveBeenCalled();
  });

  it("notifyPipelineStart sends when enabled", async () => {
    process.env.COUNCIL_SLACK_WEBHOOK = "https://hooks.slack.com/test";
    mockHttpSuccess();
    await notifyPipelineStart("Add dark mode", "run-1", ["pm", "dev"]);
    expect(https.request).toHaveBeenCalled();
    const payload = JSON.parse((https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write.mock.calls[0][0]);
    expect(payload.blocks[0].text.text).toContain("Pipeline Started");
  });

  it("notifyRoleComplete does nothing when disabled", async () => {
    await notifyRoleComplete("test", "pm", "PM", 5);
    expect(https.request).not.toHaveBeenCalled();
  });

  it("notifyPipelineComplete includes PR URL when provided", async () => {
    process.env.COUNCIL_SLACK_WEBHOOK = "https://hooks.slack.com/test";
    mockHttpSuccess();
    await notifyPipelineComplete("test", "run-1", true, 60000, 5, "https://github.com/pr/1");
    const payload = JSON.parse((https.request as ReturnType<typeof vi.fn>).mock.results[0].value.write.mock.calls[0][0]);
    const prBlock = payload.blocks.find((b: { text?: { text?: string } }) => b.text?.text?.includes("PR"));
    expect(prBlock).toBeDefined();
  });

  it("notifyPipelineError does nothing when disabled", async () => {
    await notifyPipelineError("test", "run-1", "something broke");
    expect(https.request).not.toHaveBeenCalled();
  });

  it("notification failure does not throw", async () => {
    process.env.COUNCIL_SLACK_WEBHOOK = "https://hooks.slack.com/test";
    (https.request as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const req = { on: vi.fn((_: string, cb: () => void) => { cb(); }), write: vi.fn(), end: vi.fn() };
      return req;
    });
    // Should not throw even on network error
    await expect(notifyPipelineStart("test", "run-1", ["pm"])).resolves.not.toThrow();
  });
});
