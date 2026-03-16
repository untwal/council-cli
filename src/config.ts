/**
 * .council.yml config file support.
 * Loaded from the repo root. Provides defaults for agents, evaluation, and templates.
 */
import * as fs from "fs";
import * as path from "path";

export interface CompanyRoleConfig {
  agent?: string;
  mode?: string;
  enabled?: boolean;
  prompt?: string;  // custom system prompt override
}

export interface CustomRoleConfig {
  title: string;
  prompt: string;
  agent?: string;
  mode?: string;
  output?: string;   // artifact type name
  after?: string;     // insert after this role
}

export interface CompanyConfig {
  roles?: Record<string, CompanyRoleConfig>;
  customRoles?: Record<string, CustomRoleConfig>;
  maxRetries?: number;
}

export interface CouncilConfig {
  agents?: string[];          // default agent specs: ["claude:claude-sonnet-4-6", "gemini-cli:default"]
  evaluate?: string[];        // commands to run for evaluation: ["npm test", "npx tsc --noEmit"]
  evaluateTimeout?: number;   // timeout per eval command in seconds (default: 120)
  maxIterations?: number;     // max tool-use iterations (default: 30)
  templates?: Record<string, string>;  // named task templates
  company?: CompanyConfig;    // company pipeline configuration
}

const DEFAULT_CONFIG: CouncilConfig = {
  agents: [],
  evaluate: [],
  evaluateTimeout: 120,
  maxIterations: 30,
  templates: {},
};

const configCache = new Map<string, CouncilConfig>();

export function loadConfig(repoPath: string): CouncilConfig {
  const cached = configCache.get(repoPath);
  if (cached) return cached;

  const candidates = [
    path.join(repoPath, ".council.yml"),
    path.join(repoPath, ".council.yaml"),
    path.join(repoPath, "council.yml"),
    path.join(repoPath, "council.yaml"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = parseYamlSimple(raw);
      const config = { ...DEFAULT_CONFIG, ...parsed };
      configCache.set(repoPath, config);
      return config;
    } catch { /* ignore malformed */ }
  }

  const config = { ...DEFAULT_CONFIG };
  configCache.set(repoPath, config);
  return config;
}

export function getConfig(): CouncilConfig {
  // Return most recently loaded config, or default
  const values = Array.from(configCache.values());
  return values.length > 0 ? values[values.length - 1] : DEFAULT_CONFIG;
}

/** Exported for testing only. */
export function parseYaml(raw: string): Record<string, unknown> {
  return parseYamlSimple(raw);
}

/** Reset cached config (for testing). */
export function resetCache(): void {
  configCache.clear();
}

/**
 * Minimal YAML parser — handles the flat structure we need without a dependency.
 * Supports: scalars, arrays (- item), and simple nested maps.
 */
function parseYamlSimple(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Level 0: top-level key (indent 0)
  let l0Key = "";
  let l0Collecting: "array" | "map" | null = null;
  let l0Array: string[] = [];
  let l0Map: Record<string, unknown> = {};
  // Level 1: nested map key (indent 2, no value → starts sub-map)
  let l1Key = "";
  let l1Map: Record<string, unknown> = {};
  // Level 2: sub-sub key (indent 4, no value → starts sub-sub-map)
  let l2Key = "";
  let l2Map: Record<string, string> = {};

  function flushL2(): void {
    if (l2Key && Object.keys(l2Map).length > 0) {
      l1Map[l2Key] = l2Map;
    }
    l2Key = "";
    l2Map = {};
  }

  function flushL1(): void {
    flushL2();
    if (l1Key && Object.keys(l1Map).length > 0) {
      l0Map[l1Key] = l1Map;
    }
    l1Key = "";
    l1Map = {};
  }

  function flushL0(): void {
    flushL1();
    if (!l0Key) return;
    if (l0Collecting === "array") result[l0Key] = l0Array;
    else if (l0Collecting === "map") result[l0Key] = l0Map;
    l0Key = "";
    l0Collecting = null;
    l0Array = [];
    l0Map = {};
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // Array item: "  - value" (any indent)
    const arrayMatch = trimmed.match(/^\s+-\s+(.*)/);
    if (arrayMatch && l0Key) {
      l0Collecting = "array";
      l0Array.push(arrayMatch[1].replace(/^["']|["']$/g, ""));
      continue;
    }

    // indent 0: top-level key
    if (indent === 0) {
      const m = trimmed.match(/^(\w[\w-]*):\s*(.*)/);
      if (m) {
        flushL0();
        const [, key, value] = m;
        if (value && value !== "") {
          const num = Number(value);
          result[key] = isNaN(num) ? value.replace(/^["']|["']$/g, "") : num;
        } else {
          l0Key = key;
        }
      }
      continue;
    }

    if (!l0Key) continue;

    // indent 2: map item or sub-key start
    if (indent >= 2 && indent < 4) {
      const kvMatch = trimmed.match(/^\s+(\w[\w-]*):\s+(.*)/);
      if (kvMatch) {
        flushL1();
        l0Collecting = "map";
        const val = kvMatch[2].replace(/^["']|["']$/g, "");
        const num = Number(val);
        l0Map[kvMatch[1]] = isNaN(num) ? val : num;
        continue;
      }
      const keyOnly = trimmed.match(/^\s+(\w[\w-]*):\s*$/);
      if (keyOnly) {
        flushL1();
        l0Collecting = "map";
        l1Key = keyOnly[1];
        l1Map = {};
        continue;
      }
    }

    // indent 4-7: sub-map item or sub-sub-key start
    if (indent >= 4 && indent < 8 && l0Collecting === "map") {
      const kvMatch = trimmed.match(/^\s+(\w[\w-]*):\s+(.*)/);
      if (kvMatch && !l2Key) {
        // Value under l1Key (no l2 active)
        const val = kvMatch[2].replace(/^["']|["']$/g, "");
        const num = Number(val);
        l1Map[kvMatch[1]] = isNaN(num) ? val : num;
        continue;
      }
      const keyOnly = trimmed.match(/^\s+(\w[\w-]*):\s*$/);
      if (keyOnly) {
        flushL2();
        l2Key = keyOnly[1];
        l2Map = {};
        continue;
      }
    }

    // indent 8+: value under l2Key
    if (indent >= 8 && l2Key) {
      const kvMatch = trimmed.match(/^\s+(\w[\w-]*):\s+(.*)/);
      if (kvMatch) {
        l2Map[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, "");
        continue;
      }
    }
  }

  flushL0();
  return result;
}
