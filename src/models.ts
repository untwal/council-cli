import * as https from "https";
import * as fs from "fs";
import * as os from "os";
import { execSync, spawnSync } from "child_process";

export interface ModelDef {
  id: string;
  label: string;
  cli: string;   // "claude"|"codex"|"iloom" for CLI, "anthropic"|"openai"|"gemini" for API
  model: string;
  reasoning?: boolean;  // enable extended thinking / reasoning mode
}

function cliAvailable(cmd: string): boolean {
  try {
    const r = spawnSync("which", [cmd], { stdio: "ignore", timeout: 5_000 });
    return r.status === 0;
  } catch { return false; }
}

function get(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + (u.search || ""), headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error(`Model discovery timed out: ${url}`)));
  });
}

// ── Anthropic / Claude ───────────────────────────────────────────────────────

function getAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const r = spawnSync("claude", ["config", "get", "apiKey"], { encoding: "utf-8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] });
    return r.status === 0 ? (r.stdout ?? "").trim() : "";
  } catch { return ""; }
}

async function fetchAnthropicModels(): Promise<ModelDef[]> {
  const hasCli = cliAvailable("claude");
  const key = getAnthropicKey();

  // Claude CLI has its own auth — it works even without ANTHROPIC_API_KEY.
  // If we have a key, try the API for the real model list.
  if (key) {
    try {
      const raw = await get("https://api.anthropic.com/v1/models", {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      });
      const data = JSON.parse(raw);
      if (data.error) throw new Error(data.error.message);
      const models = (data.data ?? []) as Array<{ id: string; display_name?: string }>;
      if (models.length > 0) {
        const runner = hasCli ? "claude" : "anthropic";
        const result: ModelDef[] = models.map((m) => ({
          id: hasCli ? m.id : `anthropic:${m.id}`,
          label: m.display_name ?? m.id,
          cli: runner,
          model: m.id,
        }));
        // Add reasoning variants for Opus models (extended thinking)
        for (const m of models) {
          if (/opus/i.test(m.id)) {
            result.push({
              id: hasCli ? `${m.id}:reasoning` : `anthropic:${m.id}:reasoning`,
              label: `${m.display_name ?? m.id} (Reasoning)`,
              cli: runner,
              model: m.id,
              reasoning: true,
            });
          }
        }
        return result;
      }
    } catch { /* fall through */ }
  }

  // CLI available without API key — return hardcoded models for CLI runner
  if (hasCli && !key) {
    return [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", cli: "claude", model: "claude-sonnet-4-6" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", cli: "claude", model: "claude-opus-4-6" },
      { id: "claude-opus-4-6:reasoning", label: "Claude Opus 4.6 (Reasoning)", cli: "claude", model: "claude-opus-4-6", reasoning: true },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", cli: "claude", model: "claude-3-5-sonnet-20241022" },
    ];
  }

  // No CLI, no key — nothing available
  if (!key) return [];

  // Fallback: key exists but API failed
  const runner = hasCli ? "claude" : "anthropic";
  return [
    { id: `${runner}:claude-sonnet-4-6`, label: "Claude Sonnet 4.6", cli: runner, model: "claude-sonnet-4-6" },
    { id: `${runner}:claude-opus-4-6`, label: "Claude Opus 4.6", cli: runner, model: "claude-opus-4-6" },
    { id: `${runner}:claude-opus-4-6:reasoning`, label: "Claude Opus 4.6 (Reasoning)", cli: runner, model: "claude-opus-4-6", reasoning: true },
    { id: `${runner}:claude-3-5-sonnet-20241022`, label: "Claude 3.5 Sonnet", cli: runner, model: "claude-3-5-sonnet-20241022" },
  ];
}

// ── OpenAI / Codex ───────────────────────────────────────────────────────────

function getOpenAIKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const auth = JSON.parse(fs.readFileSync(os.homedir() + "/.codex/auth.json", "utf-8"));
    return auth.OPENAI_API_KEY ?? auth.tokens?.access_token ?? "";
  } catch { return ""; }
}

