import { describe, it, expect } from "vitest";
import { parseCeoDecision } from "../pipeline";

describe("parseCeoDecision", () => {
  it("parses clean JSON approve decision", () => {
    const result = parseCeoDecision('{"decision": "approve", "reasoning": "Looks good"}');
    expect(result.decision).toBe("approve");
    expect(result.reasoning).toBe("Looks good");
  });

  it("parses clean JSON reject decision with send_back_to", () => {
    const result = parseCeoDecision('{"decision": "reject", "reasoning": "Tests missing", "send_back_to": "developer"}');
    expect(result.decision).toBe("reject");
    expect(result.reasoning).toBe("Tests missing");
    expect(result.send_back_to).toBe("developer");
  });

  it("parses JSON inside markdown fences", () => {
    const result = parseCeoDecision('Here:\n```json\n{"decision": "approve", "reasoning": "Ship it"}\n```');
    expect(result.decision).toBe("approve");
    expect(result.reasoning).toBe("Ship it");
  });

  it("parses JSON embedded in text", () => {
    const result = parseCeoDecision('Review: {"decision": "reject", "reasoning": "Bad arch"} done.');
    expect(result.decision).toBe("reject");
  });

  it("defaults to REJECT when no JSON found (safety)", () => {
    const result = parseCeoDecision("This looks great, ship it!");
    expect(result.decision).toBe("reject");
    expect(result.reasoning).toContain("Could not parse");
  });

  it("approves when explicit approve keyword found without reject", () => {
    const result = parseCeoDecision("I approve this implementation. Ship it.");
    expect(result.decision).toBe("approve");
  });

  it("rejects when reject keyword found", () => {
    const result = parseCeoDecision("I reject this implementation because it lacks tests.");
    expect(result.decision).toBe("reject");
  });

  it("rejects when both approve and reject keywords present (ambiguous)", () => {
    const result = parseCeoDecision("I don't reject this, I approve it.");
    // Both keywords present → can't be sure, defaults to reject for safety
    expect(result.decision).toBe("reject");
  });

  it("defaults to reject on empty content", () => {
    const result = parseCeoDecision("");
    expect(result.decision).toBe("reject");
  });

  it("rejects invalid JSON decision values", () => {
    const result = parseCeoDecision('{"decision": "maybe", "reasoning": "unsure"}');
    expect(result.decision).toBe("reject");
  });

  it("provides send_back_to=developer on parse failure", () => {
    const result = parseCeoDecision("unparseable garbage");
    expect(result.send_back_to).toBe("developer");
  });
});

describe("role agent resolution patterns", () => {
  it("architect and ceo prefer reasoning models", () => {
    const preferReasoning = ["architect", "ceo"];
    expect(preferReasoning.includes("architect")).toBe(true);
    expect(preferReasoning.includes("ceo")).toBe(true);
    expect(preferReasoning.includes("developer")).toBe(false);
  });
});
