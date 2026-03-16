import { describe, it, expect } from "vitest";

describe("streaming buffer overflow protection", () => {
  const MAX_BUFFER = 1024 * 1024;

  function processChunk(buffer: string, chunk: string): string {
    buffer += chunk;
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(-MAX_BUFFER / 2);
    }
    return buffer;
  }

  it("normal chunks accumulate", () => {
    let buffer = "";
    buffer = processChunk(buffer, "hello\n");
    buffer = processChunk(buffer, "world\n");
    expect(buffer).toContain("hello");
    expect(buffer).toContain("world");
  });

  it("truncates buffer when exceeding 1MB", () => {
    let buffer = "";
    const largeChunk = "x".repeat(MAX_BUFFER + 100);
    buffer = processChunk(buffer, largeChunk);
    expect(buffer.length).toBeLessThanOrEqual(MAX_BUFFER);
  });

  it("preserves recent data after truncation", () => {
    let buffer = "OLD_DATA_" + "x".repeat(MAX_BUFFER);
    buffer = processChunk(buffer, "NEW_DATA");
    expect(buffer).toContain("NEW_DATA");
  });
});

describe("streaming JSON parse resilience", () => {
  function processLine(line: string): { type: string } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  it("parses valid JSON", () => {
    const result = processLine('{"type": "text", "text": "hello"}');
    expect(result?.type).toBe("text");
  });

  it("returns null for empty line", () => {
    expect(processLine("")).toBeNull();
    expect(processLine("   ")).toBeNull();
  });

  it("returns null for non-JSON text", () => {
    expect(processLine("plain text output")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(processLine('{"type": "te')).toBeNull();
  });

  it("handles JSON with special chars", () => {
    const result = processLine('{"type": "text", "text": "line1\\nline2"}');
    expect(result?.type).toBe("text");
  });
});
