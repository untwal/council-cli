import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadConfig, getConfig, resetCache } from "../config";

beforeEach(() => {
  resetCache();
});

describe("loadConfig", () => {
  it("returns default config when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.agents).toEqual([]);
    expect(config.evaluate).toEqual([]);
    expect(config.evaluateTimeout).toBe(120);
    expect(config.maxIterations).toBe(30);
    expect(config.templates).toEqual({});
  });

  it("parses a YAML config file with agents", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-test-");
    const configPath = path.join(tmpDir, ".council.yml");
    fs.writeFileSync(configPath, `agents:
  - claude:claude-sonnet-4-6
  - codex:o3-mini
  - claude:claude-opus-4-6:reasoning
evaluate:
  - npm test
  - npx tsc --noEmit
evaluateTimeout: 60
`);

    const config = loadConfig(tmpDir);
    expect(config.agents).toEqual([
      "claude:claude-sonnet-4-6",
      "codex:o3-mini",
      "claude:claude-opus-4-6:reasoning",
    ]);
    expect(config.evaluate).toEqual(["npm test", "npx tsc --noEmit"]);
    expect(config.evaluateTimeout).toBe(60);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("parses agents with reasoning suffix correctly", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-test-");
    const configPath = path.join(tmpDir, ".council.yml");
    fs.writeFileSync(configPath, `agents:
  - claude:claude-opus-4-6:reasoning
  - gemini-cli:gemini-2.5-pro
`);

    const config = loadConfig(tmpDir);
    expect(config.agents).toEqual([
      "claude:claude-opus-4-6:reasoning",
      "gemini-cli:gemini-2.5-pro",
    ]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("searches multiple config file names", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-test-");
    const configPath = path.join(tmpDir, "council.yaml");
    fs.writeFileSync(configPath, `agents:
  - claude:claude-sonnet-4-6
`);

    const config = loadConfig(tmpDir);
    expect(config.agents).toEqual(["claude:claude-sonnet-4-6"]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("handles templates", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-test-");
    const configPath = path.join(tmpDir, ".council.yml");
    fs.writeFileSync(configPath, `templates:
  fix-bug: Fix the bug described in the issue
  add-feature: Add a new feature
`);

    const config = loadConfig(tmpDir);
    expect(config.templates).toEqual({
      "fix-bug": "Fix the bug described in the issue",
      "add-feature": "Add a new feature",
    });

    fs.rmSync(tmpDir, { recursive: true });
  });
});
