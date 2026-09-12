---
name: goal-harness
description: >
  Pi structured behavioral process for /harness. Process engine: Bigpowers
  (path-load live SKILL.md under npm package root skills/), owned adapters,
  bd SoT, DW/hashline contracts. Roles under ~/.pi/agent/agents/. Does not
  shadow native /goal or /guided-goal. Not a second methodology orchestrator.
---

# Pi Goal harness

Behavioral process skill for the soft `/harness` controller. Phase order and
gates stay owned by `extensions/goal-harness.ts` + this file. **Do not** run
stock Bigpowers `orchestrate-project` as a competing harness.

## Loading skills (cold catalog)

Use the live skill catalog; it includes local `gh-stack` and `graphify` plus enabled package skills. `intent-router` is an agent, not an installed skill.

Path-load excluded flow/methodology skills with absolute `read` paths:

| Kind | Path pattern |
|------|--------------|
| Bigpowers | `~/.pi/agent/npm/node_modules/bigpowers/skills/<name>/SKILL.md` |
| Pi local / adapters | `~/.pi/agent/skills/<name>/SKILL.md` or `…/adapters/<name>/SKILL.md` |
| Ponytail | `~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/skills/<name>/SKILL.md` |
| Graphify | `~/.pi/agent/skills/graphify/SKILL.md` |

Caveman is the `npm:pi-caveman` extension, not a skill file.
Never path-load `~/.agents/skills/superpowers/**`. Use `/skill:name` only for catalog entries; never use `skill://` as a file path.
**graphify** (architecture/corpus graph) vs **tokensave** (live symbols):
prefer tokensave for callers/impact/edits; graphify for structure Q&A when
`graphify-out/` exists or after `/graphify .`. Path-load only.
**caveman** = terse prose; **ponytail** = minimal code. Use both. Not substitutes.

Named roles: `~/.pi/agent/agents/*.md` (parity-manifest). One harness chain only.

## Default goal (always — all 8 quality-gate lines)

These 8 lines **always** run as the bound quality-gate goal.

1. No errors, no warnings, no test failures.
2. No warning suppressions in production (test-only OK with reason).
3. Everything wired — no stubs, TODO/TBD/FIXME, unfinished work.
4. Mandated skills: using-bigpowers + stack packs + ponytail + caveman + tokensave + graphify + context-mode (path-load).
5. Latest dependencies — verify on the web (not training data alone).
6. Complete all bd-tracked spec/plan tasks (Bigpowers discipline; every bite has `verify:`).
7. Specs, plans, goals, updates tracked in **bd** (SoT). Optional `specs/` cockpit only via `bp-bd-bridge`.
8. Do not add unnecessary docstrings or comments; explanatory comments only where needed.

Empty `/harness`: they are the whole goal. With arguments: user text **plus** these 8 (never replace).

## Human gates

Only two user confirms. Reply **`go`** to advance (not `yes`).

1. After Spec reviewer `ok: true` (phase `spec-confirm`). Wait for `go`.

2. After Plan+BiteSize reviewer `ok: true` (phase `plan-confirm`). Wait for `go`.

Then implement→verify→milestone with **no** further asks until the bound goal has evidence (always includes all 8 quality lines).

Spec, plan, grill-me, and elaborate-spec still run against that full goal — do not skip the interview. Do not use `execute-plan`.

## Package contracts (required)

### Hashline (`pi-hashline-edit-pro`)
- Built-in `edit` is **disabled**. Use hashline `read` → `replace` or `insert`.
- `read`: 4-character `anchor│content` rows. `replace`: `remove_from`, `remove_to`, `replacement_lines`; `[]` deletes.
- `insert`: `anchor`, `direction`, `lines`. `undo_last_change`: `path`. Pass bare anchors and bare replacement lines.
- On drift, use returned fresh anchors or re-read.

### Shell checks and scouts

- Run checks with `bash`; retain exit codes and summarize large saved output with context-mode.
- Delegate scouts through dynamic-workflows with user opt-in. Do not assume a background-task package or approval gate is installed.
- Tools and worktrees use host permissions; neither is a security sandbox.

