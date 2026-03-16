import { describe, it, expect } from "vitest";
import { DEFAULT_ROLES, getRoleByName, buildRolePrompt, createCustomRole, Role } from "../roles";

describe("DEFAULT_ROLES", () => {
  it("has exactly 6 roles in correct order", () => {
    expect(DEFAULT_ROLES).toHaveLength(6);
    expect(DEFAULT_ROLES.map((r) => r.name)).toEqual(["pm", "architect", "developer", "em", "qa", "ceo"]);
  });

  it("PM produces spec with no inputs", () => {
    const pm = DEFAULT_ROLES[0];
    expect(pm.name).toBe("pm");
    expect(pm.artifactType).toBe("spec");
    expect(pm.inputArtifacts).toEqual([]);
    expect(pm.mode).toBe("single");
  });

  it("Architect consumes spec, produces design", () => {
    const arch = DEFAULT_ROLES[1];
    expect(arch.name).toBe("architect");
    expect(arch.artifactType).toBe("design");
    expect(arch.inputArtifacts).toEqual(["spec"]);
    expect(arch.mode).toBe("single");
  });

  it("Developer uses compare mode and consumes spec + design", () => {
    const dev = DEFAULT_ROLES[2];
    expect(dev.name).toBe("developer");
    expect(dev.artifactType).toBe("code");
    expect(dev.inputArtifacts).toEqual(["spec", "design"]);
    expect(dev.mode).toBe("compare");
  });

  it("EM consumes spec + design + code, produces em_report", () => {
    const em = DEFAULT_ROLES[3];
    expect(em.name).toBe("em");
    expect(em.artifactType).toBe("em_report");
    expect(em.inputArtifacts).toEqual(["spec", "design", "code"]);
    expect(em.mode).toBe("single");
  });

  it("QA consumes spec + code + em_report, produces qa_report", () => {
    const qa = DEFAULT_ROLES[4];
    expect(qa.name).toBe("qa");
    expect(qa.artifactType).toBe("qa_report");
    expect(qa.inputArtifacts).toEqual(["spec", "code", "em_report"]);
    expect(qa.mode).toBe("single");
  });

  it("CEO consumes all artifacts, produces decision", () => {
    const ceo = DEFAULT_ROLES[5];
    expect(ceo.name).toBe("ceo");
    expect(ceo.artifactType).toBe("decision");
    expect(ceo.inputArtifacts).toEqual(["spec", "design", "code", "em_report", "qa_report"]);
    expect(ceo.mode).toBe("single");
  });

  it("all roles have non-empty system prompts", () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.systemPrompt.length).toBeGreaterThan(50);
      expect(role.systemPrompt).toContain("{feature_request}");
    }
  });

  it("all roles have a title", () => {
    const titles = DEFAULT_ROLES.map((r) => r.title);
    expect(titles).toEqual(["Product Manager", "Systems Architect", "Senior Developer", "Engineering Manager", "QA Engineer", "CEO"]);
  });
});

describe("getRoleByName", () => {
  it("finds existing roles", () => {
    expect(getRoleByName("pm")?.title).toBe("Product Manager");
    expect(getRoleByName("ceo")?.title).toBe("CEO");
  });

  it("returns undefined for unknown role", () => {
    expect(getRoleByName("intern")).toBeUndefined();
  });
});

describe("buildRolePrompt", () => {
  it("injects feature request into system prompt", () => {
    const pm = DEFAULT_ROLES[0];
    const prompt = buildRolePrompt(pm, "Add dark mode", "");
    expect(prompt).toContain("Add dark mode");
    expect(prompt).not.toContain("{feature_request}");
  });

  it("injects artifact block when provided", () => {
    const arch = DEFAULT_ROLES[1];
    const artifactBlock = "## Product Spec\nUser stories...";
    const prompt = buildRolePrompt(arch, "Add dark mode", artifactBlock);
    expect(prompt).toContain("Prior Artifacts");
    expect(prompt).toContain("User stories...");
  });

  it("omits artifact section when no artifacts", () => {
    const pm = DEFAULT_ROLES[0];
    const prompt = buildRolePrompt(pm, "Add dark mode", "");
    expect(prompt).not.toContain("Prior Artifacts");
  });

  it("CEO prompt asks for JSON decision format", () => {
    const ceo = DEFAULT_ROLES[5];
    const prompt = buildRolePrompt(ceo, "test", "");
    expect(prompt).toContain('"approve"');
    expect(prompt).toContain('"reject"');
    expect(prompt).toContain("send_back_to");
  });
});

describe("createCustomRole", () => {
  it("creates a custom role with defaults", () => {
    const role = createCustomRole("security", "Security Auditor", "Review the code for vulnerabilities.");
    expect(role.name).toBe("security");
    expect(role.title).toBe("Security Auditor");
    expect(role.mode).toBe("single");
    expect(role.artifactType).toBe("qa_report");
    expect(role.systemPrompt).toContain("Security Auditor");
    expect(role.systemPrompt).toContain("{feature_request}");
    expect(role.systemPrompt).toContain("Review the code for vulnerabilities.");
  });

  it("creates a custom role with explicit options", () => {
    const role = createCustomRole("perf", "Performance Engineer", "Optimize the code.", {
      mode: "compare",
      agent: "claude:claude-opus-4-6",
      output: "code",
    });
    expect(role.mode).toBe("compare");
    expect(role.agentSpec).toBe("claude:claude-opus-4-6");
    expect(role.artifactType).toBe("code");
  });

  it("custom role prompt includes feature request and artifact placeholders", () => {
    const role = createCustomRole("auditor", "Code Auditor", "Check for issues.");
    const prompt = buildRolePrompt(role, "Add dark mode", "## Some artifact\ncontent");
    expect(prompt).toContain("Add dark mode");
    expect(prompt).toContain("Some artifact");
    expect(prompt).not.toContain("{feature_request}");
    expect(prompt).not.toContain("{artifacts}");
  });

  it("custom role consumes all prior artifact types except its own output", () => {
    const role = createCustomRole("test", "Tester", "Write tests.", { output: "qa_report" });
    expect(role.inputArtifacts).toContain("spec");
    expect(role.inputArtifacts).toContain("design");
    expect(role.inputArtifacts).toContain("code");
    expect(role.inputArtifacts).toContain("em_report");
    expect(role.inputArtifacts).not.toContain("qa_report");
  });
});
