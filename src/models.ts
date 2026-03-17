import * as https from "https";
import * as fs from "fs";
import * as os from "os";
import { execSync, spawnSync } from "child_process";

export interface ModelDef {
  id: string;
  label: string;
  cli: string;
  model: string;
  reasoning?: boolean;
}

// Discovery warnings — reported to user so failures are never silent
const warnings: string[] = [];

export function getDiscoveryWarnings(): string[] {
  return [...warnings];
}

function warn(msg: string): void {
  warnings.push(msg);
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
    req.setTimeout(15_000, () => req.destroy(new Error(`Model discovery timed out: ${u.hostname}`)));
  });
}

// ── CLI model listing (dynamic, no hardcoding) ──────────────────────────────

function discoverClaudeCliModels(): ModelDef[] {
  try {
    const r = spawnSync("claude", ["--list-models"], { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    if (r.status === 0 && r.stdout) {
      const models: ModelDef[] = [];
      for (const line of r.stdout.trim().split("\n")) {
        const model = line.trim();
        if (!model || model.startsWith("-")) continue;
        models.push({
          id: model,
          label: model,
          cli: "claude",
          model,
        });
        if (/opus/i.test(model)) {
          models.push({ id: `${model}:reasoning`, label: `${model} (Reasoning)`, cli: "claude", model, reasoning: true });
        }
      }
      if (models.length > 0) return models;
    }
  } catch { /* --list-models not supported, fall through */ }
  return [];
}

function discoverCodexCliModels(): ModelDef[] {
  try {
    const cacheFile = os.homedir() + "/.codex/models_cache.json";
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
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
    }
  } catch { /* no cache file */ }
  return [];
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

  // Try CLI --list-models first (dynamic, no hardcoding)
  if (hasCli) {
    const cliModels = discoverClaudeCliModels();
    if (cliModels.length > 0) return cliModels;
  }

  // Try API model list
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
    } catch (err) {
      warn(`Anthropic API model listing failed: ${(err as Error).message ?? err}. Using CLI discovery.`);
    }
  }

  // CLI available but both --list-models and API failed
  if (hasCli) {
    warn("Could not discover Claude models dynamically. Claude CLI is available — specify models with --agents flag.");
    // Return a minimal entry that lets the CLI handle model selection
    return [{ id: "claude:default", label: "Claude (default)", cli: "claude", model: "sonnet" }];
  }

  if (!key) return [];

  // Key exists, API failed, no CLI
  warn("Anthropic API failed and Claude CLI is not installed. Specify models with --agents flag.");
  return [];
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

  // Try CLI cache first (dynamic)
  if (hasCli) {
    const cliModels = discoverCodexCliModels();
    if (cliModels.length > 0) return cliModels;
  }

  if (!key && !hasCli) return [];

  // Try API
  if (key) {
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
    } catch (err) {
      warn(`OpenAI API model listing failed: ${(err as Error).message ?? err}. Using CLI discovery.`);
    }
  }

  // CLI available but no models discovered
  if (hasCli) {
    warn("Could not discover Codex models dynamically. Codex CLI is available — specify models with --agents flag.");
    return [{ id: "codex:default", label: "Codex (default)", cli: "codex", model: "o3-mini" }];
  }

  if (key) {
    warn("OpenAI API failed and Codex CLI is not installed. Specify models with --agents flag.");
  }
  return [];
}

// ── Google Gemini ────────────────────────────────────────────────────────────

function getGoogleKey(): string {
  return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
}

async function fetchGeminiModels(): Promise<ModelDef[]> {
  const hasCli = cliAvailable("gemini");
  const key = getGoogleKey();
  const runner = hasCli ? "gemini-cli" : "gemini";

  // Try API
  if (key) {
    try {
      const raw = await get("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": key });
      const data = JSON.parse(raw);
      if (data.error) throw new Error(data.error.message);
      const models = (data.models ?? []) as Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }>;

      const filtered = models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .filter((m) => /gemini/i.test(m.name))
        .slice(0, 8)
        .map((m) => {
          const id = m.name.replace("models/", "");
          return { id: `${runner}:${id}`, label: m.displayName ?? id, cli: runner, model: id };
        });
      if (filtered.length > 0) return filtered;
    } catch (err) {
      warn(`Gemini API model listing failed: ${(err as Error).message ?? err}. Using CLI discovery.`);
    }
  }

  // CLI available but API failed or no key
  if (hasCli) {
    if (!key) {
      warn("Gemini CLI found but no GOOGLE_API_KEY — using default model. Set GOOGLE_API_KEY for full model list.");
    }
    return [{ id: "gemini-cli:default", label: "Gemini (default)", cli: "gemini-cli", model: "default" }];
  }

  if (!key) return [];

  warn("Gemini API failed and Gemini CLI is not installed. Specify models with --agents flag.");
  return [];
}

// ── iloom ─────────────────────────────────────────────────────────────────────

function fetchIloomModels(): ModelDef[] {
  if (!cliAvailable("il")) return [];
  return [{ id: "iloom-swarm", label: "iloom Swarm", cli: "iloom", model: "swarm" }];
}

// ── Discovery ────────────────────────────────────────────────────────────────

const CLI_RUNNERS = new Set(["claude", "codex", "gemini-cli", "iloom"]);
const API_RUNNERS = new Set(["anthropic", "openai", "gemini"]);

const CACHE_TTL_MS = 60 * 60 * 1000;
let modelCache: { models: ModelDef[]; timestamp: number } | null = null;

export async function discoverModels(): Promise<ModelDef[]> {
  // Clear warnings for fresh discovery
  warnings.length = 0;

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

export function clearModelCache(): void {
  modelCache = null;
}

export async function discoverApiModels(): Promise<ModelDef[]> {
  const all = await discoverModels();
  return all.map((m) => {
    const suffix = m.reasoning ? ":reasoning" : "";
    if (m.cli === "claude") return { ...m, id: `anthropic:${m.model}${suffix}`, cli: "anthropic" };
    if (m.cli === "codex") return { ...m, id: `openai:${m.model}`, cli: "openai" };
    if (m.cli === "gemini-cli") return { ...m, id: `gemini:${m.model}`, cli: "gemini" };
    return m;
  }).filter((m) => API_RUNNERS.has(m.cli));
}
