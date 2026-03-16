import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseYaml, loadConfig, resetCache } from "../config";

beforeEach(() => {
  resetCache();
});

describe("parseYaml — company config", () => {
  it("parses company section with role overrides", () => {
    const result = parseYaml(`company:
  maxRetries: 3
  roles:
    developer:
        agent: claude:claude-sonnet-4-6
        mode: compare
    ceo:
        agent: claude:claude-opus-4-6:reasoning
`);

    const company = result.company as Record<string, unknown>;
    expect(company).toBeDefined();
    expect(company.maxRetries).toBe(3);
    const roles = company.roles as Record<string, Record<string, string>>;
    expect(roles).toBeDefined();
    expect(roles.developer).toBeDefined();
    expect(roles.developer.agent).toBe("claude:claude-sonnet-4-6");
    expect(roles.developer.mode).toBe("compare");
    expect(roles.ceo.agent).toBe("claude:claude-opus-4-6:reasoning");
  });

  it("parses company config with disabled role", () => {
    const result = parseYaml(`company:
  roles:
    qa:
        enabled: false
`);

    const company = result.company as Record<string, unknown>;
    const roles = company.roles as Record<string, Record<string, string>>;
    expect(roles.qa.enabled).toBe("false");
  });

  it("parses company config alongside standard config", () => {
    const result = parseYaml(`agents:
  - claude:claude-sonnet-4-6
  - codex:o3-mini
evaluate:
  - npm test
company:
  maxRetries: 1
  roles:
    pm:
        agent: claude:claude-opus-4-6:reasoning
`);

    expect(result.agents).toEqual(["claude:claude-sonnet-4-6", "codex:o3-mini"]);
    expect(result.evaluate).toEqual(["npm test"]);
    const company = result.company as Record<string, unknown>;
    expect(company.maxRetries).toBe(1);
    const roles = company.roles as Record<string, Record<string, string>>;
    expect(roles.pm.agent).toBe("claude:claude-opus-4-6:reasoning");
  });
});

describe("loadConfig — company integration", () => {
  it("returns undefined company when not configured", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-test-");
    fs.writeFileSync(path.join(tmpDir, ".council.yml"), `agents:
  - claude:claude-sonnet-4-6
`);

    const config = loadConfig(tmpDir);
    expect(config.company).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("loads company config from file", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-test-");
    fs.writeFileSync(path.join(tmpDir, ".council.yml"), `company:
  maxRetries: 2
  roles:
    developer:
        agent: claude:claude-sonnet-4-6
`);

    const config = loadConfig(tmpDir);
    expect(config.company).toBeDefined();
    expect(config.company?.maxRetries).toBe(2);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
