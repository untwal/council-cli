import { loadConfig } from "./config";

export interface Template {
  name: string;
  description: string;
  task: string;
  roles?: string;
  agents?: string;
}

const BUILT_IN_TEMPLATES: Template[] = [
  {
    name: "bugfix",
    description: "Fix a bug with full QA verification",
    task: "Fix the following bug: {description}. Reproduce it, find the root cause, implement the fix, and add a regression test.",
    roles: "architect,developer,qa,ceo",
  },
  {
    name: "refactor",
    description: "Refactor code with safety checks",
    task: "Refactor: {description}. Maintain all existing behavior. No functional changes. Run tests to verify nothing breaks.",
    roles: "architect,developer,qa,ceo",
  },
  {
    name: "feature",
    description: "Full feature with spec, design, and implementation",
    task: "{description}",
  },
  {
    name: "test",
    description: "Add test coverage for existing code",
    task: "Add comprehensive test coverage for: {description}. Cover happy path, edge cases, and error scenarios.",
    roles: "developer,qa,ceo",
  },
  {
    name: "docs",
    description: "Generate documentation",
    task: "Write clear documentation for: {description}. Include usage examples, API reference, and common patterns.",
    roles: "pm,developer",
  },
  {
    name: "security",
    description: "Security audit with fix implementation",
    task: "Perform a security audit of: {description}. Check for OWASP Top 10 vulnerabilities. Implement fixes for any issues found.",
    roles: "architect,developer,qa,ceo",
  },
  {
    name: "perf",
    description: "Performance optimization",
    task: "Optimize the performance of: {description}. Profile, identify bottlenecks, implement optimizations, and benchmark before/after.",
    roles: "architect,developer,qa,ceo",
  },
];

export function getTemplate(name: string, repoPath?: string): Template | null {
  // Check config templates first
  if (repoPath) {
    const config = loadConfig(repoPath);
    const custom = config.templates?.[name];
    if (custom) {
      return { name, description: `Custom: ${name}`, task: custom };
    }
  }

  return BUILT_IN_TEMPLATES.find((t) => t.name === name) ?? null;
}

export function listTemplates(repoPath?: string): Template[] {
  const templates = [...BUILT_IN_TEMPLATES];

  if (repoPath) {
    const config = loadConfig(repoPath);
    if (config.templates) {
      for (const [name, task] of Object.entries(config.templates)) {
        if (!templates.find((t) => t.name === name)) {
          templates.push({ name, description: `Custom: ${name}`, task });
        }
      }
    }
  }

  return templates;
}

export function expandTemplate(template: Template, description: string): string {
  return template.task.replace(/\{description\}/g, description);
}