### Dynamic workflows (`git:github.com/kaankoken/pi-dynamic-workflows`)
- Parallel multi-step: `/harness` **is** `workflow` opt-in. Call the tool; `background: false` for implementer + gates. `/workflows run` / keyword still work.
- isolation optional: `agent(prompt, { agentType, isolation: 'worktree' })`. `isolation: false` opts out of a def.
  Default **keep** the worktree. Test runs may pass `keepWorktree: false` to delete.
- Model tiers: `~/.pi/workflows/model-tiers.json`.

### Bigpowers package

- Methodology skill bodies only. Path-load from root `…/bigpowers/skills/`.
- Package settings keep Bigpowers **path-load-only** (`skills:[]`, `prompts:[]`)
  so cold catalog does not flood with BP skills/prompts.
- Disk install stays for absolute path loads.

## Adapters (all four — load by path)

| Adapter | When | Contract |
|---------|------|----------|
| `adapters/bp-bd-bridge` | Init / resume / any BP skill wanting `specs/state.yaml` | **bd primary**; optional `specs/` + `specs/pi-bridge.yaml`; never dual unlinked trackers |
| `adapters/bp-plan-to-bd` | Plan + BiteSize after scope/slice/plan-work | bd issues with `verify: <cmd>` per bite |
| `adapters/bp-review-to-json` | Milestone + `/code-review` | Normalize audit/request-review → REVIEW-POLICY `{ok,feedback,blocking}`; default `quality:normal` |
| `adapters/dispatch-via-dw` | Parallel / delegate | BP `delegate-task`/`dispatch-agents` **policy**; execute via DW |

Load: `~/.pi/agent/skills/adapters/<name>/SKILL.md`.

## Phases

| # | Phase | Bigpowers (path-load) | Adapters / local | Producer | Reviewer | Max attempts |
|---|--------|------------------------|------------------|----------|----------|--------------|
| 0 | Init | `using-bigpowers` (once), `survey-context` (resume) | `bp-bd-bridge` | `project-init` (safe bd init only) | — | — |
| R | Research | `research-first`, optional `map-codebase` | tokensave remains graph | scouts / controller | — | — |
| 1 | Spec | `elaborate-spec`, optional `grill-me` | ponytail | `spec-writer` + scouts | `spec-reviewer` | 3 |
| 2 | Plan | `scope-work` → `slice-tasks` → `plan-work`, optional `assess-impact` | `bp-plan-to-bd` | `plan-writer` + scouts | `plan-reviewer` | 3 |
| 3 | BiteSize | `plan-work` (granularity) + `slice-tasks` as needed | `bp-plan-to-bd` | `bite-size-writer` | `bite-size-reviewer` | 2 |
| 4 | Implement | `kickoff-branch`, `develop-tdd`, `delegate-task`/`dispatch-agents` (policy) | `dispatch-via-dw`; hashline edits | `implementer` | optional light | — |
| 5 | Milestone | `audit-code`, `request-review` (guidance; Santa if `quality:strict`), `verify-work` | `bp-review-to-json`, ponytail-review(/audit) | multi `code-reviewer` | `milestone-organizer` | 3 |
| 6 | PR | `commit-message`, `release-branch` | — | `pr-opener` | — | — |


## After each bite

Implementer GREEN is a checkpoint, not done. `/harness` **is** `workflow` opt-in — call it; `background: false` for implementer + gates. Do not wait for the keyword.

Order: tests (`bash`, with exit-code evidence) → `verify-gate` → review JSON `{ok,feedback,blocking}` → bd `verify:` evidence → close bite → next bite.

Stop only when the bound goal has evidence (always: all 8 quality lines + all bd bites closed). Do not ask the user to continue implement/verify/milestone.

Runtime FSM (extension, not prompt-only): `/harness` `/design` `/architect` share one `activeRun`. Later producers/reviewers are **blocked** on `workflow` `tool_call` until that phase. Human confirm only at `spec-confirm` and `plan-confirm` (user `go` advances). Research advances only with `researchComplete: true` or `research-handoff`; design intake needs `pdr-writer` + `PDR:`. `/harness` pins `workflow` `background: false`. `turn_end` follow-up on skip/stop (max 3/phase); architect does **not** nag every turn.

**Max attempts = ceiling, not a quota (max 3).** First reviewer `ok: true` ends the gate.
Producer rewrite runs **only** when the reviewer returns `ok: false` (blocking items).
Do **not** spawn extra rounds “because budget remains.”

