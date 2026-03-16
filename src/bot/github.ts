import * as https from "https";

export interface GitHubClient {
  token: string;
  owner: string;
  repo: string;
}

export function createClient(token: string, owner: string, repo: string): GitHubClient {
  return { token, owner, repo };
}

// ── Issues & Comments ────────────────────────────────────────────────────────

export async function addComment(client: GitHubClient, issueNumber: number, body: string): Promise<number> {
  const result = await ghPost(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}/comments`, { body });
  return result.id as number;
}

export async function updateComment(client: GitHubClient, commentId: number, body: string): Promise<void> {
  await ghPatch(client, `/repos/${client.owner}/${client.repo}/issues/comments/${commentId}`, { body });
}

export async function addReaction(client: GitHubClient, commentId: number, reaction: string): Promise<void> {
  await ghPost(client, `/repos/${client.owner}/${client.repo}/issues/comments/${commentId}/reactions`, { content: reaction });
}

export async function getIssue(client: GitHubClient, issueNumber: number): Promise<{ title: string; body: string; labels: string[] }> {
  const result = await ghGet(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}`);
  return {
    title: result.title as string ?? "",
    body: result.body as string ?? "",
    labels: ((result.labels ?? []) as Array<{ name: string }>).map((l) => l.name),
  };
}

export async function addLabel(client: GitHubClient, issueNumber: number, labels: string[]): Promise<void> {
  await ghPost(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}/labels`, { labels });
}

// ── Pull Requests ────────────────────────────────────────────────────────────

export interface PRCreateOpts {
  title: string;
  body: string;
  head: string;
  base: string;
  labels?: string[];
}

export async function createPR(client: GitHubClient, opts: PRCreateOpts): Promise<{ number: number; html_url: string }> {
  const result = await ghPost(client, `/repos/${client.owner}/${client.repo}/pulls`, {
    title: opts.title,
    head: opts.head,
    base: opts.base,
    body: opts.body,
  });

  const prNumber = result.number as number;
  const htmlUrl = result.html_url as string;

  if (opts.labels?.length) {
    await addLabel(client, prNumber, opts.labels).catch(() => {});
  }

  return { number: prNumber, html_url: htmlUrl };
}

// ── Git refs ─────────────────────────────────────────────────────────────────

export async function getDefaultBranch(client: GitHubClient): Promise<string> {
  const result = await ghGet(client, `/repos/${client.owner}/${client.repo}`);
  return (result.default_branch as string) ?? "main";
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "council-bot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function ghGet(client: GitHubClient, path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: "api.github.com",
      path,
      headers: ghHeaders(client.token),
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub GET ${path}: ${res.statusCode} ${data.slice(0, 200)}`));
        } else {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON from GitHub: ${data.slice(0, 100)}`)); }
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`GitHub API timeout: GET ${path}`)));
  });
}

function ghPost(client: GitHubClient, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return ghRequest("POST", client, path, body);
}

function ghPatch(client: GitHubClient, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return ghRequest("PATCH", client, path, body);
}

function ghRequest(method: string, client: GitHubClient, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com",
      path,
      method,
      headers: {
        ...ghHeaders(client.token),
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub ${method} ${path}: ${res.statusCode} ${data.slice(0, 300)}`));
        } else {
          try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error(`Invalid JSON from GitHub: ${data.slice(0, 100)}`)); }
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`GitHub API timeout: ${method} ${path}`)));
    req.write(payload);
    req.end();
  });
}
