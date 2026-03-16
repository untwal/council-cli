import * as fs from "fs";
import * as path from "path";
import { findRepoRoot } from "../worktree";
import { loadPipelineState, listPipelineRuns, PipelineState, Artifact } from "../artifacts";
import { printInfo, printError, printSuccess } from "../ui/render";
import { RST, BOLD, DIM } from "../ui/theme";
import { elapsed } from "../ui/theme";

export async function runExport(runIdArg: string | null, outputArg: string | null): Promise<void> {
  const repoPath = findRepoRoot();

  // Resolve run
  let runId: string;
  let state: PipelineState | null;

  if (!runIdArg || runIdArg === "latest") {
    const runs = listPipelineRuns(repoPath);
    if (runs.length === 0) {
      printError("No pipeline runs found.");
      return;
    }
    const pick = runs.find((r) => r.state.finishedAt) ?? runs[0];
    runId = pick.runId;
    state = pick.state;
  } else {
    runId = runIdArg;
    state = loadPipelineState(repoPath, runId);
  }

  if (!state) {
    printError(`No pipeline state found for: ${runId}`);
    return;
  }

  const outputPath = outputArg ?? `council-report-${runId}.html`;
  const html = generateHTML(state, runId);

  fs.writeFileSync(outputPath, html, "utf-8");
  printSuccess(`Report exported to: ${outputPath}`);
  printInfo(`Open in browser: file://${path.resolve(outputPath)}`);
}

function generateHTML(state: PipelineState, runId: string): string {
  const totalMs = (state.finishedAt ?? Date.now()) - state.startedAt;
  const metrics = state.roleMetrics ?? [];
  const status = state.accepted ? "Approved" : "Rejected";
  const statusColor = state.accepted ? "#22c55e" : "#ef4444";

  const artifactSections = state.artifacts.map((a) => {
    const label = ARTIFACT_LABELS[a.type] ?? a.type;
    const content = a.type === "code"
      ? `<pre class="diff"><code>${escapeHtml(a.content)}</code></pre>`
      : `<div class="artifact-content">${markdownToHtml(a.content)}</div>`;

    return `
      <div class="artifact">
        <h3>${escapeHtml(label)}</h3>
        <div class="artifact-meta">Agent: <code>${escapeHtml(a.producerAgent)}</code> | Role: ${escapeHtml(a.producerRole)}</div>
        ${content}
      </div>`;
  }).join("\n");

  const timelineRows = metrics.map((m) => {
    const secs = Math.round(m.durationMs / 1000);
    const retryBadge = m.retries > 0 ? `<span class="badge retry">${m.retries} retries</span>` : "";
    return `<tr><td>${escapeHtml(m.role)}</td><td><code>${escapeHtml(m.agent)}</code></td><td>${secs}s</td><td>${retryBadge}</td></tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Council Report — ${escapeHtml(state.featureRequest.slice(0, 60))}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #e6edf3; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 1rem; border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; }
  h3 { font-size: 1rem; margin: 1rem 0 0.5rem; color: #58a6ff; }
  .header { border-bottom: 2px solid #30363d; padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .meta { color: #8b949e; font-size: 0.875rem; }
  .meta span { margin-right: 1.5rem; }
  .status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: 600; font-size: 0.875rem; color: white; background: ${statusColor}; }
  .feature { font-size: 1.1rem; margin: 1rem 0; padding: 1rem; background: #161b22; border-left: 3px solid #58a6ff; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 500; }
  code { background: #161b22; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.85rem; }
  pre { background: #161b22; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; margin: 0.5rem 0; }
  pre.diff code { color: #e6edf3; }
  .artifact { margin: 1.5rem 0; padding: 1rem; background: #161b22; border-radius: 6px; border: 1px solid #21262d; }
  .artifact-meta { color: #8b949e; font-size: 0.8rem; margin-bottom: 0.75rem; }
  .artifact-content { white-space: pre-wrap; font-size: 0.9rem; }
  .badge { font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 3px; }
  .badge.retry { background: #d29922; color: #000; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #21262d; color: #484f58; font-size: 0.8rem; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>Council Pipeline Report</h1>
  <div class="meta">
    <span>Run: <code>${escapeHtml(runId)}</code></span>
    <span>Duration: ${elapsed(totalMs)}</span>
    <span class="status">${status}</span>
  </div>
</div>

<div class="feature">${escapeHtml(state.featureRequest)}</div>

<h2>Timeline</h2>
<table>
  <thead><tr><th>Role</th><th>Agent</th><th>Duration</th><th>Notes</th></tr></thead>
  <tbody>${timelineRows}</tbody>
</table>

<h2>Artifacts</h2>
${artifactSections}

<div class="footer">
  Generated by council-cli v0.4.0 | ${new Date().toISOString().slice(0, 10)}
</div>

</body>
</html>`;
}

const ARTIFACT_LABELS: Record<string, string> = {
  spec: "Product Spec (PM)",
  design: "Technical Design (Architect)",
  code: "Implementation (Developer)",
  em_report: "EM Report",
  qa_report: "QA Report",
  decision: "CEO Decision",
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markdownToHtml(md: string): string {
  const escaped = escapeHtml(md);
  // Convert headers
  let html = escaped
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\[x\]/gm, "&#9745;")
    .replace(/^\[ \]/gm, "&#9744;");

  // Convert bullet lists to proper <ul><li> blocks
  const lines = html.split("\n");
  const result: string[] = [];
  let inList = false;
  for (const line of lines) {
    const bulletMatch = line.match(/^- (.+)$/);
    if (bulletMatch) {
      if (!inList) { result.push("<ul>"); inList = true; }
      result.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) { result.push("</ul>"); inList = false; }
      result.push(line);
    }
  }
  if (inList) result.push("</ul>");

  return result.join("\n");
}
