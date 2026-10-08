# Pi agent (dotfiles)

Upstream **Pi** host (`pi` / [pi.dev](https://pi.dev)).

## Host

- **Binary:** npm-global `@earendil-works/pi-coding-agent` (Node runtime); check `pi --version`. Bun remains for tooling/tests, not Pi launch.
- **SoT:** `~/.dotfiles/.pi/agent/`. `~/.pi` is a stow tree-fold symlink to `~/.dotfiles/.pi`.
- **Apply:** config edits are live on disk. Use `/reload` for extensions/context; restart for package/MCP changes. See [README](README.md#clean-machine-order).
- **Runtime state:** never edit `auth.json`, `sessions/`, `npm/`, `git/`, model caches, or `mcp-cache.json` as configuration.

## Non-negotiables

1. Do not symlink other agent trees into `~/.pi`.
2. Load owned flow assets only from `~/.pi/agent/{skills,agents,schemas,templates,policy}`; installed methodology skills from the package paths below.
3. Edits: **hashline-edit-pro** only (`read`/`replace`/`insert`/`undo_last_change`; built-in `edit` disabled).
4. Shell checks: **bash**. Multi-step delegation: **dynamic-workflows** + **bd**, only with user opt-in (including `/harness`). Do not call unavailable background-task tools.
5. Code graphs: **tokensave** = live symbols; **graphify** = architecture/corpus. Verify scope/freshness; use targeted source inspection when graph data is missing or irrelevant. Never codebase-memory.
6. Prefer **`/harness`** for multi-step build/fix work.
7. **Methodology = Bigpowers** (ADR-0001). Never path-load `~/.agents/skills/superpowers/**`.
8. **bd is task SoT** (ADR-0002). Optional `specs/` only via `skills/adapters/bp-bd-bridge`.
9. **Worktrees stay inside the repo.** Create all new Git worktrees under `<project-root>/.worktrees/<name>/`, using the primary checkout root even when working from a linked worktree. Never use sibling directories, `/tmp`, or global worktree folders. Ensure `.worktrees/` is Git-ignored before creation. Apply this rule to delegated agents and workflows too; do not use tooling that creates worktrees elsewhere. Do not relocate existing worktrees unless explicitly requested.

## Methodology and checks

| Piece | Location |
|-------|----------|
| Bigpowers skills | `~/.pi/agent/npm/node_modules/bigpowers/skills/<name>/SKILL.md` |
| Owned adapters | `~/.pi/agent/skills/adapters/{bp-bd-bridge,bp-plan-to-bd,bp-review-to-json,dispatch-via-dw}` |
| Methodology gate | `bash ~/.pi/agent/scripts/assert-no-superpowers.sh` |
| Contract tests | `cd ~/.pi/agent && bun test ./tests/*.test.ts` |

`bunfig.toml` confines default discovery to `tests/`. Never run vendored package tests against the live HOME: some test fixtures change workflow settings/model tiers. Use a disposable environment for upstream suites.

ADR-0001 and ADR-0002 are policy references; their original documents are not in this repo. Bigpowers is unpinned in `settings.json`; inspect its installed `package.json` rather than assuming a version.

## Packages

`settings.json` is the enabled package source of truth, not this summary.

| Package | Role |
|---------|------|
| `pi-hashline-edit-pro` | anchored read/edit tools |
| `/Users/legolas/Projects/pi-dynamic-workflows` | local branch `feat/upstream-hashline`; upstream 3.13.1 + Hashline subagents; build with `npm run build` |
| `npm:bigpowers` | methodology; cold skills/prompts disabled |
| `npm:context-mode` | indexed context tools and hooks |
| Pi built-in MCP + codemode | deferred server tools; `mcp.json` is SoT |
| `npm:pi-cursor-sdk` | Cursor bridge; unpinned |
| `npm:pi-goal-x` | sole `/goal` owner; old goal data left untouched |
| `npm:pi-background-tasks` | managed parent jobs; opted-in process tools for workflow children |
| `extensions/rtk.ts` | RTK/bash rewrites |
| `extensions/goal-harness.ts` | `/harness`, `/design`, `/architect`, `/architect-layered`, `/init` |
| `extensions/pr-reviewer.ts` | local freeze PR review |
| `extensions/typesafe.ts` | TypeSafe Jev `typesafe_judge` + `/typesafe` key |

**Enabled:** `pi-background-tasks` for parent shell jobs and explicit delegation/Fusion. Workflow implementer/verify roles get process tools only; recursive delegate/Fusion tools are denied. **Not enabled:** `smart-approve`; do not promise an approval gate. Worktrees and tool allowlists are not security sandboxes. Ask before destructive operations or external publishing.

## Agents and routing

`~/.pi/agent/agents/*.md` are loaded by dynamic-workflows as `agentType`. Policy: `~/.pi/agent/policy/REVIEW-POLICY.md`.

Default parent and flow controllers (`/harness`, `/design`, `/architect`, `/architect-layered`) prefer `openai-codex/gpt-6-astra:medium`. `research-orchestrator` uses the same pin. Shared `harness-research` chain keeps Grok → Terra availability/auth fallbacks, with warnings. Specialist role pins and tiers are unchanged.

| PR review agentType | Model | Role |
|---------------------|-------|------|
| `pr-grok-reviewer` | `xai/grok-4.7:xhigh` | initial + rebuttal |
| `pr-sol-reviewer` | `openai-codex/gpt-6.1-sol:xhigh` | initial + rebuttal |
| `pr-opus-reviewer` | `cursor/claude-opus-5@1m`, `thinking: max` | initial + rebuttal |
| `pr-terra-judge` | `cursor/claude-opus-5@1m`, `thinking: max` | sole adjudication |

Agent `route:` names a chain in `workflows/model-routes.json`; it is **not** a DW field. DW binds `name`, `model`, `thinking`, `tools`, `isolation`, and body. Callers must explicitly apply failover; a role file alone does not implement it.

Workflow settings SoT: `agent/workflows/settings.json`; `~/.pi/workflows/settings.json` links there. Concurrency defaults to 8. Parent workflows fan out scouts then synthesize; independent claimed bites may run in parallel with disjoint ownership. Dependent work and quality gates stay ordered.
Tiers: `~/.pi/workflows/model-tiers.json` → `../agent/workflows/model-tiers.json`. Tier labels are routing choices, not cost guarantees. Named role model pins override tiers; explicit workflow `model` overrides both.

## Commands

| Command | Behavior |
|---------|----------|
| `/harness [goal]` | FSM `research→spec→spec-confirm→plan→bitesize→plan-confirm→implement→verify→milestone→pr`. User `go` at spec/plan gates only. All 8 quality lines remain bound. Pins workflow `background:false`; bounded follow-ups. PR only when requested. |
| `/design <goal>` | PDR→Arc42→ADR→handoff; no implementation |
| `/architect <question>` / `/architect-layered <question>` | architecture consult; no automatic design/build |
| `/init` | AGENTS/bd scaffold only |
| `/code-review` | DW local/diff review |
| `/pr-review` | immutable local freeze, Grok/Sol/Opus review, Terra adjudication, single publish |
| `/workflows …` | workflow management |

One owner per command. No same-named prompt templates. `pi-goal-x` owns `/goal` and `/sisyphus`; the old `@narumitw/pi-goal` is disabled. `/harness` retains spec/plan gates and bd task ownership; it is not a second autonomous goal loop. Do not run both controllers for the same work.

## Skills and MCP

Local cold skills: `gh-stack`, `graphify`. Architect/design/harness/stack/adapters are excluded by `settings.json` and path-loaded. `intent-router` is an optional **agent**, not an installed skill. Use `/skill:name` only for names actually listed; `skill://` is not a filesystem path.

- Bigpowers: package path above.
- Ponytail: `~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/skills/<name>/SKILL.md`.
- Caveman: `npm:pi-caveman` extension, not a skill file.
- Native `agent/mcp.json`: Tokensave + Atlassian. Trusted dotfiles `.pi/mcp.json`: Parallel Search, Context7, GitHub, Chrome DevTools. All use codemode exposure. Context-mode remains an extension.
- Auth: `~/.pi/agent/auth.json`; use `/login`, never print credentials.
