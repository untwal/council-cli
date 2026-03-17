# Council

**AI Company in a CLI** — Run feature requests through a full team of AI agents: PM, Architect, Developer, Engineering Manager, QA, and CEO. Each role produces artifacts that flow to the next. The CEO approves or sends work back.

```
council company "Add dark mode with system preference detection"

PM → Architect → Developer → EM → QA → CEO
                  (compare)              ↑
                                reject → ┘
```

Also includes: GitHub bot, multi-repo workspaces, agent comparison, templates, standup reports, analytics, background execution, and HTML export.

**Zero runtime dependencies. 424 KB dist. 200ms startup. 267 tests.**

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [All Commands](#all-commands)
- [Company Pipeline](#company-pipeline)
- [GitHub Bot](#github-bot)
- [Multi-Repo Workspaces](#multi-repo-workspaces)
- [Templates](#templates)
- [Roles](#roles)
- [Configuration](#configuration)
- [Supported Agents](#supported-agents)
- [Environment Variables](#environment-variables)
- [Production Guardrails](#production-guardrails)
- [Security](#security)
- [Architecture](#architecture)
- [FAQ](#faq)

---

## Install

```bash
git clone <repo-url> council-cli
cd council-cli
npm install
npm run build
npm link   # makes `council` available globally
```

**Requirements:**
- Node.js >= 18
- Git
- At least one AI coding agent CLI installed (see [Supported Agents](#supported-agents))

Verify your setup:

```bash
council doctor
```

Generate a config file:

```bash
council init
```

---

## Quick Start

```bash
# Full AI company pipeline
council company "Add user avatar upload with S3 storage"

# Dry run — see the plan without executing
council company --dry-run "Add dark mode"

# Run in background — returns immediately
council bg "Refactor auth to use JWT tokens"

# Use a template
council run bugfix "Login form submits twice on slow networks"

# Compare agents on one task
council "Fix the auth bug"

# CTO orchestration mode
council orchestrate "Build a REST API for user management"

# Daily standup
council standup

# Agent performance leaderboard
council analytics
```

---

## All Commands

### Core

| Command | Description |
|---------|-------------|
| `council company [feature]` | AI company pipeline: PM → Architect → Developer → EM → QA → CEO |
| `council compare [task]` | Run same task on 2+ agents, compare diffs, pick winner |
| `council chat` | Interactive REPL — every message goes to all agents |
| `council orchestrate [desc]` | CTO mode: plan, delegate, review, iterate, merge |
| `council workspace [feature]` | Multi-repo: run pipeline across multiple repositories |

### Shortcuts

| Command | Description |
|---------|-------------|
| `council bg "feature"` | Run pipeline in background (detached process) |
| `council run <template> "desc"` | Run from a template (bugfix, refactor, test, security, ...) |
| `council run list` | List all available templates |

### Pipeline Operations

| Command | Description |
|---------|-------------|
| `council company --dry-run` | Show plan and cost estimate without executing |
| `council company --resume=latest` | Resume an interrupted pipeline |
| `council standup` | Generate standup report from git history |
| `council board` | Kanban board of all pipeline runs |
| `council retro [run-id]` | Post-mortem analysis with timeline and bottleneck detection |
| `council history [filter]` | Search and manage past pipeline runs |
| `council analytics` | Agent performance leaderboard and insights |
| `council export [run-id]` | Export pipeline run as shareable HTML report |

### Infrastructure

| Command | Description |
|---------|-------------|
| `council bot` | Start GitHub webhook bot server |
| `council bot --setup` | Show bot setup guide |
| `council init` | Setup wizard — auto-detects project, generates `.council.yml` |
| `council doctor` | Health check — verify CLIs, API keys, config |
| `council apply <agent-id>` | Apply a worktree's changes to main tree |
| `council cleanup` | Remove all council worktrees and branches |

### Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `--agents=cli:model,cli:model` | company, compare, chat, bg | Select agents (supports `=` and space syntax) |
| `--roles=pm,architect,developer` | company, bg | Select which pipeline roles to run |
| `--dry-run` | company | Show plan and estimate without executing |
| `--resume=<run-id\|latest>` | company | Resume an interrupted pipeline |
| `--since=<period>` | standup | Time period (default: "yesterday") |
| `--port=<number>` | bot | Webhook server port (default: 3000) |
| `--output=<path>` | export | Output file path for HTML report |

### Reasoning Models

Append `:reasoning` to enable extended thinking (Claude Opus):

```bash
# Both syntax forms work:
council --agents=claude:claude-opus-4-6:reasoning,claude:claude-sonnet-4-6 "Complex refactor"
council --agents "claude:claude-opus-4-6:reasoning,claude:claude-sonnet-4-6" "Complex refactor"
```

When `--agents` is specified, ALL listed models are used. The flag always overrides `.council.yml` config and auto-discovery.

---

## Company Pipeline

The `company` command processes a feature request through 6 specialized AI roles:

```
Feature Request
     │
     ▼
┌─────────────────┐
│  Product Manager │  Writes spec: user stories, acceptance criteria, edge cases
└────────┬────────┘
         ▼
┌─────────────────┐
│ Systems Architect│  Technical design: file changes, data model, API contracts
└────────┬────────┘
         ▼
┌─────────────────┐
│ Senior Developer │  Implements code — runs 2+ agents in COMPARE mode
└────────┬────────┘
         ▼
┌─────────────────┐
│  Eng. Manager   │  Progress check, risk assessment, quality gate
└────────┬────────┘
         ▼
┌─────────────────┐
│   QA Engineer   │  Verifies acceptance criteria, writes missing tests
└────────┬────────┘
         ▼
┌─────────────────┐
│      CEO        │  Final review — APPROVE or REJECT
└─────────────────┘
         │
    ┌────┴────┐
    │ approve │──→ Apply code changes
    │ reject  │──→ Send back (max 2 retries)
    └─────────┘
```

### Pipeline Persistence

Checkpointed after each role. Resume interrupted runs:

```bash
council company --resume=latest
```

### Dry Run

Preview the pipeline plan with per-role agent assignments before executing:

```bash
council company --agents "claude:claude-opus-4-6,codex:gpt-5.4" --dry-run "Add dark mode"
```

```
  Dry Run Preview:

  ~2m  Product Manager
       agent: claude-opus-4-6  →  spec
  ~3m  Systems Architect
       agent: claude-opus-4-6  →  design
  ~5m  Senior Developer  compare
       agent: claude-opus-4-6, gpt-5.4  →  code
  ~2m  Engineering Manager
       agent: claude-opus-4-6  →  em_report
  ~4m  QA Engineer
       agent: claude-opus-4-6  →  qa_report
  ~1m  CEO
       agent: claude-opus-4-6  →  decision
```

### Background Execution

Run without blocking your terminal:

```bash
council bg "Add dark mode"
# Returns: Run ID, PID, log file path
# Track: council board
# Logs:  tail -f .council-artifacts/<run-id>/pipeline.log
```

---

## GitHub Bot

Turn council into a GitHub bot that processes issues automatically:

```
@council-bot /company Add dark mode with system preference detection
```

The bot:
1. Reacts to acknowledge receipt
2. Posts a progress table (updated in real-time)
3. Runs the full pipeline
4. Creates a PR with the implementation
5. Posts artifacts (spec, design, QA report) as PR comments

### Bot Commands

| Command | Description |
|---------|-------------|
| `@council-bot /company <feature>` | Run full pipeline, create PR |
| `@council-bot /status` | Show pipeline progress |
| `@council-bot /retry` | Retry last failed pipeline |
| `@council-bot /cancel` | Cancel running pipeline |
| `@council-bot /help` | Show all commands |

### Setup

```bash
# Set credentials
export COUNCIL_GITHUB_TOKEN="ghp_..."
export COUNCIL_WEBHOOK_SECRET="$(openssl rand -hex 20)"

# Start the server
council bot --port 3000

# Full setup guide
council bot --setup
```

### Webhook Security

- HMAC-SHA256 signature verification on every request (constant-time comparison)
- 10 MB payload size limit
- Duplicate run prevention per issue
- Token never appears in command lines or process listings

---

## Multi-Repo Workspaces

Orchestrate a feature across multiple repositories:

```yaml
# council-workspace.yml
coordinator: claude:claude-opus-4-6:reasoning
repos:
  - name: frontend
    path: ../webapp
    roles: pm,architect,developer,qa
  - name: backend
    path: ../api-server
    roles: architect,developer,qa
  - name: infra
    path: ../terraform
    roles: architect,developer
```

```bash
council workspace "Add SSO login with SAML support"
```

The PM writes a shared spec once. Each repo gets its own Architect → Developer → QA pipeline. Results are summarized across all repos.

---

## Templates

Built-in templates for common tasks:

| Template | Description | Roles |
|----------|-------------|-------|
| `bugfix` | Fix a bug with full QA verification | architect, developer, qa, ceo |
| `refactor` | Refactor code with safety checks | architect, developer, qa, ceo |
| `feature` | Full feature with spec and design | all |
| `test` | Add test coverage | developer, qa, ceo |
| `docs` | Generate documentation | pm, developer |
| `security` | Security audit with fix implementation | architect, developer, qa, ceo |
| `perf` | Performance optimization | architect, developer, qa, ceo |

```bash
council run bugfix "Login fails on Safari when cookies are disabled"
council run security "Review the authentication module"
council run list   # show all templates
```

Add custom templates in `.council.yml`:

```yaml
templates:
  hotfix: "Emergency fix: {description}. Minimal changes, no refactoring."
```

---

## Roles

### Default Roles

| Role | Name | Mode | Consumes | Produces |
|------|------|------|----------|----------|
| Product Manager | `pm` | single | (feature request) | `spec` |
| Systems Architect | `architect` | single | spec | `design` |
| Senior Developer | `developer` | compare | spec, design | `code` |
| Engineering Manager | `em` | single | spec, design, code | `em_report` |
| QA Engineer | `qa` | single | spec, code, em_report | `qa_report` |
| CEO | `ceo` | single | all artifacts | `decision` |

### Custom Roles

```yaml
company:
  customRoles:
    security:
      title: Security Auditor
      prompt: Review for OWASP Top 10 vulnerabilities.
      agent: claude:claude-opus-4-6:reasoning
      after: qa
```

---

## Configuration

Create `.council.yml` in your repo root (`council init` generates one):

```yaml
agents:
  - claude:claude-sonnet-4-6
  - codex:o3-mini
  - gemini-cli:gemini-2.5-flash

evaluate:
  - npm test
  - npx tsc --noEmit

evaluateTimeout: 120
maxIterations: 30

company:
  maxRetries: 2
  roles:
    developer:
        mode: compare
        agent: claude:claude-sonnet-4-6,codex:o3-mini
    ceo:
        agent: claude:claude-opus-4-6:reasoning
    em:
        enabled: false
```

---

## Supported Agents

### CLI-Based (Preferred)

| Agent | CLI | Install | Auth |
|-------|-----|---------|------|
| Claude Code | `claude` | `npm i -g @anthropic-ai/claude-code` | `ANTHROPIC_API_KEY` or `claude auth` |
| OpenAI Codex | `codex` | `npm i -g @openai/codex` | `OPENAI_API_KEY` or codex auth |
| Gemini CLI | `gemini` | Google's CLI tool | `GOOGLE_API_KEY` or gemini auth |
| iloom | `il` | `pip install iloom` | `il auth` |

### API-Based (Fallback)

| Runner | Models | Auth |
|--------|--------|------|
| `anthropic` | Claude models | `ANTHROPIC_API_KEY` |
| `openai` | GPT-4o, o3, o4 series | `OPENAI_API_KEY` |
| `gemini` | Gemini models | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |

Agent spec format: `cli:model` or `cli:model:reasoning`

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API / Claude CLI | If using Claude |
| `OPENAI_API_KEY` | OpenAI API / Codex CLI | If using Codex/GPT |
| `GOOGLE_API_KEY` | Google Generative AI | If using Gemini |
| `GEMINI_API_KEY` | Alternative Google key | If using Gemini |
| `COUNCIL_GITHUB_TOKEN` | GitHub PAT for bot mode | If using bot |
| `COUNCIL_WEBHOOK_SECRET` | Webhook HMAC secret | If using bot |
| `COUNCIL_BOT_USERNAME` | Bot mention name | Optional (default: council-bot) |
| `COUNCIL_SLACK_WEBHOOK` | Slack webhook URL | Optional (enables notifications) |

---

## Production Guardrails

### Isolation

- Every agent runs in its own **git worktree** — complete filesystem isolation
- Each worktree gets a unique branch with collision-resistant names (`crypto.randomBytes`)
- Changes are only applied after explicit confirmation

### Timeouts

| What | Default |
|------|---------|
| Agent execution | 15 minutes |
| AI API HTTP requests | 120 seconds |
| GitHub API requests | 30 seconds |
| Model discovery | 15 seconds |
| Git operations | 30 seconds |
| Evaluation commands | 120 seconds (configurable) |
| SIGTERM → SIGKILL | 2 seconds |

### CEO Safety Gate

- CEO must respond with explicit `"approve"` or `"reject"` JSON
- **Unparseable output defaults to REJECT** for safety
- Maximum retry count is bounded (default: 2)

### Process Management

- Per-agent process tracking with `killAgent(agentId)` support
- All before-exit hooks run on shutdown (Set-based, not overwritten)
- Graceful shutdown: hooks → SIGTERM → 2s → SIGKILL → worktree cleanup
- Timeouts kill the actual child process (no zombie processes)

### Slack Notifications

Set `COUNCIL_SLACK_WEBHOOK` to get notified:
- Pipeline start (with roles)
- Role completions
- Final result with PR link
- Errors

Notifications never crash the pipeline — failures are silently ignored.

---

## Security

### Shell Injection Prevention

- **Zero `execSync` with user input.** All git operations use `spawnSync` with array arguments — no shell interpretation.
- Branch names, commit messages, and file paths are never interpolated into shell strings.
- Temp files use `crypto.randomBytes` names with `mode: 0o600` permissions.

### Credential Protection

- API keys are never logged or included in error messages.
- Git push uses `git config credential.helper` — token never appears in command line or `ps` output.
- Error messages are sanitized to redact keys and sensitive response data.
- Webhook signature verification uses `crypto.timingSafeEqual` (constant-time comparison).

### Input Validation

- Regex patterns from API agents are validated — nested quantifiers (ReDoS) are rejected.
- File search has a depth limit of 10 levels (no stack overflow from deep directories).
- Webhook payloads are limited to 10 MB (prevents OOM attacks).
- Path traversal is checked on all file operations (`startsWith` validation).
- Untracked file names are validated against `..` traversal.

### What Council Executes

1. **AI agent CLIs** (claude, codex, gemini) in isolated worktrees
2. **Evaluation commands** from `.council.yml` (run in worktrees, not main tree)
3. **Git operations** for worktree/branch management

### What Council Does NOT Do

- Does not push code (except in bot mode with explicit token)
- Does not install packages
- Does not modify files outside worktrees (until you approve the diff)
- Does not send data anywhere except AI APIs and optional Slack

### Recommended `.gitignore`

```
.council-worktrees/
.council-artifacts/
.env
.env.local
```

---

## Architecture

```
council-cli/
├── src/
│   ├── index.ts                  CLI entry + 20 command routing
│   ├── pipeline.ts               Pipeline runner + CEO gate + timeouts
│   ├── roles.ts                  6 default roles + custom role builder
│   ├── artifacts.ts              Artifact persistence + pipeline state
│   ├── agents.ts                 Agent runners (CLI spawn + API)
│   ├── models.ts                 Auto-discovery + caching
│   ├── streaming.ts              Real-time streaming from CLI agents
│   ├── config.ts                 .council.yml parser (3-level YAML)
│   ├── process.ts                Per-agent process tracking + signals
│   ├── worktree.ts               Git worktree isolation (spawnSync, no shell)
│   ├── notify.ts                 Slack webhook notifications
│   ├── analytics.ts              Agent performance aggregation
│   ├── templates.ts              7 built-in + custom task templates
│   ├── workspace.ts              Multi-repo workspace config
│   ├── eval.ts                   Auto-detect + run evaluation commands
│   ├── parse-agent-spec.ts       Shared agent spec parser
│   ├── commands/                 16 command implementations
│   ├── bot/                      GitHub webhook bot (5 modules)
│   ├── orchestrator/             CTO planner + types
│   ├── api/                      HTTP clients + agentic tool loop
│   └── ui/                       Terminal rendering (6 modules)
├── src/__tests__/                267 tests across 27 files
├── .gitignore
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

### Key Design Decisions

- **Git worktrees** for isolation — near-zero setup, real filesystem isolation
- **`spawnSync` with arrays** for all git operations — no shell injection possible
- **Zero runtime dependencies** — all HTTP via native `https`, all crypto via native `crypto`
- **Lazy-load everything** — 17 dynamic imports, only loaded on demand
- **Pipeline checkpoints** — resume from any point after interruption
- **CEO defaults to reject** — safer than auto-approving unclear output
- **Model discovery caching** — 1-hour TTL, avoids repeated API calls

---

## FAQ

**Can I use this as a Claude Code custom command?**
Yes. Council works in non-TTY mode. It auto-selects diverse agents across providers.

**What if an agent is slow?**
15-minute timeout per agent. The process is killed (not just the promise rejected). Dashboard flags agents as stuck after 2 min.

**Does the CEO always approve?**
No. Unparseable output defaults to **reject**. The CEO must explicitly approve in JSON format.

**Can I run multiple pipelines at once?**
Yes. Use `council bg` to run in background. Each pipeline gets its own worktrees. Track with `council board`.

**Can I use this across multiple repos?**
Yes. Create a `council-workspace.yml` and use `council workspace "feature"`.

**What happens if the pipeline crashes?**
State is checkpointed after each role. Resume with `council company --resume=latest`.

**How do I know which agent is best?**
Run `council analytics` to see the leaderboard — approval rate, avg time, retries per agent.

**Can I add my own roles?**
Yes. Define custom roles in `.council.yml` with a title, prompt, and position in the pipeline.

**Can I get Slack notifications?**
Yes. Set `COUNCIL_SLACK_WEBHOOK` and notifications are sent automatically.

**Is it safe for production?**
Yes. All git operations use `spawnSync` arrays (no shell injection), credentials are never logged, temp files are `0o600` with random names, and webhooks are HMAC-verified.

---

## Scripts

```bash
npm run build       # Compile TypeScript (excludes tests)
npm test            # Run all 267 tests
npm run test:watch  # Watch mode
npm run dev         # Run from source
npm start           # Run compiled
npm run size        # Show dist + node_modules size
```

---

## License

MIT
