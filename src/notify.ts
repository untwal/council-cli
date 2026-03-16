import * as https from "https";
import { Artifact } from "./artifacts";

export interface NotifyConfig {
  slackWebhookUrl?: string;
  enabled: boolean;
}

export function getNotifyConfig(): NotifyConfig {
  const url = process.env.COUNCIL_SLACK_WEBHOOK;
  return { slackWebhookUrl: url, enabled: !!url };
}

export async function notifyPipelineStart(featureRequest: string, runId: string, roles: string[]): Promise<void> {
  const config = getNotifyConfig();
  if (!config.enabled || !config.slackWebhookUrl) return;

  await postSlack(config.slackWebhookUrl, {
    blocks: [
      { type: "header", text: { type: "plain_text", text: ":building_construction: Council Pipeline Started" } },
      { type: "section", text: { type: "mrkdwn", text: `*Feature:* ${featureRequest}\n*Run:* \`${runId}\`\n*Roles:* ${roles.join(" → ")}` } },
    ],
  });
}

export async function notifyRoleComplete(featureRequest: string, roleName: string, roleTitle: string, durationSecs: number): Promise<void> {
  const config = getNotifyConfig();
  if (!config.enabled || !config.slackWebhookUrl) return;

  await postSlack(config.slackWebhookUrl, {
    text: `:white_check_mark: *${roleTitle}* completed (${durationSecs}s) — _${featureRequest.slice(0, 60)}_`,
  });
}

export async function notifyPipelineComplete(
  featureRequest: string,
  runId: string,
  accepted: boolean,
  totalMs: number,
  artifactCount: number,
  prUrl?: string
): Promise<void> {
  const config = getNotifyConfig();
  if (!config.enabled || !config.slackWebhookUrl) return;

  const status = accepted ? ":white_check_mark: Approved" : ":x: Rejected";
  const mins = Math.round(totalMs / 60000);
  const secs = Math.round((totalMs % 60000) / 1000);

  const fields: Array<{ type: string; text: string }> = [
    { type: "mrkdwn", text: `*Status:* ${status}` },
    { type: "mrkdwn", text: `*Duration:* ${mins}m ${secs}s` },
    { type: "mrkdwn", text: `*Artifacts:* ${artifactCount}` },
    { type: "mrkdwn", text: `*Run:* \`${runId}\`` },
  ];

  const blocks: Array<Record<string, unknown>> = [
    { type: "header", text: { type: "plain_text", text: ":scales: Council Pipeline Complete" } },
    { type: "section", text: { type: "mrkdwn", text: `*Feature:* ${featureRequest}` } },
    { type: "section", fields },
  ];

  if (prUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `:link: *PR:* <${prUrl}|View Pull Request>` },
    });
  }

  await postSlack(config.slackWebhookUrl, { blocks });
}

export async function notifyPipelineError(featureRequest: string, runId: string, error: string): Promise<void> {
  const config = getNotifyConfig();
  if (!config.enabled || !config.slackWebhookUrl) return;

  await postSlack(config.slackWebhookUrl, {
    blocks: [
      { type: "header", text: { type: "plain_text", text: ":x: Council Pipeline Failed" } },
      { type: "section", text: { type: "mrkdwn", text: `*Feature:* ${featureRequest}\n*Run:* \`${runId}\`\n*Error:* ${error.slice(0, 200)}` } },
    ],
  });
}

async function postSlack(url: string, body: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify(body);
  const parsed = new URL(url);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, () => resolve());
    req.on("error", () => resolve()); // don't crash pipeline on notification failure
    req.write(payload);
    req.end();
  });
}
