# OMP agent (dotfiles)

Shared cross-agent policy lives in **`../agent-stack/`** (`AGENTS.shared.md`,
`RTK.md`) and is linked into this agent dir by `link.sh`. Do not duplicate it
here.

## OMP-only deltas

- **Binary:** installed by Nix activation (`install-omp.sh`) only — not configured here.
- **Launch:** prefer `headroom wrap omp` (nushell `omp` alias wraps it; `omp-raw` skips proxy).
- **Subagent model label:** `task.showResolvedModelBadge: true`.
- **Harness model routes** (`extensions/goal-harness/model-router.ts`): research = Grok high (deep-research)→Sol medium; milestone = Terra xhigh→Fable→Sol→Opus; PR = Grok→Terra xhigh→Sonnet; implement = Grok→Composer→Sol→Sonnet; big gates = Sol ultra→Fable max→Opus max. Design: PDR/ADR = Opus→Terra→Sol→Grok; Arc42 = Grok→Composer.
- **Gate token budget:** Spec/Plan/BiteSize/Milestone ceilings **2**. Producer effort **max**, reviewer **high**.
- **Config:** `config.yml` → lean defaults (shake, no Autolearn, no built-in task list, memory off, hashline, **yolo** + **smart-approve**).
- **Link:** `./link.sh` → `~/.omp/agent` without touching `auth.json` / sessions / cache.

## Cold session

- **Skills cold catalog:** exactly `intent-router`, `beads` (`config.yml` `includeSkills`).
- **customDirectories:** Superpowers + agents + omp skills + pack roots for **resolve only** — not cold-catalogued.
- **MCP cold:** `tokensave`, `headroom`, `context-mode` enabled. `context7` opt-in via `/mcp enable` or `/mcp-stack`.
- **Shell toolkit:** rtk + modern CLIs (see `RTK.md`). RTK is not an MCP server.
- **Not cold-loaded:** Superpowers workflow skills, `goal-harness`, `design-flow`, `ponytail`(+review/audit), `stack-*` routers, domain pack globs. Flows load them live when invoked.

## Freeform intent routing

When the user message has **no** leading slash and no harness/design/PR controller
is already active:

1. Follow `skill://intent-router` (and optional agent `intent-router`).
2. Classify to one route id: `harness` | `design` | `init` | `review_pr` |
   `code_review` | `stack` | `mcp` | `local` | `ambiguous`.
3. Dispatch **once** using the same start semantics as the slash/extension
   handlers (`handleHarnessCommand`/`buildStartMessage`, `buildDesignStartMessage`,
   `buildReviewPrControllerMessage`, `/init`, `/code-review`, `/stack-*`, `/mcp-stack`).
4. Prefer conservative `local` when unsure; `ambiguous` → one clarifying question.

Slash commands bypass the router and load their flow directly.

### Double-start

At most one of `{goal-harness-start, design-flow-start, PR REVIEW CONTROLLER}`
per thread. Mid-flow freeform is steering, not a new route.

## Flows (on-demand loaders)

| Entry | Loads (live) |
|-------|----------------|
| `/harness` | extension-registered only — `using-superpowers` → `goal-harness` → phase roles via `REQUIRED_SKILLS_BY_ROLE` |
| `/design` | `using-superpowers`, `design-flow`, `brainstorming` — PDR/Arc42 in bd/session; ADRs under `docs/adr/` only; never auto-starts `/harness` |
| `/init` | `runProjectInit` / `project-init` (no Superpowers required) |
| `/pr-reviewer` | PR dual-review controller (extension; agents `pr-*`) |
| `/code-review` | `code-reviewer` + `requesting-code-review`, `ponytail-review`(+audit) — not PR controller |
| `/stack-rust` `/stack-ios` `/stack-android` | thin routers + pack entry paths |
| `/mcp-stack` | primarily enable `context7` (headroom/context-mode already cold) |

Do **not** shadow native `/goal` or `/guided-goal`. Do **not** add `commands/harness.md`.

See `compatibility.json` for the pinned runtime contract and `README.md` for link safety rules.
