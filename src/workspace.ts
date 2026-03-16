import * as fs from "fs";
import * as path from "path";

export interface WorkspaceRepo {
  name: string;
  path: string;
  roles?: string[];
}

export interface WorkspaceConfig {
  repos: WorkspaceRepo[];
  coordinator?: string;  // agent spec for the coordinator
}

const CONFIG_NAMES = ["council-workspace.yml", "council-workspace.yaml"];

export function loadWorkspaceConfig(cwd: string): WorkspaceConfig | null {
  for (const name of CONFIG_NAMES) {
    const filePath = path.join(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf-8");
    return parseWorkspaceYaml(raw, cwd);
  }
  return null;
}

function parseWorkspaceYaml(raw: string, basePath: string): WorkspaceConfig {
  const repos: WorkspaceRepo[] = [];
  let coordinator: string | undefined;
  let inRepos = false;
  let currentRepo: Partial<WorkspaceRepo> = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    if (trimmed.startsWith("coordinator:")) {
      coordinator = trimmed.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
      continue;
    }

    if (trimmed.startsWith("repos:")) {
      inRepos = true;
      continue;
    }

    if (!inRepos) continue;

    // New repo entry: "  - name: frontend"
    const dashMatch = trimmed.match(/^\s+-\s+name:\s+(.+)/);
    if (dashMatch) {
      if (currentRepo.name) {
        repos.push(finalizeRepo(currentRepo, basePath));
      }
      currentRepo = { name: dashMatch[1].trim().replace(/^["']|["']$/g, "") };
      continue;
    }

    // Repo properties
    if (indent >= 4 && currentRepo.name) {
      const kvMatch = trimmed.match(/^\s+(\w+):\s+(.+)/);
      if (kvMatch) {
        const [, key, val] = kvMatch;
        const cleanVal = val.trim().replace(/^["']|["']$/g, "");
        if (key === "path") currentRepo.path = cleanVal;
        if (key === "roles") currentRepo.roles = cleanVal.split(",").map((r) => r.trim());
      }
    }
  }

  if (currentRepo.name) {
    repos.push(finalizeRepo(currentRepo, basePath));
  }

  return { repos, coordinator };
}

function finalizeRepo(partial: Partial<WorkspaceRepo>, basePath: string): WorkspaceRepo {
  const repoPath = partial.path
    ? path.resolve(basePath, partial.path)
    : path.resolve(basePath, partial.name!);

  return {
    name: partial.name!,
    path: repoPath,
    roles: partial.roles,
  };
}

export function validateWorkspace(config: WorkspaceConfig): string[] {
  const errors: string[] = [];

  if (config.repos.length === 0) {
    errors.push("No repos defined in workspace config");
  }

  for (const repo of config.repos) {
    if (!fs.existsSync(repo.path)) {
      errors.push(`Repo path not found: ${repo.path} (${repo.name})`);
    } else {
      const gitDir = path.join(repo.path, ".git");
      if (!fs.existsSync(gitDir)) {
        errors.push(`Not a git repo: ${repo.path} (${repo.name})`);
      }
    }
  }

  return errors;
}
