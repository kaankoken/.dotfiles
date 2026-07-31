---
name: design
description: Pre-harness system design — PDR, Arc42, ADRs. No build, no /harness auto-start.
---

# /design

Design-only entry. Expand `$ARGUMENTS` as the bound system/design goal.

## Skills

Load live `SKILL.md` for:

- `using-superpowers`
- `design-flow`
- `brainstorming`

## Deterministic layer

Run `runDesignFlow` from `extensions/design-flow` (or `workflows/design-flow.ts`)
against the active repository root with `boundGoal` = trimmed `$ARGUMENTS`
(non-empty required; if empty, ask once for the design goal).

Phases: Intake → PDR (writer→reviewer) → Arc42 (writer→reviewer) → ADR writer → Handoff.

Models resolve via `resolveModelRoute` / `resolveReviewerModel` (design-pdr, design-adr, design-arc42).

## Artifacts

- PDR + Arc42: beads best-effort when issue available; session handoff always
- ADRs only: controller writes `docs/adr/NNNN-title.md` after validating adr-writer JSON
- Never create `docs/superpowers/**` or commit Superpowers plan/spec files

## Stop

After handoff summary, **stop**. Do **not**:

- start `/harness` phases (never auto-start `/harness`)
- open feature PRs
- create implementer worktrees
- shadow OMP native `/goal` or `/guided-goal`
