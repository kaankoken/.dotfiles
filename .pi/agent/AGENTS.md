# Pi agent (dotfiles)

Upstream **Pi** host (`pi` / [pi.dev](https://pi.dev)).

## Host

- **Binary:** `@earendil-works/pi-coding-agent` (`pi` — 0.84.x). No Node on this machine; nushell runs it as `bun ~/.bun/bin/pi`.
- **SoT:** `~/.dotfiles/.pi/agent/` — a single tree, no second copy.
- **Live:** `~/.pi/agent/` is the same directory: `~/.pi` is a stow tree-fold symlink to `~/.dotfiles/.pi`.
- **Apply:** edits are live immediately. Clean-machine setup is `stow .` + two symlinks — see [README](README.md#clean-machine-order).
- **Runtime state** (gitignored, never edit as config): `auth.json`, `sessions/`, `npm/`, `git/`, `mcp-cache.json`, `bin/{fd,rg}`.

## Non-negotiables

1. Do not symlink other agent trees into `~/.pi`.
2. Load flow assets only from `~/.pi/agent/{skills,agents,schemas,templates,policy}`.
3. Edits: **hashline-edit-pro** only (`read`/`replace`; built-in `edit` disabled).
4. Long jobs / inspect scouts: **pi-background-tasks**; multi-step parallel: **dynamic-workflows** + **bd**.
5. Code graphs: **tokensave** = live symbol graph (callers/impact/edits); **graphify** = architecture/corpus graph (path-load). Never codebase-memory.
6. Prefer **`/harness`** for multi-step build/fix work.
7. **Methodology = Bigpowers** (ADR-0001). Never path-load `~/.agents/skills/superpowers/**`.
8. **bd is task SoT** (ADR-0002). Optional `specs/` only via `skills/adapters/bp-bd-bridge`.

## Methodology

| Piece | Location |
|-------|----------|
| Bigpowers skills | `~/.pi/agent/npm/node_modules/bigpowers/skills/<name>/SKILL.md` (`npm:bigpowers@2.87.5`) |
| Owned adapters | `~/.pi/agent/skills/adapters/{bp-bd-bridge,bp-plan-to-bd,bp-review-to-json,dispatch-via-dw}` |
| Grep gate | `~/.pi/agent/scripts/assert-no-superpowers.sh` |
| Contract tests | `~/.pi/agent/tests/` (`cd ~/.pi/agent && bun test tests`) |

ADR-0001 (Bigpowers) and ADR-0002 (bd) are referenced by name in the
non-negotiables above. The ADR and design-plan documents are not in this repo.

## Packages

| Package | Role |
|---------|------|
| `pi-hashline-edit-pro` | `read`/`replace`/`undo_last_replace` |
| `pi-background-tasks` | `/bg`, `bg_run`, `bg_delegate`, fusion |
| `@quintinshaw/pi-dynamic-workflows` | parallel agents / workflows; exact `/code-review` |
| `vendor/smart-approve` | high-risk approval gate |
| `npm:bigpowers@2.87.5` | methodology skills (replaces Superpowers) |
| `extensions/rtk.ts` | RTK bash rewrite |
| `extensions/goal-harness.ts` | exact `/harness` `/design` `/architect` `/architect-layered` `/init` |
| `extensions/pr-reviewer.ts` | exact `/pr-review` local freeze review (Grok+Sol+Opus+Terra) |
| `npm:pi-cursor-sdk` | Cursor bridge (`/cursor-*`); unpinned so it tracks the Cursor host |

Docs: [hashline](https://pi.dev/packages/pi-hashline-edit-pro?name=read) · [background-tasks](https://pi.dev/packages/pi-background-tasks?name=read) · [bigpowers]

Model tiers: `~/.pi/workflows/model-tiers.json`.

## Agents (dynamic-workflows registry)

Location: `~/.pi/agent/agents/*.md` — loaded by **pi-dynamic-workflows** as `agentType`.

Harness path-loads the same files for soft `/harness` / `/design`. Exact `/code-review` is DW-owned.

Policy (not an agent): `~/.pi/agent/policy/REVIEW-POLICY.md`

PR review roles on Pi (local freeze):

| agentType | model pin | role |
|-----------|-----------|------|
| `pr-grok-reviewer` | `xai/grok-4.6:xhigh` | initial + rebuttal |
| `pr-sol-reviewer` | `openai-codex/gpt-5.6-sol:xhigh` | initial + rebuttal |
| `pr-opus-reviewer` | `cursor/claude-opus-5@1m:max` | initial + rebuttal |
| `pr-terra-judge` | `cursor/claude-opus-5@1m:max` | sole adjudication |

Agent `route:` = chain in `workflows/model-routes.json`. Pin = first hop. Failover = `providerFailover` + remaining hops. DW binds only `name`/`model`/`tools`/`isolation`/body — `route` is our chain key, not a DW field.

## Commands

| Command | Behavior |
|---------|----------|
| **`/harness [goal]`** | Main process. Empty args → 8 default quality lines. Bigpowers + bd + adapters. |
| `/design <goal>` | PDR/Arc42/ADR only (`elaborate-spec` + design-flow) |
| `/architect` / `/architect-layered` | In-session architecture consult |
| `/init` | AGENTS/bd scaffold only |
| `/code-review` | Local/diff multi-angle — **dynamic-workflows** exact command (not goal-harness) |
| `/pr-review` | Local freeze review (Grok+Sol+Opus+Terra); single publish; immutable freeze |
| `/workflows …` | dynamic-workflows |
| `/bg` `/jobs` `/logs` `/fusion` | background-tasks |

Every command above is owned by exactly one extension. There is no `prompts/`
directory: pi registers prompt templates *alongside* extension commands rather
than as a fallback, so a same-named template appears as a duplicate entry.

## Local skills

`intent-router`, `gh-stack`, `goal-harness`, `design-flow`, `architect`, `stack-{rust,ios,android,gcp}`, `adapters/*` under `~/.pi/agent/skills/`.

All except `intent-router` and `gh-stack` are excluded from the cold catalog by the `skills` denylist in `settings.json`; path-load them on demand.

Path-load **Bigpowers** from the npm package path above; **ponytail** from `~/.agents/skills/…`. Never Superpowers.

## MCP

Cold keep-alive MCP: tokensave, headroom, context-mode (`lifecycle: keep-alive` in `mcp.json`). context7 disabled until `/mcp enable context7`. Pi extension package: `npm:context-mode` (hooks). Headroom is MCP-only here — the proxy-wrap launcher was removed, so providers are not routed through `:8787`.

## Auth

`~/.pi/agent/auth.json`. **`/login`** if needed.
