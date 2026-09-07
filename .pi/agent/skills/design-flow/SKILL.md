---
name: design-flow
description: >
  Orchestrate the pre-harness design flow via /design. Produces PDR + Arc42
  (bd/session) and ADRs (docs/adr only). Design only — never build or auto-start
  /harness. Architect skill loads here.
---

# Design flow

Pre-`/harness` system design. Runtime FSM in `extensions/goal-harness.ts` (`intake→pdr→arc42→adr→handoff`). **Not** a phase inside harness `research→…→pr`.

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
| 1 | Intake | parent + `elaborate-spec` | — | — |
| 2 | PDR | `pdr-writer` | `pdr-reviewer` | 2 |
| 3 | Arc42 | `arc42-writer` | `arc42-reviewer` | 2 |
| 4 | ADR | `adr-writer` (JSON only) | schema validate | 1–2 |
| 5 | Handoff | controller | — | — |

First reviewer `ok: true` ends a gate. Rewrite only on `ok: false` + blocking.
Reviewers follow `policy/REVIEW-POLICY.md` (default PASS).

## Skills (live load by path — not cold `skill://`)

Cold catalog is intent-router+beads only.

- `~/.pi/agent/npm/node_modules/bigpowers/skills/elaborate-spec/SKILL.md` (required on PDR/Arc42)
- `~/.agents/skills/ponytail/SKILL.md` on writers
- `~/.agents/skills/caveman/SKILL.md` on writers (chat prose only; artifact bodies stay normal English)
- `~/.agents/skills/graphify/SKILL.md` on PDR/Arc42 writers (architecture graph; tokensave remains symbol graph)
- `~/.pi/agent/skills/architect/SKILL.md` (`architect`) — required on PDR/Arc42 writers; never cold-listed; never vendor its body into prompts
- Never vendor Bigpowers bodies into prompts

## Models

SoT: `~/.pi/agent/workflows/model-routes.json`. Writers = `writer` chain; reviewers = `reviewer` (max 3, first ok:true ends). Provider failover applies.

## Artifacts

| Artifact | Storage |
|----------|---------|
| PDR JSON / notes | **bd best-effort** when issue available; session handoff always |
| Arc42 sections + mermaid | **bd best-effort** when issue available; session handoff always |
| ADRs | **git** `docs/adr/NNNN-slug.md` only — **controller writes**; agent is JSON-only |
| Methodology plans as task SoT | **never** — use bd; ADRs only under `docs/adr/` |

ADR empty set: still one short accepted “no novel ADR — reuse existing decisions” record (schema `minItems` 1).

## Hard boundaries

- No application code, tests, worktrees, implementer, or feature PRs
- Do **not** auto-invoke `/harness` — handoff text may suggest it
- Controller writes ADRs under `docs/adr/`; `adr-writer` emits JSON only (no disk write)
- Keep goal-harness 19-role parity pack unchanged (design roles use `design-manifest.json`)

## Chain

- **Consumes:** architecture-handoff from `/architect`. Do not re-ask settled architecture.
- **Produces:** design-handoff for `/harness`.
- **Intermediaries:** `research-orchestrator` at intake; `assumption-griller` after architect; `impact-assessor` before `/harness`.

## Handoff

Return summary: accepted PDR/Arc42 refs, ADR paths, design-handoff, and `nextStep` suggestion
like `/harness <goal>`. Stop.
