---
name: architect
description: >
  System-level software architecture: candidate comparison, quality attributes,
  boundaries, data strategy, operations. Standalone via /architect (in-session
  consult) and embedded in /design (required on PDR/Arc42 writers). Load by
  path ~/.pi/agent/skills/architect/SKILL.md — never cold skill. Layered
  doctrines (Clean/onion/hex) only via /architect-layered optional pack.
---

# Architect

System-level design: boundaries, patterns, data, ops. Not single-service
implementation detail (stack packs cover that), not code review
(`/code-review`), not the full gated design pipeline (`/design`).

## When to use / when not

| Use | Don't use — go here instead |
|-----|------------------------------|
| New system or major redesign | Single-service implementation details → `stack-*` packs |
| Monolith / microservices / serverless choice | Reviewing an existing diff → `/code-review` |
| Scale, resilience, data-consistency strategy | Reviewed PDR + Arc42 + ADR set → `/design` |
| Migration / modernization planning | Building the thing → `/harness` |
| Explicit Clean/onion/hex discussion | `/architect-layered` (not this default path) |

## Load contract

| | |
|--|--|
| **Path** | `~/.pi/agent/skills/architect/SKILL.md` |
| **Cold catalog** | Excluded in `settings.json`; read this skill by absolute path |
| **Tracker** | **bd** is SoT. No markdown task board. Never Superpowers. |
| **Standalone** | `/architect <question>` runs the workflow below in-session |
| **Controller** | `openai-codex/gpt-6-astra:xhigh`; command selects shared `harness-research` chain, warning on fallback |
| **Layered opt-in** | `/architect-layered` loads this skill **plus** `optional/layered-doctrines.md` |
| **Embedded** | `/design`: **required** on `pdr-writer` + `arc42-writer`; `adr-writer` stays architect-free; **never** layered doctrines |
| **References** | Read on demand under this directory; never paste bodies into agent prompts |
| **Ships via** | `stow .` → `~/.pi/agent/skills/architect/` |

Default `/architect` and `/design` **must not** load `optional/layered-doctrines.md`.

## Chain

- **Produces:** architecture-handoff (bd + session). `/design` consumes it. Do not skip to `/harness`.
- **Bigpowers:** path-load `~/.pi/agent/npm/node_modules/bigpowers/skills/` (`deepen-architecture`). Never Superpowers.
- **Intermediaries:** `research-orchestrator` before consult; `assumption-griller` before `/design`.
## Flow map

| Surface | This skill contributes |
|---------|------------------------|
| `/architect` | Steps 0–8 inline: consult → blueprint + handoff; ADRs only after user confirmation |
| `/architect-layered` | Same steps; optional doctrines allowed as candidates |
| `/design` PDR | Steps 1–2 (+ QA attrs): problem framing, non-goals, constraints, quality attributes, scope limits |
| `/design` Arc42 | Steps 3–6: candidates + tradeoffs, boundaries, data strategy, operations |
| `/design` ADR | Steps 7–8 land as MADR-lite via `adr-writer` (JSON only); drivers arrive through PDR/Arc42 |

### Arc42 section map

| Architect step | Arc42-ish landing |
|----------------|-------------------|
| 0 Repo-fit | Constraints / existing context |
| 1–2 Problem, QA, non-goals | Goals, quality requirements, scope |
| QA scenarios | Quality requirements (measurable) |
| 3 Candidates | Solution strategy |
| 4 Boundaries | Building block view, context |
| 5 Data | Building blocks + cross-cutting data |
| 6 Ops / failure / observability | Runtime + deployment + cross-cutting |
| 7 Scope limits | Goals / out of scope |
| Diagrams | Context + container views |
| 8 ADR | Architecture decisions |

Augments Bigpowers `elaborate-spec`; never replaces it. Never auto-starts
`/design` or `/harness`.

## ADR contract (MADR-lite)

Fields: `title`, `status` ∈ proposed|accepted|deprecated|superseded, `context`,
`decision`, `consequences`, optional `date`. Files live only at
`docs/adr/NNNN-slug.md`, written by the controller/session — agents emit JSON.
Few decisive ADRs over essay sprawl; skip ADRs for easily reversible choices.

### ADR trigger rules

Write an ADR only when **hard to reverse** (or expensive to reverse) **and** at least one of:

