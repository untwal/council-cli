import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Test the path traversal protection and tool execution patterns from api/tools.ts

describe("path traversal protection", () => {
  const worktreePath = "/tmp/test-worktree";

  function resolveSafe(filePath: string): string {
    const resolved = path.resolve(worktreePath, filePath);
    if (!resolved.startsWith(path.resolve(worktreePath))) {
      throw new Error("Path traversal detected");
    }
    return resolved;
  }

  it("allows normal relative paths", () => {
    expect(resolveSafe("src/index.ts")).toBe("/tmp/test-worktree/src/index.ts");
  });

  it("allows nested paths", () => {
    expect(resolveSafe("src/commands/company.ts")).toBe("/tmp/test-worktree/src/commands/company.ts");
  });

  it("rejects ../../../etc/passwd", () => {
    expect(() => resolveSafe("../../../etc/passwd")).toThrow("Path traversal");
  });

  it("rejects ../../..", () => {
    expect(() => resolveSafe("../../..")).toThrow("Path traversal");
  });

  it("allows ./relative paths", () => {
    expect(resolveSafe("./src/file.ts")).toBe("/tmp/test-worktree/src/file.ts");
  });

  it("rejects absolute paths outside worktree", () => {
    expect(() => resolveSafe("/etc/passwd")).toThrow("Path traversal");
  });

  it("handles path with .. in middle that stays inside", () => {
    // src/../src/file.ts resolves to /tmp/test-worktree/src/file.ts — OK
    expect(resolveSafe("src/../src/file.ts")).toBe("/tmp/test-worktree/src/file.ts");
  });

  it("rejects path with .. in middle that escapes", () => {
    // src/../../etc resolves to /tmp/etc — NOT inside worktree
    expect(() => resolveSafe("src/../../etc")).toThrow("Path traversal");
  });
});

describe("regex validation for search_files", () => {
  it("accepts valid regex patterns", () => {
    expect(() => new RegExp("function\\s+\\w+", "i")).not.toThrow();
    expect(() => new RegExp("import.*from", "i")).not.toThrow();
  });

  it("rejects invalid regex", () => {
    expect(() => new RegExp("[invalid", "i")).toThrow();
  });

  it("handles common search patterns", () => {
    expect(() => new RegExp("TODO|FIXME|HACK", "i")).not.toThrow();
    expect(() => new RegExp("class\\s+\\w+", "i")).not.toThrow();
  });
});
