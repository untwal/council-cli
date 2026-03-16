import * as http from "http";
import * as crypto from "crypto";
import { parseCommand, extractContext } from "./commands";
import { executeCommand } from "./runner";
import { findRepoRoot } from "../worktree";
import { killAll, cleanupWorktrees } from "../process";

export interface BotServerConfig {
  port: number;
  webhookSecret: string;
  githubToken: string;
  botUsername: string;
  repoPath: string;
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  [${ts}] ${msg}`);
}

function verifySignature(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function startServer(config: BotServerConfig): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const MAX_PAYLOAD = 10 * 1024 * 1024; // 10MB
    let body = "";
    let aborted = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_PAYLOAD) {
        aborted = true;
        res.writeHead(413);
        res.end("Payload too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      // Verify signature
      const sig = req.headers["x-hub-signature-256"] as string | undefined;
      if (!verifySignature(config.webhookSecret, body, sig)) {
        log("Rejected: invalid webhook signature");
        res.writeHead(401);
        res.end("Invalid signature");
        return;
      }

      // Parse event
      const event = req.headers["x-github-event"] as string;
      log(`Event: ${event}`);

      if (event === "ping") {
        res.writeHead(200);
        res.end("pong");
        return;
      }

      // Respond immediately — process async
      res.writeHead(202);
      res.end("Accepted");

      if (event !== "issue_comment") return;

      // Parse payload
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body);
      } catch {
        log("Failed to parse webhook payload");
        return;
      }

      const ctx = extractContext(payload);
      if (!ctx) {
        log("Could not extract context from payload");
        return;
      }

      const command = parseCommand(ctx.commentBody, config.botUsername);
      if (!command) return; // Not a bot mention

      log(`Command: /${command.type} from @${ctx.commentAuthor} on #${ctx.issueNumber}`);

      executeCommand(ctx, command, {
        githubToken: config.githubToken,
        botUsername: config.botUsername,
        repoPath: config.repoPath,
      }).catch((err) => {
        log(`Error executing command: ${err}`);
        try { killAll("SIGTERM"); } catch (e) { log(`Kill cleanup failed: ${e}`); }
        try { cleanupWorktrees(); } catch (e) { log(`Worktree cleanup failed: ${e}`); }
      });
    });
  });

  server.listen(config.port, () => {
    console.log();
    console.log(`  Council Bot server listening on port ${config.port}`);
    console.log(`  Webhook URL: http://localhost:${config.port}/webhook`);
    console.log(`  Bot username: @${config.botUsername}`);
    console.log();
    console.log(`  Waiting for webhooks...`);
    console.log();
  });

  return server;
}

export async function startBot(port: number, setup: boolean): Promise<void> {
  if (setup) {
    printSetupGuide(port);
    return;
  }

  const webhookSecret = process.env.COUNCIL_WEBHOOK_SECRET;
  const githubToken = process.env.COUNCIL_GITHUB_TOKEN;
  const botUsername = process.env.COUNCIL_BOT_USERNAME ?? "council-bot";

  if (!webhookSecret) {
    console.error("\n  Error: COUNCIL_WEBHOOK_SECRET not set.");
    console.error("  Run `council bot --setup` for configuration instructions.\n");
    process.exit(1);
  }

  if (!githubToken) {
    console.error("\n  Error: COUNCIL_GITHUB_TOKEN not set.");
    console.error("  Run `council bot --setup` for configuration instructions.\n");
    process.exit(1);
  }

  let repoPath: string;
  try {
    repoPath = findRepoRoot();
  } catch {
    console.error("\n  Error: Not in a git repository. Run from the repo you want the bot to operate on.\n");
    process.exit(1);
  }

  startServer({ port, webhookSecret, githubToken, botUsername, repoPath });
}

function printSetupGuide(port: number): void {
  console.log(`
  Council Bot Setup Guide
  ${"─".repeat(50)}

  1. Create a GitHub Personal Access Token (PAT):
     - Go to https://github.com/settings/tokens
     - Create a "Fine-grained" token with these permissions:
       - Issues: Read and write
       - Pull requests: Read and write
       - Contents: Read and write
     - Copy the token

  2. Set environment variables:

     export COUNCIL_GITHUB_TOKEN="ghp_your_token_here"
     export COUNCIL_WEBHOOK_SECRET="$(openssl rand -hex 20)"
     export COUNCIL_BOT_USERNAME="council-bot"     # optional, default

  3. Configure GitHub webhook:
     - Go to your repo → Settings → Webhooks → Add webhook
     - Payload URL: http://your-server:${port}/webhook
     - Content type: application/json
     - Secret: (same value as COUNCIL_WEBHOOK_SECRET)
     - Events: Select "Issue comments"

  4. Start the bot:

     council bot --port ${port}

  5. Test it by commenting on an issue:

     @council-bot /company Add dark mode

  For production, use a reverse proxy (nginx/caddy) with HTTPS
  and run the bot as a systemd service or Docker container.
`);
}
