---
name: architect
description: >
  System-level software architecture: candidate comparison, quality attributes,
  boundaries, data strategy, operations. Standalone via /architect (in-session
  consult) and embedded in /design (required on PDR/Arc42 writers). Load by
  path ~/.omp/agent/skills/architect/SKILL.md — never cold skill.
---

# Architect — OMP software architecture skill

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

## OMP load contract

| | |
|--|--|
| **Path** | `~/.omp/agent/skills/architect/SKILL.md` (repo: `omp/skills/architect/`) |
| **Cold catalog** | Never cold-listed (cold is intent-router+beads only) |
| **Standalone** | `/architect <question>` runs the workflow below in-session |
| **Embedded** | `/design`: **required** on `pdr-writer` + `arc42-writer`; `adr-writer` stays architect-free |
| **References** | Read on demand under this directory; never paste bodies into agent prompts |
| **Ships via** | `omp/link.sh` `skills` symlink → `~/.omp/agent/skills/architect/` |

## OMP flow map

| Surface | This skill contributes |
|---------|------------------------|
| `/architect` | Steps 1–8 inline: consult → blueprint-form recommendation; ADRs only after user confirmation |
| `/design` PDR | Steps 1–2: problem framing, non-goals, constraints, quality attributes, scope limits |
| `/design` Arc42 | Steps 3–6: candidates + tradeoffs, boundaries, data strategy, operations |
| `/design` ADR | Steps 7–8 land as MADR-lite records via `adr-writer` (JSON only); drivers arrive through PDR/Arc42 content |

Augments Superpowers `brainstorming`; never replaces it. Never auto-starts
`/design` or `/harness`.

## ADR contract (OMP — MADR-lite)

Fields: `title`, `status` ∈ proposed|accepted|deprecated|superseded, `context`,
`decision`, `consequences`, optional `date`. Files live only at
`docs/adr/NNNN-slug.md`, written by the controller/session — agents emit JSON.
Few decisive ADRs over essay sprawl; skip ADRs for easily reversible choices.

## Quick reference

| Task | Pattern / tool | Dig deeper |
|------|----------------|------------|
| Architecture style | Layered, modular monolith, microservices, event-driven, serverless | `references/modern-patterns.md` |
| Scale | LB, cache, shard, read replicas | `references/scalability-reliability-guide.md` |
| Resilience | Circuit breaker, retry, bulkhead, degradation | `references/scalability-reliability-guide.md` |
| Service boundaries | DDD, bounded contexts | `assets/patterns/microservices-template.md` |
| Data consistency | ACID/BASE, CQRS, saga, event sourcing | `references/data-architecture-patterns.md` |
| Inter-service | API gateway, mesh, BFF | `references/api-gateway-service-mesh.md` |
| Migrate monolith | Strangler, DB split, shadow traffic | `references/migration-modernization-guide.md` |
| ADR (OMP) | MADR-lite; controller/session writes `docs/adr/NNNN-slug.md` | ADR contract above |
| Blueprint | Consult deliverable shape | `assets/planning/architecture-blueprint.md` |

## Decision tree (style)

```text
New system or major refactor
  ├─ Single team, evolving domain?
  │   ├─ Start simple → Modular monolith
  │   └─ Rapid iteration → Layered
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

1. Clarify problem, non-goals, constraints, success metrics
2. Capture quality attributes (availability, latency, throughput, durability, consistency, security, cost)
3. Propose 2–3 candidates + tradeoffs (drivers table above)
4. Boundaries: contexts, ownership, APIs/events
5. Data strategy
6. Ops: SLOs, failure modes, observability, DR
7. Scope limits: what NOT to build, defer, buy vs build
8. Decisive ADRs only (MADR-lite; confirm before writing files)

Current-trend questions: live `web_search` — no vendored trend digests.

## Output discipline

- Absorb references; **do not** cite internal filenames in user-facing prose.
- Concrete technology picks (not only pattern names).
- Explicit **what NOT to build** / defer (YAGNI, ponytail).
- Team/ownership implications when relevant.
- Success metrics (deploy frequency, lead time, error rate, MTTR).
- Depth on 3–5 decisions that matter — not exhaustive essays.
- OMP ADR path: JSON from `adr-writer`; controller/session owns `docs/adr/NNNN-slug.md`.

## Navigation

Read **at most 2–3** references per question.

| Reference | When |
|-----------|------|
| `references/modern-patterns.md` | Pattern choice |
| `references/scalability-reliability-guide.md` | Scale / SRE |
| `references/data-architecture-patterns.md` | Cross-service data |
| `references/migration-modernization-guide.md` | Monolith split |
| `references/api-gateway-service-mesh.md` | Mesh / gateway |
| `references/operational-playbook.md` | Framing questions, security checklist |

Templates: `assets/planning/architecture-blueprint.md`,
`assets/patterns/microservices-template.md`,
`assets/patterns/event-driven-template.md`,
`assets/operations/scalability-checklist.md`.

## Related OMP surfaces

- `/design` — gated multi-agent pipeline (reviewed PDR + Arc42 + ADR)
- `stack-*` packs — language/platform implementation depth
- `/code-review` — review implementations against this architecture

<!-- provenance: vendored from https://github.com/vasilyu1983/AI-Agents-public
     frameworks/shared-skills/skills/software-architecture-design
     @ 6a223ba13c311c09b41c1dc09c14ab75e703894b (fetched 2026-08-01).
     Adapted for OMP: intentional fork, not a mirror. MADR-lite ADR contract,
     OMP flow map, root-relative links; dropped upstream trends digest,
     data/sources dump, upstream ADR form. Refresh manually if ever needed. -->