| Trigger | Examples |
|---------|----------|
| Cross-boundary | Service split, tenancy model, sync topology |
| High blast radius | AuthN system, primary datastore, event backbone |
| Compliance / security | Residency, E2E encryption, audit guarantees |
| Multi-team contract | Published API/event schema ownership |

**Skip ADR** when easy/medium reversibility and local to one module (library choice with façade, folder rename, single-endpoint shape).

Reversibility labels on candidates: **Easy / Medium / Hard**.

## Anti-patterns / YAGNI guards

- **Do not** propose Clean Architecture, onion, or hexagonal **unless** the user invoked `/architect-layered` or explicitly asked for those doctrines
- No layering-for-its-own-sake; no interface with a single forever implementation
- No premature microservices for a single team / unclear domain
- No generic repository-everywhere theater
- No 20-page pattern dump — depth on 3–5 decisions that matter
- Don't invent a second orchestrator or auto-chain to `/harness`

## Quick reference

| Task | Pattern / tool | Dig deeper |
|------|----------------|------------|
| Architecture style | Layered*, modular monolith, microservices, event-driven, serverless | `references/modern-patterns.md` |
| Scale | LB, cache, shard, read replicas | `references/scalability-reliability-guide.md` |
| Resilience | Circuit breaker, retry, bulkhead, degradation | `references/scalability-reliability-guide.md` + `assets/operations/failure-modes-checklist.md` |
| Service boundaries | DDD, bounded contexts | `assets/patterns/microservices-template.md` |
| Data consistency | ACID/BASE, CQRS, saga, event sourcing | `references/data-architecture-patterns.md` |
| Sync integration | Outbox, idempotency, webhook, BFF | `references/integration-patterns.md` |
| Security | Trust boundaries, STRIDE-lite | `references/security-architecture.md` |
| Observability | Golden signals, correlation | `references/observability-architecture.md` |
| Multi-tenancy | Isolation models | `references/multi-tenancy.md` |
| Inter-service mesh | API gateway, mesh, BFF | `references/api-gateway-service-mesh.md` |
| Migrate monolith | Strangler, DB split, shadow traffic | `references/migration-modernization-guide.md` |
| iOS modules | Feature modules, SPM graph | `references/ios-modularization.md` |
| Rust crates | Workspace boundaries | `references/rust-workspace-boundaries.md` |
| Local-first | Sync topology, LWW vs CRDT | `references/local-first-sync.md` |
| Agent systems | Control plane invariants | `references/agent-control-plane.md` |
| ADR | MADR-lite; session writes `docs/adr/` | ADR contract above |
| Blueprint | Consult deliverable shape | `assets/planning/architecture-blueprint.md` |
| Handoff | For `/design` (bd + session) | `assets/planning/architecture-handoff.md` |
| QA scenarios | ATAM-lite | `assets/planning/qa-scenarios.md` |
| Layered doctrines | Clean/onion/hex | **`optional/layered-doctrines.md` via `/architect-layered` only** |

\* “Layered” here means ordinary n-tier / modular layers — **not** Clean Architecture unless opt-in command.

## Decision tree (style)

```text
New system or major refactor
  ├─ Single team, evolving domain?
  │   ├─ Start simple → Modular monolith
  │   └─ Rapid iteration → Feature modules / light layering
  ├─ Multiple teams, clear bounded contexts?
  │   ├─ Independent deploy critical → Microservices
  │   └─ Shared data model → Modular monolith + modules
  ├─ Event-driven workflows?
  │   ├─ Async processing → EDA (Kafka/queues)
  │   └─ Complex sagas → Saga + event sourcing
  ├─ Variable load / pay-per-use → Serverless
  └─ Strong ACID → Monolith or modular monolith
```

**Defaults:** teams under 10 developers → modular monolith usually beats
microservices ops cost.

## Decision drivers & reversibility

Rank drivers per decision to make tradeoffs explicit (reorder freely):

| Priority | Driver | Measured by |
|---:|---|---|
| 1 | Reliability | SLO, error budget |
| 2 | Security | Threat model, control coverage |
| 3 | Cost | Unit cost, infra spend |
| 4 | Delivery speed | Lead time, deployment frequency |
| 5 | Operability | On-call load, MTTR |

Every candidate option carries **Reversibility: Easy / Medium / Hard**. Prefer
reversible; document the hard-to-reverse ones as ADRs.

