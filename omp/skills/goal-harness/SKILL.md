---
name: goal-harness
description: >
  Orchestrate the OMP multi-model goal harness via /harness. Process engine:
  Superpowers skills (live SKILL.md). Roles under omp/agents/. Beads SoT.
  Does not shadow native /goal or /guided-goal.
---

# OMP Goal harness

Process engine: **Superpowers** (read live `SKILL.md` by path + SHA). Named roles:
`omp/agents/*.md` (19-role parity manifest). Do not run two competing full harness chains.

## Default goal (no `/harness` args → exactly these 7 lines)

1. No errors, no warnings, no test failures.
2. No warning suppressions in production (test-only OK with reason).
3. Everything wired — no stubs, TODO/TBD/FIXME, unfinished work.
4. Mandated skills: superpowers + stack + caveman + ponytail.
5. Latest dependencies — verify on the web (not training data alone).
6. Complete all superpowers-derived spec/plan tasks.
7. Specs, plans, goals, updates tracked in **bd** (SoT).

With arguments: replace 1–7 completely with that text.

## Phases

| # | Phase | Superpowers skill names (live load) | Producer | Reviewer | Retry N |
|---|--------|--------------------------------------|----------|----------|---------|
| 0 | Init | using-superpowers (parent) | `project-init` | — | — |
| 1 | Spec | brainstorming | `spec-writer` + scouts | `spec-reviewer` | 3 |
| 2 | Plan | writing-plans | `plan-writer` + scouts | `plan-reviewer` | 3 |
| 3 | BiteSize | writing-plans | `bite-size-writer` | `bite-size-reviewer` | 2 |
| 4 | Implement | test-driven-development, using-git-worktrees, subagent-driven-development | `implementer` | optional light | — |
| 5 | Milestone | requesting-code-review, verification-before-completion | multi `code-reviewer` | `milestone-organizer` | 3 |
| 6 | PR | finishing-a-development-branch | `pr-opener` | — | — |

Bug path: **systematic-debugging** (live skill) before plan → implement.

Do **not** paste Superpowers skill instructions here — only names + “read authoritative SKILL.md”.

## Model routes (deterministic later tasks)

| Role | Chain preference | Effort |
|------|------------------|--------|
| Spec/plan/bite/milestone | sol → fabel → opus | ultra/max |
| Implement | grok 4.5 → sol high → sonnet | high |
| Scouts | medium / grok high when used | — |

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