async function fetchOpenAIModels(): Promise<ModelDef[]> {
  const hasCli = cliAvailable("codex");
  const key = getOpenAIKey();

  // Codex CLI has its own auth — it works even without OPENAI_API_KEY.
  // Always check the CLI cache first if codex is installed.
  if (hasCli) {
    try {
      const data = JSON.parse(fs.readFileSync(os.homedir() + "/.codex/models_cache.json", "utf-8"));
      const models = Array.isArray(data) ? data : data.models ?? data.data ?? [];
      const listed = models.filter((m: { visibility?: string }) => m.visibility === "list");
      if (listed.length > 0) {
        return listed.map((m: { slug: string; display_name: string }) => ({
          id: `codex:${m.slug}`,
          label: m.display_name ?? m.slug,
          cli: "codex",
          model: m.slug,
        }));
      }
    } catch { /* fall through */ }

    // Codex CLI exists but no cache — return hardcoded codex models
    if (!key) {
      return [
        { id: "codex:o3-mini", label: "o3 Mini", cli: "codex", model: "o3-mini" },
        { id: "codex:gpt-4o", label: "GPT-4o", cli: "codex", model: "gpt-4o" },
      ];
    }
  }

  // No codex CLI — need OPENAI_API_KEY for API-based runner
  if (!key) return [];

  // Query OpenAI API
  try {
    const raw = await get("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` });
    const data = JSON.parse(raw);
    if (data.error) throw new Error(data.error.message);
    const runner = hasCli ? "codex" : "openai";
    const filtered = (data.data ?? [])
      .filter((m: { id: string }) => /^(gpt-[45]|o[1-4])/.test(m.id))
      .map((m: { id: string }) => ({
        id: `${runner}:${m.id}`,
        label: m.id,
        cli: runner,
        model: m.id,
      }));
    if (filtered.length > 0) return filtered;
  } catch { /* fall through */ }

  // Fallback: hardcoded
  const runner = hasCli ? "codex" : "openai";
  return [
    { id: `${runner}:gpt-4o`, label: "GPT-4o", cli: runner, model: "gpt-4o" },
    { id: `${runner}:gpt-4-turbo`, label: "GPT-4 Turbo", cli: runner, model: "gpt-4-turbo" },
  ];
}

// ── Google Gemini ────────────────────────────────────────────────────────────

function getGoogleKey(): string {
  return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
}

async function fetchGeminiModels(): Promise<ModelDef[]> {
  const hasCli = cliAvailable("gemini");
  const key = getGoogleKey();

  // Gemini CLI has its own auth — works without GOOGLE_API_KEY.
  // Use "gemini-cli" runner for CLI, "gemini" for API.
  const runner = hasCli ? "gemini-cli" : "gemini";

  // If we have a key, try fetching the real model list from API
  if (key) {
    try {
      const raw = await get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {});
      const data = JSON.parse(raw);
      if (data.error) throw new Error(data.error.message);
      const models = (data.models ?? []) as Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }>;

      const filtered = models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .filter((m) => /gemini/i.test(m.name))
        .slice(0, 8)
        .map((m) => {
          const id = m.name.replace("models/", "");
          return {
            id: `${runner}:${id}`,
            label: m.displayName ?? id,
            cli: runner,
            model: id,
          };
        });
      if (filtered.length > 0) return filtered;
    } catch { /* fall through */ }
  }

  // CLI available without API key — return hardcoded models for CLI runner
  if (hasCli && !key) {
    return [
      { id: "gemini-cli:gemini-2.5-flash", label: "Gemini 2.5 Flash", cli: "gemini-cli", model: "gemini-2.5-flash" },
      { id: "gemini-cli:gemini-2.5-pro", label: "Gemini 2.5 Pro", cli: "gemini-cli", model: "gemini-2.5-pro" },
      { id: "gemini-cli:default", label: "Gemini (default)", cli: "gemini-cli", model: "default" },
    ];
  }

  // No CLI, no key — nothing
  if (!key) return [];

  // Fallback: key exists but API failed
  return [
    { id: `${runner}:gemini-2.0-flash`, label: "Gemini 2.0 Flash", cli: runner, model: "gemini-2.0-flash" },
    { id: `${runner}:gemini-1.5-pro-latest`, label: "Gemini 1.5 Pro", cli: runner, model: "gemini-1.5-pro-latest" },
    { id: `${runner}:gemini-1.5-flash-latest`, label: "Gemini 1.5 Flash", cli: runner, model: "gemini-1.5-flash-latest" },
  ];
}

// ── iloom ─────────────────────────────────────────────────────────────────────

function fetchIloomModels(): ModelDef[] {
  if (!cliAvailable("il")) return [];
  return [{ id: "iloom-swarm", label: "iloom Swarm", cli: "iloom", model: "swarm" }];
}

// ── Discovery ────────────────────────────────────────────────────────────────

const CLI_RUNNERS = new Set(["claude", "codex", "gemini-cli", "iloom"]);
const API_RUNNERS = new Set(["anthropic", "openai", "gemini"]);

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let modelCache: { models: ModelDef[]; timestamp: number } | null = null;

export async function discoverModels(): Promise<ModelDef[]> {
  // Return cached models if fresh
  if (modelCache && Date.now() - modelCache.timestamp < CACHE_TTL_MS) {
    return modelCache.models;
  }

  const [anthropic, openai, gemini] = await Promise.all([
    fetchAnthropicModels(),
    fetchOpenAIModels(),
    fetchGeminiModels(),
  ]);
  const iloom = fetchIloomModels();
  const all = [...iloom, ...anthropic, ...openai, ...gemini];

  all.sort((a, b) => {
    const aCli = CLI_RUNNERS.has(a.cli) ? 0 : 1;
    const bCli = CLI_RUNNERS.has(b.cli) ? 0 : 1;
    return aCli - bCli;
  });

  modelCache = { models: all, timestamp: Date.now() };
  return all;
}

/** Clear model cache (for testing or forced refresh). */
export function clearModelCache(): void {
  modelCache = null;
}

/**
 * Discover only API-based models (for chat mode, which needs multi-turn).
 * CLI runners are converted to their API equivalents.
 */
export async function discoverApiModels(): Promise<ModelDef[]> {
  const all = await discoverModels();
  return all.map((m) => {
    // Convert CLI runners to API runners for chat mode
    const suffix = m.reasoning ? ":reasoning" : "";
    if (m.cli === "claude") return { ...m, id: `anthropic:${m.model}${suffix}`, cli: "anthropic" };
    if (m.cli === "codex") return { ...m, id: `openai:${m.model}`, cli: "openai" };
    if (m.cli === "gemini-cli") return { ...m, id: `gemini:${m.model}`, cli: "gemini" };
    return m;
  }).filter((m) => API_RUNNERS.has(m.cli));
}
