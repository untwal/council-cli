import { describe, it, expect } from "vitest";
import { getTemplate, listTemplates, expandTemplate } from "../templates";

describe("getTemplate", () => {
  it("returns built-in bugfix template", () => {
    const t = getTemplate("bugfix");
    expect(t).not.toBeNull();
    expect(t!.name).toBe("bugfix");
    expect(t!.task).toContain("{description}");
    expect(t!.roles).toContain("developer");
  });

  it("returns built-in feature template", () => {
    const t = getTemplate("feature");
    expect(t).not.toBeNull();
    expect(t!.task).toBe("{description}");
  });

  it("returns null for unknown template", () => {
    expect(getTemplate("nonexistent")).toBeNull();
  });

  it("returns all built-in templates", () => {
    const names = ["bugfix", "refactor", "feature", "test", "docs", "security", "perf"];
    for (const name of names) {
      expect(getTemplate(name)).not.toBeNull();
    }
  });
});

describe("listTemplates", () => {
  it("lists all built-in templates", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(7);
    expect(templates.some((t) => t.name === "bugfix")).toBe(true);
    expect(templates.some((t) => t.name === "security")).toBe(true);
  });
});

describe("expandTemplate", () => {
  it("replaces {description} placeholder", () => {
    const t = getTemplate("bugfix")!;
    const result = expandTemplate(t, "Login fails on Safari");
    expect(result).toContain("Login fails on Safari");
    expect(result).not.toContain("{description}");
  });

  it("handles template with just {description}", () => {
    const t = getTemplate("feature")!;
    const result = expandTemplate(t, "Add dark mode");
    expect(result).toBe("Add dark mode");
  });
});
