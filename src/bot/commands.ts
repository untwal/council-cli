export type BotCommandType = "company" | "compare" | "status" | "cancel" | "retry" | "help";

export interface BotCommand {
  type: BotCommandType;
  task?: string;
  agents?: string;
  roles?: string;
}

export interface WebhookContext {
  owner: string;
  repo: string;
  issueNumber: number;
  commentId: number;
  commentBody: string;
  commentAuthor: string;
  repoFullName: string;
  repoCloneUrl: string;
  isIssue: boolean;
}

export function parseCommand(body: string, botUsername: string): BotCommand | null {
  const mentionPattern = new RegExp(`@${escapeRegex(botUsername)}\\s*`, "i");
  if (!mentionPattern.test(body)) return null;

  const afterMention = body.replace(mentionPattern, "").trim();
  if (!afterMention) return { type: "help" };

  // Extract the command
  const cmdMatch = afterMention.match(/^\/(company|compare|status|cancel|retry|help)\b/i);
  if (!cmdMatch) return { type: "help" };

  const type = cmdMatch[1].toLowerCase() as BotCommandType;
  const rest = afterMention.slice(cmdMatch[0].length).trim();

  if (type === "status" || type === "cancel" || type === "help") {
    return { type };
  }

  // Parse flags from the rest
  const agents = extractInlineFlag(rest, "agents");
  const roles = extractInlineFlag(rest, "roles");

  // Everything else is the task
  const task = rest
    .replace(/--agents=\S+/g, "")
    .replace(/--roles=\S+/g, "")
    .trim() || undefined;

  return { type, task, agents: agents ?? undefined, roles: roles ?? undefined };
}

export function extractContext(payload: Record<string, unknown>): WebhookContext | null {
  const action = payload.action as string | undefined;
  if (action !== "created") return null;

  const comment = payload.comment as Record<string, unknown> | undefined;
  const issue = payload.issue as Record<string, unknown> | undefined;
  const repository = payload.repository as Record<string, unknown> | undefined;

  if (!comment || !issue || !repository) return null;

  const fullName = repository.full_name as string;
  const [owner, repo] = fullName.split("/");

  const user = comment.user as Record<string, unknown> | undefined;

  return {
    owner,
    repo,
    issueNumber: issue.number as number,
    commentId: comment.id as number,
    commentBody: comment.body as string ?? "",
    commentAuthor: (user?.login as string) ?? "",
    repoFullName: fullName,
    repoCloneUrl: (repository.clone_url as string) ?? `https://github.com/${fullName}.git`,
    isIssue: !issue.pull_request,
  };
}

function extractInlineFlag(text: string, flag: string): string | null {
  const match = text.match(new RegExp(`--${flag}=(\\S+)`));
  return match ? match[1] : null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