## Workflow (system-level)

0. **Repo-fit probe** (when a project is open): skim code graph via tokensave
   (`tokensave_context` / search) or equivalent — fit current structure or
   propose an explicit break. Skip if no repo/graph.
1. Clarify problem, non-goals, constraints, success metrics
2. Capture quality attributes (availability, latency, throughput, durability, consistency, security, cost)
   - Add ≥1 **ATAM-lite** scenario from `assets/planning/qa-scenarios.md` when non-trivial
3. Propose 2–3 candidates + tradeoffs (drivers table above)
4. Boundaries: contexts, ownership, APIs/events
5. Data strategy (+ tenancy if multi-tenant)
6. Ops: SLOs, failure modes checklist, observability, DR, security checklist as needed
7. Scope limits: what NOT to build, defer, buy vs build
8. Decisive ADRs only (trigger table; confirm before writing files)

**Diagrams (default):** emit ≥1 **context** and ≥1 **container** mermaid diagram
(or justify a single-diagram exception in one line).

**Fit-check:** if user passes `--against-adr`, `against docs/adr`, or ADR paths,
list `docs/adr/` and call out conflicts/supersede needs before recommending.

**Handoff (always):** fill `assets/planning/architecture-handoff.md` in session
text (also bd). Next step is `/design`. Never auto-start `/harness`.

Current-trend questions: live `web_search` — no vendored trend digests.

Read **at most 2–3** references per question.

## Output discipline

- Absorb references; **do not** cite internal filenames in user-facing prose
  unless the user is editing the skill tree itself.
- Concrete technology picks (not only pattern names).
- Explicit **what NOT to build** / defer (YAGNI, ponytail).
- Team/ownership implications when relevant.
- Success metrics (deploy frequency, lead time, error rate, MTTR).
- Depth on 3–5 decisions that matter — not exhaustive essays.
- ADR path: JSON from `adr-writer` in `/design`; session owns `docs/adr/NNNN-slug.md` for `/architect`.

## Navigation

| Reference | When |
|-----------|------|
| `references/modern-patterns.md` | Pattern choice |
| `references/scalability-reliability-guide.md` | Scale / SRE |
| `references/data-architecture-patterns.md` | Cross-service data |
| `references/integration-patterns.md` | Sync / outbox / webhooks / BFF |
| `references/security-architecture.md` | Threat model / trust boundaries |
| `references/observability-architecture.md` | Telemetry topology |
| `references/multi-tenancy.md` | Isolation |
| `references/migration-modernization-guide.md` | Monolith split |
| `references/api-gateway-service-mesh.md` | Mesh / gateway |
| `references/operational-playbook.md` | Framing questions, security checklist |
| `references/ios-modularization.md` | iOS module graph |
| `references/rust-workspace-boundaries.md` | Rust crate graph |
| `references/local-first-sync.md` | Offline / sync |
| `references/agent-control-plane.md` | Multi-agent systems |
| `optional/layered-doctrines.md` | **Only** via `/architect-layered` |

Templates: `assets/planning/architecture-blueprint.md`,
`assets/planning/architecture-handoff.md`,
`assets/planning/qa-scenarios.md`,
`assets/patterns/microservices-template.md`,
`assets/patterns/event-driven-template.md`,
`assets/operations/scalability-checklist.md`,
`assets/operations/failure-modes-checklist.md`,
`assets/operations/security-checklist.md`.

## Related surfaces

- `/architect-layered` — same consult + Clean/onion/hex optional pack
- `/design` — gated multi-agent pipeline (reviewed PDR + Arc42 + ADR)
- `stack-*` packs — language/platform implementation depth
- `/code-review` — review implementations against this architecture
- `/harness` — build **after** `/design` consumes architecture-handoff

<!-- provenance: vendored from https://github.com/vasilyu1983/AI-Agents-public
     frameworks/shared-skills/skills/software-architecture-design
     @ 6a223ba13c311c09b41c1dc09c14ab75e703894b (fetched 2026-08-01).
     Adapted for Pi: intentional fork, not a mirror. MADR-lite ADR contract,
     flow map, root-relative links; dropped upstream trends digest,
     data/sources dump, upstream ADR form. Extended 2026-08-09: security,
     observability, tenancy, integration, domain packs, handoff, opt-in layered.
     Refresh manually if ever needed. -->
