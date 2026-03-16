/**
 * Sandboxed filesystem tools for the API-based agentic runner.
 * Ported from the VS Code extension — no vscode dependency.
 */
import * as fs from "fs";
import * as path from "path";
import { Tool } from "./client";

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the repository",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path from repo root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write or overwrite a file in the repository. Always write full file contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from repo root" },
          content: { type: "string", description: "Complete file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and directories at a given path",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Use '.' for root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern across files in the repository",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for" },
        },
        required: ["pattern"],
      },
    },
  },
];

const MAX_FILE_SIZE = 50 * 1024; // 50KB

export function executeTool(
  toolName: string,
  args: Record<string, string>,
  worktreePath: string
): string {
  function resolveSafe(filePath: string): string {
    const resolved = path.resolve(worktreePath, filePath);
    if (!resolved.startsWith(path.resolve(worktreePath))) {
      throw new Error("Path traversal detected");
    }
    return resolved;
  }

  try {
    switch (toolName) {
      case "read_file": {
        const fp = resolveSafe(args.path);
        if (!fs.existsSync(fp)) return `Error: File not found: ${args.path}`;
        const stat = fs.statSync(fp);
        if (stat.size > MAX_FILE_SIZE) {
          return fs.readFileSync(fp, "utf-8").slice(0, MAX_FILE_SIZE) + "\n[truncated]";
        }
        return fs.readFileSync(fp, "utf-8");
      }

      case "write_file": {
        const fp = resolveSafe(args.path);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, args.content, "utf-8");
        return `Wrote ${args.path}`;
      }

      case "list_directory": {
        const dp = resolveSafe(args.path || ".");
        if (!fs.existsSync(dp)) return `Error: Directory not found: ${args.path}`;
        const entries = fs.readdirSync(dp, { withFileTypes: true });
        return entries
          .filter((e) => !e.name.startsWith("."))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .join("\n");
      }

      case "search_files": {
        const pattern = args.pattern;
        // Reject patterns with nested quantifiers (ReDoS risk)
        if (/([+*?}])([+*?{])/.test(pattern)) {
          return `Rejected unsafe regex pattern (nested quantifiers): ${pattern}`;
        }
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, "i");
        } catch {
          return `Invalid regex: ${pattern}`;
        }
        const results: string[] = [];
        const MAX_DEPTH = 10;

        function walk(dir: string, depth = 0): void {
          if (results.length >= 100 || depth > MAX_DEPTH) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(full, depth + 1);
            } else if (entry.isFile()) {
              try {
                const content = fs.readFileSync(full, "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) {
                    const rel = path.relative(worktreePath, full);
                    results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                    if (results.length >= 100) return;
                  }
                }
              } catch { /* binary file, skip */ }
            }
          }
        }

        walk(worktreePath);
        return results.length > 0 ? results.join("\n") : "No matches found";
      }

      default:
        return `Error: Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Error: ${err}`;
  }
}
