# OMP agent (dotfiles)

Shared cross-agent policy lives in **`../agent-stack/`** (`AGENTS.shared.md`,
`RTK.md`) and is linked into this agent dir by `link.sh`. Do not duplicate it
here.

## OMP-only deltas

- **Binary:** installed by Nix activation (`install-omp.sh`) only — not configured here.
- **Launch:** prefer `headroom wrap omp` (nushell `omp` alias wraps it; `omp-raw` skips proxy).
- **Subagent model label:** `task.showResolvedModelBadge: true`.
- **Harness model routes** (`extensions/goal-harness/model-router.ts`): **until 2026-08-08** OpenAI Codex (Sol+Terra) last-resort. Big gates = Fable max→Opus max→Sol ultra; research = Grok high→Fable medium→Sol medium; implement = Grok→Composer→Sonnet→Sol; milestone = Fable→Opus→Terra→Sol; PR = Grok→Sonnet→Terra; init = Fable→Sonnet→Sol. Design: PDR/ADR = Opus→Grok→Terra/Sol; Arc42 = Grok→Composer. After that date prior primary positions restore.
- **Hard `/harness`:** when `api.pi.createAgentSession` is available, extension runs `runHardHarness` → `runGoalHarnessDetailed` via `createWorkflowzFromPi` with **model-router** models (never parent session model). Soft start-message path only if `pi` missing or `softOnly`.
- **Agent model pins:** every `agents/*.md` role MUST set frontmatter `model: provider/id:effort` (big gates Fable/Opus, implement/scouts Grok, design PDR/ADR Opus, Arc42 Grok/Composer). Soft `task` spawns inherit these — never leave model unset (inherits parent session).
- **Gate token budget:** Spec/Plan/BiteSize/Milestone ceilings **2**. Producer effort **max**, reviewer **high**.
- **Config:** `config.yml` → lean defaults (shake, no Autolearn, no built-in task list, memory off, hashline, **yolo** + **smart-approve**).
- **Link:** `./link.sh` → `~/.omp/agent` without touching `auth.json` / sessions / cache.

## Cold session

- **Skills cold catalog:** exactly `intent-router`, `beads` (`config.yml` `includeSkills`). All other skills (Superpowers, goal-harness, stacks, ponytail) load via **absolute path** `read` — not `skill://` (OMP only resolves cold-listed names).
- **customDirectories:** Superpowers + agents + omp skills + pack roots (rust/axiom/google-skills cloud) for **resolve only** — not cold-catalogued.
- **MCP cold:** `tokensave`, `headroom`, `context-mode` enabled. `context7` opt-in via `/mcp enable context7`.
- **Shell toolkit:** rtk + modern CLIs (see `RTK.md`). RTK is not an MCP server.
- **Not cold-loaded:** Superpowers workflow skills, `goal-harness`, `design-flow`, `architect`, `ponytail`(+review/audit), `stack-*` routers, domain pack globs. Flows load them live when invoked.

## Freeform intent routing

When the user message has **no** leading slash and no harness/design/PR controller
is already active:

1. Follow `skill://intent-router` (and optional agent `intent-router`).
2. Classify to one route id: `harness` | `design` | `init` | `review_pr` |
   `code_review` | `stack` | `mcp` | `local` | `ambiguous`.
3. Dispatch **once** using the same start semantics as the slash/extension
   handlers (`handleHarnessCommand`/`buildStartMessage`, `buildDesignStartMessage`,
   `buildReviewPrControllerMessage`, `/init`, `/code-review`; stack → `skill://stack-*`).
4. Prefer conservative `local` when unsure; `ambiguous` → one clarifying question.

Slash commands bypass the router and load their flow directly.

### Double-start

At most one of `{goal-harness-start, design-flow-start, PR REVIEW CONTROLLER}`
per thread. Mid-flow freeform is steering, not a new route.

## Flows (on-demand loaders)

| Entry | Loads (live) |
|-------|----------------|
| `/harness` | extension-registered only — `using-superpowers` → `goal-harness` → phase roles via `REQUIRED_SKILLS_BY_ROLE` (hard path: `runHardHarness` when `pi` available) |
| `/design` | empty shell → `using-superpowers`, `design-flow`, `brainstorming` — ADRs under `docs/adr/` only; never auto-starts `/harness` |
| `/architect` | empty shell → `using-superpowers`, `architect`, `brainstorming` (by path) — in-session consult; ADRs optional under `docs/adr/`; never auto-starts `/design` or `/harness` |
| `/init` | empty shell → `runProjectInit` / `project-init` |
| `/pr-reviewer` | PR dual-review controller (extension; agents `pr-*`) |
| `/code-review` | empty shell → `code-reviewer` + `requesting-code-review`, `ponytail-review`(+audit) |
| stack packs | **no slash** — path `~/.omp/agent/skills/stack-*/SKILL.md` on demand (or pack overlay session) |
| context7 | `/mcp enable context7` (not a custom command file) |

Do **not** shadow native `/goal` or `/guided-goal`. Do **not** add `commands/harness.md`.

See `compatibility.json` for the pinned runtime contract and `README.md` for link safety rules.
