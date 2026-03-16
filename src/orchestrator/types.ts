export interface ImplementationPlan {
  id: string;
  summary: string;
  reasoning: string;
  tasks: SubTask[];
  qualityCriteria: Record<string, string[]>;
}

export interface SubTask {
  id: string;
  title: string;
  description: string;
  category: "architecture" | "frontend" | "backend" | "tests" | "docs" | "refactor";
  assignedAgent: string;   // agent id (cli:model pair)
  dependencies: string[];
  priority: number;
}

export interface ReviewResult {
  taskId: string;
  passed: boolean;
  score: {
    codeQuality: number;
    correctness: number;
    completeness: number;
    maintainability: number;
    overall: number;
  };
  feedback: string;
}

export type OrchestratorPhase =
  | "idle"
  | "gathering_context"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "reviewing"
  | "iterating"
  | "merging"
  | "complete";
