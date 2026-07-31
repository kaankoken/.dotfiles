---
name: design-flow
description: >
  Orchestrate the OMP pre-harness design flow via /design. Produces PDR + Arc42
  (bd/session) and ADRs (docs/adr only). Design only — never build or auto-start
  /harness. Future architect skill hooks here.
---

# OMP Design flow

Pre-`/harness` system design. **Not** a phase inside goal-harness `PHASE_ORDER`.

## Entry

| Command | Behavior |
|---------|----------|
| `/design [text]` | Full design flow (this skill) |
| `/harness` | Build only — do not start from here |
| `/init` | Scaffold only |

Bound text is the only design goal (same role as `/harness` args).

## Phases

| # | Phase | Producer | Reviewer | Max attempts |
|---|--------|----------|----------|--------------|
| 1 | Intake | parent + `brainstorming` | — | — |
| 2 | PDR | `pdr-writer` | `pdr-reviewer` | 2 |
| 3 | Arc42 | `arc42-writer` | `arc42-reviewer` | 2 |
| 4 | ADR | `adr-writer` (JSON only) | schema validate | 1–2 |
| 5 | Handoff | controller | — | — |

First reviewer `ok: true` ends a gate. Rewrite only on `ok: false` + blocking.
Reviewers follow `agents/REVIEW-POLICY.md` (default PASS).

## Skills (live load by name)

- `brainstorming` (required)
- `caveman`, `ponytail` on writers
- When skill `architect` exists later, load it; until then brainstorming only
- Never vendor Superpowers bodies into prompts

## Models (`model-router` phases)

Resolve via `resolveModelRoute` / `resolveReviewerModel` (never sole hardcodes):

| Phase | Chain |
|-------|--------|
| PDR / ADR (`design-pdr`, `design-adr`) | Opus 5 **max/xhigh** → Terra 5.6 **max** → Sol 5.6 **xhigh** → Grok |
| Arc42 (`design-arc42`) | Grok → Composer 2.5 |

Reviewers use the same chain with producer id skipped (`resolveReviewerModel`).

## Artifacts

| Artifact | Storage |
|----------|---------|
| PDR JSON / notes | **bd best-effort** when issue available; session handoff always |
| Arc42 sections + mermaid | **bd best-effort** when issue available; session handoff always |
| ADRs | **git** `docs/adr/NNNN-slug.md` only — **controller writes**; agent is JSON-only |
| Superpowers specs/plans | **never** write under `docs/superpowers/` or `docs/plans/` from this flow |

ADR empty set: still one short accepted “no novel ADR — reuse existing decisions” record (schema `minItems` 1).

## Hard boundaries

- No application code, tests, worktrees, implementer, or feature PRs
- Do **not** auto-invoke `/harness` — handoff text may suggest it
- Controller writes ADRs under `docs/adr/`; `adr-writer` emits JSON only (no disk write)
- Keep goal-harness 19-role parity pack unchanged (design roles use `design-manifest.json`)

## Handoff

Return summary: accepted PDR/Arc42 refs, ADR paths, and `nextStep` suggestion
like `/harness <goal>`. Stop.
