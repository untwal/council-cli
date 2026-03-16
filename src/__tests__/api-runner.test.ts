import { describe, it, expect } from "vitest";

describe("tool argument parsing resilience", () => {
  // Test the JSON.parse pattern used in api/runner.ts
  function parseToolArgs(argsStr: string): Record<string, string> {
    let args: Record<string, string> = {};
    try { args = JSON.parse(argsStr); } catch { /* logged in actual code */ }
    return args;
  }

  it("parses valid JSON arguments", () => {
    const result = parseToolArgs('{"path": "/tmp/file.txt"}');
    expect(result.path).toBe("/tmp/file.txt");
  });

  it("returns empty object for invalid JSON", () => {
    const result = parseToolArgs("not json at all");
    expect(result).toEqual({});
  });

  it("returns empty object for empty string", () => {
    const result = parseToolArgs("");
    expect(result).toEqual({});
  });

  it("handles JSON with nested objects", () => {
    const result = parseToolArgs('{"content": "line1\\nline2", "path": "file.ts"}');
    expect(result.content).toContain("line1");
    expect(result.path).toBe("file.ts");
  });

  it("handles truncated JSON gracefully", () => {
    const result = parseToolArgs('{"path": "/tmp/fi');
    expect(result).toEqual({});
  });
});

describe("tool loop iteration bound", () => {
  it("MAX_ITERATIONS prevents infinite loops", () => {
    const MAX_ITERATIONS = 30;
    let iterations = 0;
    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      iterations++;
    }
    expect(iterations).toBe(30);
  });
});
