import { findRepoRoot } from "../worktree";
import { getTemplate, listTemplates, expandTemplate } from "../templates";
import { printInfo, printError, printSuccess } from "../ui/render";
import { RST, BOLD, DIM, FG, ICON, padEnd } from "../ui/theme";

export async function runTemplate(templateName: string | null, descriptionArg: string | null): Promise<void> {
  const repoPath = findRepoRoot();

  // List templates if no name given
  if (!templateName || templateName === "list") {
    const templates = listTemplates(repoPath);

    console.log();
    console.log(`  ${BOLD}${ICON.plan} Available Templates${RST}`);
    console.log(`  ${DIM}${"─".repeat(55)}${RST}`);
    console.log();

    for (const t of templates) {
      console.log(`  ${FG.brightCyan}${BOLD}${padEnd(t.name, 12)}${RST} ${t.description}`);
      if (t.roles) console.log(`  ${" ".repeat(12)} ${DIM}roles: ${t.roles}${RST}`);
    }

    console.log();
    console.log(`  ${DIM}Usage: council run <template> "description"${RST}`);
    console.log(`  ${DIM}Example: council run bugfix "Login form submits twice on slow networks"${RST}`);
    console.log();
    return;
  }

  const template = getTemplate(templateName, repoPath);
  if (!template) {
    printError(`Template not found: "${templateName}"`);
    printInfo("Available templates: " + listTemplates(repoPath).map((t) => t.name).join(", "));
    return;
  }

  if (!descriptionArg) {
    printError(`Missing description. Usage: council run ${templateName} "description"`);
    return;
  }

  const expandedTask = expandTemplate(template, descriptionArg);

  console.log();
  console.log(`  ${FG.brightCyan}${ICON.target}${RST} ${BOLD}Template:${RST} ${template.name}`);
  console.log(`  ${BOLD}Task:${RST} ${expandedTask.slice(0, 100)}${expandedTask.length > 100 ? "…" : ""}`);
  console.log();

  // Delegate to company command
  const { runCompany } = require("./company");
  await runCompany(expandedTask, null, template.roles ?? null, null, false);
}
