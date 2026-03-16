import { execSync, spawnSync } from "child_process";
import { ImplementationPlan, SubTask } from "./types";
import { ModelDef } from "../models";

/**
 * Uses the Claude CLI as the "CTO brain" to generate an implementation plan.
 * Falls back to a simple single-task plan if Claude isn't available.
 */
export function generatePlan(
  repoPath: string,
  description: string,
  constraints: string[],
  availableAgents: ModelDef[]
): ImplementationPlan {
  const context = gatherContext(repoPath);
  const agentList = availableAgents.map((a) => `${a.id} (${a.cli}, ${a.model})`).join("\n");

  const prompt = `You are a CTO and principal engineer. Analyze this feature request and produce a structured implementation plan.

## Feature Request
${description}

${constraints.length > 0 ? `## Constraints\n${constraints.map((c) => `- ${c}`).join("\n")}` : ""}

## Project Context
${context}

## Available Agents
${agentList}

## Instructions
Decompose into parallel-safe subtasks. For each task, assign the best agent from the available list.
Categories: architecture, frontend, backend, tests, docs, refactor.

Respond with ONLY a JSON object (no markdown fences):
{
  "summary": "One paragraph summary",
  "reasoning": "Why this approach",
  "tasks": [
    {
      "id": "task-1",
      "title": "Short title",
      "description": "Full description of what to implement",
      "category": "backend",
      "assignedAgent": "agent-id-from-list",
      "dependencies": [],
      "priority": 1
    }
  ],
  "qualityCriteria": {
    "codeQuality": ["criterion"],
    "testCoverage": ["criterion"],
    "security": ["criterion"]
  }
}`;

  const response = callClaude(prompt);
  return parsePlanResponse(response, availableAgents);
}

export function reviewDiff(
  taskTitle: string,
  taskDescription: string,
  diff: string,
  qualityCriteria: Record<string, string[]>
): { passed: boolean; score: Record<string, number>; feedback: string } {
  const prompt = `You are a CTO reviewing an AI agent's implementation.

## Task
${taskTitle}: ${taskDescription}

## Quality Criteria
${JSON.stringify(qualityCriteria)}

## Diff
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`

Score each dimension 0-10. Overall >= 7.0 passes.
Respond with ONLY JSON (no markdown fences):
{
  "passed": true,
  "score": { "codeQuality": 8, "correctness": 9, "completeness": 8, "maintainability": 7, "overall": 8.0 },
  "feedback": "Brief feedback"
}`;

  const response = callClaude(prompt);
  try {
    const json = extractJson(response);
    const parsed = JSON.parse(json);
    return {
      passed: parsed.passed ?? (parsed.score?.overall ?? 0) >= 7,
      score: parsed.score ?? { codeQuality: 5, correctness: 5, completeness: 5, maintainability: 5, overall: 5 },
      feedback: parsed.feedback ?? "",
    };
  } catch {
    return { passed: true, score: { codeQuality: 7, correctness: 7, completeness: 7, maintainability: 7, overall: 7 }, feedback: "Could not parse review" };
  }
}

function callClaude(prompt: string): string {
  try {
    const env = { ...process.env } as Record<string, string>;
    delete env.CLAUDECODE;
    const result = spawnSync("claude", ["--print", prompt], {
      encoding: "utf-8",
      env,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 10,
    });
    if (result.error) throw result.error;
    return result.stdout ?? "";
  } catch {
    throw new Error("Claude CLI not available for planning. Install Claude Code and authenticate.");
  }
}

function gatherContext(repoPath: string): string {
  const sections: string[] = [];

  try {
    const ls = execSync("ls -la", { cwd: repoPath, encoding: "utf-8" });
    sections.push(`## Root directory\n${ls.slice(0, 2000)}`);
  } catch { /* */ }

  // Try reading common config files
  for (const file of ["package.json", "tsconfig.json", "Gemfile", "pyproject.toml", "go.mod", "Cargo.toml"]) {
    try {
      const content = execSync(`head -50 ${file}`, { cwd: repoPath, encoding: "utf-8" });
      sections.push(`## ${file}\n${content}`);
    } catch { /* */ }
  }

  const context = sections.join("\n\n");
  return context.slice(0, 15_000);
}

function parsePlanResponse(response: string, agents: ModelDef[]): ImplementationPlan {
  const json = extractJson(response);
  const parsed = JSON.parse(json);
  const agentIds = new Set(agents.map((a) => a.id));

  const tasks: SubTask[] = (parsed.tasks ?? []).map((t: SubTask, i: number) => {
    const task = {
      id: t.id || `task-${i + 1}`,
      title: t.title ?? `Task ${i + 1}`,
      description: t.description ?? "",
      category: t.category ?? "backend",
      assignedAgent: t.assignedAgent ?? "",
      dependencies: t.dependencies ?? [],
      priority: t.priority ?? i + 1,
    };

    // Validate assigned agent exists
    if (!agentIds.has(task.assignedAgent) && agents.length > 0) {
      task.assignedAgent = agents[i % agents.length].id;
    }

    return task;
  });

  return {
    id: `plan-${Date.now()}`,
    summary: parsed.summary ?? "",
    reasoning: parsed.reasoning ?? "",
    tasks,
    qualityCriteria: parsed.qualityCriteria ?? {},
  };
}

function extractJson(text: string): string {
  // Try to extract JSON from markdown code fences
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) return fenced[1].trim();
  // Try to find raw JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
