import { describe, it, expect } from "vitest";
import { parseCeoDecision } from "../pipeline";

describe("parseCeoDecision — extended edge cases", () => {
  it("rejects malformed JSON with valid decision key but wrong value", () => {
    const result = parseCeoDecision('{"decision": "maybe", "reasoning": "unsure"}');
    expect(result.decision).toBe("reject");
  });

  it("handles JSON with extra fields", () => {
    const result = parseCeoDecision('{"decision": "approve", "reasoning": "good", "extra": "field"}');
    expect(result.decision).toBe("approve");
  });

  it("handles very long content", () => {
    const longContent = '{"decision": "approve", "reasoning": "' + "a".repeat(10000) + '"}';
    const result = parseCeoDecision(longContent);
    expect(result.decision).toBe("approve");
  });

  it("handles content with newlines in reasoning", () => {
    const result = parseCeoDecision('{"decision": "reject", "reasoning": "Line 1\\nLine 2", "send_back_to": "developer"}');
    expect(result.decision).toBe("reject");
    expect(result.send_back_to).toBe("developer");
  });

  it("handles JSON with unicode characters", () => {
    const result = parseCeoDecision('{"decision": "approve", "reasoning": "Looks 👍 good"}');
    expect(result.decision).toBe("approve");
  });

  it("rejects when only reject keyword in verbose output", () => {
    const result = parseCeoDecision("After reviewing the implementation, I must reject this. The tests are insufficient.");
    expect(result.decision).toBe("reject");
  });

  it("approves when only approve keyword in verbose output", () => {
    const result = parseCeoDecision("I carefully reviewed everything and I approve this implementation for production.");
    expect(result.decision).toBe("approve");
  });

  it("defaults to reject for ambiguous mixed content with no JSON", () => {
    const result = parseCeoDecision("The code quality is good but I need to reject the lack of tests, though the team might approve later.");
    expect(result.decision).toBe("reject"); // both keywords present, defaults reject
  });

  it("parses JSON surrounded by markdown text", () => {
    const result = parseCeoDecision(`
After careful review:

\`\`\`json
{"decision": "approve", "reasoning": "All criteria met"}
\`\`\`

That's my final answer.
`);
    expect(result.decision).toBe("approve");
    expect(result.reasoning).toBe("All criteria met");
  });
});

describe("extractModelOutput patterns", () => {
  // Test the filtering logic used in pipeline.ts extractModelOutput
  function extractModelOutput(log: string[]): string {
    const textLines = log.filter((l) =>
      !l.startsWith("[tool]") && !l.startsWith("[result]") && !l.startsWith("[iteration")
      && !l.startsWith("Model:") && !l.startsWith("Done —") && !l.startsWith("[error]")
      && !l.startsWith("[stderr]")
    );
    return textLines
      .map((l) => l.replace(/^\[model\]\s*/, ""))
      .join("\n")
      .trim() || "(No output)";
  }

  it("returns model text, filtering tool calls", () => {
    const log = [
      "[iteration 1]",
      "[tool] read_file({path: 'foo.ts'})",
      "[result] file contents...",
      "[model] Here is my analysis:",
      "[model] The code looks good.",
      "Done — no more tool calls",
    ];
    const output = extractModelOutput(log);
    expect(output).toBe("Here is my analysis:\nThe code looks good.");
  });

  it("returns (No output) for empty log", () => {
    expect(extractModelOutput([])).toBe("(No output)");
  });

  it("returns (No output) when only tool calls", () => {
    const log = ["[iteration 1]", "[tool] read_file", "[result] ok", "Done — no more tool calls"];
    expect(extractModelOutput(log)).toBe("(No output)");
  });

  it("handles log lines without [model] prefix", () => {
    const log = ["This is raw output", "from the agent"];
    const output = extractModelOutput(log);
    expect(output).toBe("This is raw output\nfrom the agent");
  });

  it("filters [error] and [stderr] lines", () => {
    const log = ["[model] Good output", "[error] Something broke", "[stderr] Warning: deprecation"];
    const output = extractModelOutput(log);
    expect(output).toBe("Good output");
  });
});
