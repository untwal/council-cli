import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadWorkspaceConfig, validateWorkspace } from "../workspace";

describe("loadWorkspaceConfig", () => {
  it("returns null when no config file exists", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-ws-");
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("parses workspace config with repos", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-ws-");
    fs.writeFileSync(path.join(tmpDir, "council-workspace.yml"), `coordinator: claude:claude-opus-4-6:reasoning
repos:
  - name: frontend
    path: ../webapp
    roles: pm,architect,developer,qa
  - name: backend
    path: ../api-server
    roles: architect,developer,qa
`);

    const config = loadWorkspaceConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.coordinator).toBe("claude:claude-opus-4-6:reasoning");
    expect(config!.repos).toHaveLength(2);
    expect(config!.repos[0].name).toBe("frontend");
    expect(config!.repos[0].roles).toEqual(["pm", "architect", "developer", "qa"]);
    expect(config!.repos[1].name).toBe("backend");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("resolves relative paths", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-ws-");
    fs.writeFileSync(path.join(tmpDir, "council-workspace.yml"), `repos:
  - name: app
    path: ./src/app
`);

    const config = loadWorkspaceConfig(tmpDir);
    expect(config!.repos[0].path).toBe(path.resolve(tmpDir, "./src/app"));

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("defaults path to repo name", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-ws-");
    fs.writeFileSync(path.join(tmpDir, "council-workspace.yml"), `repos:
  - name: myrepo
`);

    const config = loadWorkspaceConfig(tmpDir);
    expect(config!.repos[0].path).toBe(path.resolve(tmpDir, "myrepo"));

    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("validateWorkspace", () => {
  it("returns error for empty repos", () => {
    const errors = validateWorkspace({ repos: [] });
    expect(errors).toContain("No repos defined in workspace config");
  });

  it("returns error for missing repo path", () => {
    const errors = validateWorkspace({
      repos: [{ name: "fake", path: "/nonexistent/path/xyz" }],
    });
    expect(errors.some((e) => e.includes("not found"))).toBe(true);
  });

  it("returns no errors for valid repo", () => {
    const tmpDir = fs.mkdtempSync("/tmp/council-ws-");
    fs.mkdirSync(path.join(tmpDir, ".git"));

    const errors = validateWorkspace({ repos: [{ name: "test", path: tmpDir }] });
    expect(errors).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
