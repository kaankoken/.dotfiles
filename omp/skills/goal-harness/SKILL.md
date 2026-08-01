---
name: goal-harness
description: >
  Orchestrate the OMP multi-model goal harness via /harness. Process engine:
  Superpowers skills (live SKILL.md). Roles under omp/agents/. Beads SoT.
  Does not shadow native /goal or /guided-goal.
---

# OMP Goal harness

## Loading skills (cold catalog)

Cold `includeSkills` is **only** `intent-router` + `beads`. OMP `skill://NAME` works for those two only.

For Superpowers / flow / pack skills use **absolute path** `read` (roots stay in `customDirectories`):

| Kind | Path pattern |
|------|----------------|
| Superpowers | `~/.agents/skills/superpowers/<name>/SKILL.md` |
| OMP flow/stack | `~/.omp/agent/skills/<name>/SKILL.md` |
| ponytail* | `~/.agents/skills/<name>/SKILL.md` |

Do **not** `skill://finishing-a-development-branch` (etc.) — fails with "Unknown skill".


Process engine: **Superpowers** (read live `SKILL.md` by path + SHA). Named roles:
`omp/agents/*.md` (19-role parity manifest). Do not run two competing full harness chains.

## Default goal (no `/harness` args → exactly these 8 lines)

1. No errors, no warnings, no test failures.
2. No warning suppressions in production (test-only OK with reason).
3. Everything wired — no stubs, TODO/TBD/FIXME, unfinished work.
4. Mandated skills: using-superpowers + project stack skills + ponytail (load by **path** under cold catalog; never empty skill://; skill:// only for intent-router/beads).
5. Latest dependencies — verify on the web (not training data alone).
6. Complete all superpowers-derived spec/plan tasks.
7. Specs, plans, goals, updates tracked in **bd** (SoT).
8. Do not add unnecessary docstrings or comments to the codebase. You can add only explanatory comments to the codebase for methods/functions, or other stuff. This is not a notebook that you made for yourself.

With arguments: replace 1–8 completely with that text.

## Phases

| # | Phase | Superpowers skill names (live load) | Producer | Reviewer | Max attempts |
|---|--------|--------------------------------------|----------|----------|--------------|
| 0 | Init | using-superpowers (parent) | `project-init` (safe bd init only; never bare `bd init`) | — | — |
| 1 | Spec | brainstorming | `spec-writer` + scouts | `spec-reviewer` | 3 |
| 2 | Plan | writing-plans | `plan-writer` + scouts | `plan-reviewer` | 3 |
| 3 | BiteSize | writing-plans | `bite-size-writer` | `bite-size-reviewer` | 2 |
| 4 | Implement | test-driven-development, using-git-worktrees, subagent-driven-development | `implementer` | optional light | — |
| 5 | Milestone | requesting-code-review, verification-before-completion | multi `code-reviewer` | `milestone-organizer` | 3 |
| 6 | PR | path `…/superpowers/finishing-a-development-branch/SKILL.md` | `pr-opener` | — | — |

**Max attempts = ceiling, not a quota.** First reviewer `ok: true` ends the gate.
Producer rewrite runs **only** when the reviewer returns `ok: false` (blocking items).
Do **not** spawn free-standing `*Revision1` / `*Revision2` agents “because budget remains.”
Nits under `ok: true` are non-blocking notes — not revision triggers.

**Reviewer PASS bias:** all reviewers obey `agents/REVIEW-POLICY.md`. Default
`ok: true` / empty `blocking`. Fail only for wrong, impossible, unsafe,
unverifiable-core, or hard dependency gaps. Exhaustive evidence before product
work, thoroughness preferences, and process theater are **nits**, not fails.
Product/UI goals: product-first ordering is correct; defer heavy proof factories.

Bug path: **systematic-debugging** (live skill) before plan → implement.

Do **not** paste Superpowers skill instructions here — only names + “read authoritative SKILL.md”.

## Model routes (deterministic later tasks)

| Role | Chain preference | Effort |
|------|------------------|--------|
| Spec/plan/bite/milestone | sol → fabel → opus | ultra/max |
| Implement | grok 4.5 → sol high → sonnet | high |
| Scouts | medium / grok high when used | — |

## Agent yields over 50 KiB (`agent://`)

OMP `read` head-truncates around **50 KiB** (`DEFAULT_MAX_BYTES`). Full yields still
land on disk as session `<id>.md`. **Do not** `json.loads(read('agent://BigYield'))`
on large plan/spec envelopes.

Prefer (in order):

1. Session file path when known: `json.loads(Path(.../Id.md).read_text())`
2. Harness helper `readAgentJsonFull(id, read)` / `readAgentTextFull` from
   `extensions/goal-harness/agent-output.ts` (range reassembly under the cap)
3. Manual ranges: `agent://Id:1-200`, `agent://Id:201-400`, … then join + parse

Never invent compression formats for agent handoff.

## Beads

Harness start → epic + phase issues. Claim/close per task. Spec/plan SoT in bd. PR URL on epic.

## Worktrees

Real harness-managed git worktrees; ≤8 concurrent lanes. Implementers never create their own worktree.

## Entry points

| Command | Behavior |
|---------|----------|
| `/harness [text]` | Full harness (this skill) |
| `/init` | Scaffold only → `project-init` |
| `/goal`, `/guided-goal` | **Native OMP** — do not override |

## Design

`docs/superpowers/specs/2026-07-24-omp-goal-harness-migration-design.md` (path+SHA in bd epic notes).