**Reviewer PASS bias:** all reviewers obey `policy/REVIEW-POLICY.md`. Default
`ok: true` / empty `blocking`. Fail only for wrong, impossible, unsafe,
unverifiable-core, or hard dependency gaps. Exhaustive evidence before product
work, thoroughness preferences, and process theater are **nits**, not fails.
Product/UI goals: product-first ordering is correct; defer heavy proof factories.

### Research / audit / verify (first-class)

- **Research:** before Spec when domain/deps unknown — `research-first` + optional
  `map-codebase` (tokensave for live symbols).
- **Audit:** before external review — `audit-code` then `bp-review-to-json`.
- **Verify:** Milestone PASS needs `verify-work` **and** fresh command evidence
  recorded in bd (task `verify:` lines from plan/bites).

Bug path: `investigate-bug` → `diagnose-root` → `fix-bug` / `develop-tdd`
before plan → implement when the bound goal is a bug.

Do **not** paste Bigpowers skill bodies here — only names + “read authoritative SKILL.md”.

## Role skill map (methodology)

| Role | requiredSkills (Bigpowers / local review) |
|------|-------------------------------------------|
| `spec-writer` | `elaborate-spec`, `respond-review` |
| `plan-writer` | `scope-work`, `slice-tasks`, `plan-work`, `respond-review` |
| `bite-size-writer` | `plan-work`, `slice-tasks`, `respond-review` |
| `implementer` | `develop-tdd`, `delegate-task`, `kickoff-branch` (+ `respond-review` on fix) |
| `milestone-organizer` | `audit-code`, `verify-work`, `request-review`, `delegate-task` |
| `code-reviewer` | `audit-code`, `request-review`, `ponytail-review`, `ponytail-audit` |
| `pr-opener` | `commit-message`, `release-branch` |
| reviewers (spec/plan/bite) | `request-review` |

Producers load `respond-review` **only** when applying `ok: false` blocking feedback.

## Model routes

SoT: `~/.pi/agent/workflows/model-routes.json`. No native anthropic (third-party extra-usage 400). Failover: openai-codex → cursor `@1m`; xai → xai-oauth → cursor. Fable/opus via cursor `@1m`.

| Role | Chain |
|------|--------|
| Writers | sol:xhigh → cursor opus@1m:xhigh → grok-4.6 → composer |
| Reviewers | cursor opus@1m:max → sol:max → sol:xhigh. **Max 3 rounds; first ok:true ends.** |
| Judges | cursor opus@1m:max → sol:xhigh |
| Milestone | terra:max → grok-4.6:xhigh |
| Scouts | grok-4.6:xhigh → terra:max |
| Flow controllers + research orchestrator | gpt-6-astra:xhigh → grok-4.6:xhigh → terra:max |

## Agent yields over 50 KiB (`agent://`)

Prefer session file path when known, harness full-read helpers if present, or
manual `agent://Id:range` reassembly. Never invent compression formats for handoff.

## Beads

Harness start → epic + phase issues. Claim/close per task. Spec/plan SoT in bd.
Every implementable bite carries `verify: <runnable command>`. PR URL on epic.

## Worktrees

Real harness-managed git worktrees; ≤8 concurrent lanes. Implementers never
create their own worktree (`kickoff-branch` consumes assignment only).

## Entry points

| Command | Behavior |
|---------|----------|
| `/harness [text]` | Full harness (this skill + controller) |
| `/init` | Scaffold only → `project-init` |
| `/design` | Design-flow only (not full implement) |
| `/code-review` | Owned by dynamic-workflows (local/diff) |
| `/pr-review` | Local Pi freeze (Grok+Sol+Opus reviewers, Terra judge) |
| `/goal`, `/guided-goal` | **Native Pi** — do not override |

## Chain

- **Consumes:** design-handoff from `/design`. Do not re-discover settled design.
- **Intermediaries:** `research-orchestrator` before Spec; `impact-assessor` before Plan; `verify-gate` between implement and Milestone.

## Design

Historical notes may live under docs/; runtime methodology is Bigpowers
(ADR-0001–0004). Gate: `~/.pi/agent/scripts/assert-no-superpowers.sh`.
