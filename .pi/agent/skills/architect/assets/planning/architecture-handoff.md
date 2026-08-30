# Architecture handoff (paste into `/harness`)

Fill in session; do not invent a second goal. Controller/session may store in bd notes.

## Goal (one paragraph)

…

## Non-goals

- …

## Constraints (hard)

- …

## Quality attributes / SLOs

| Attribute | Target | Measure |
|-----------|--------|---------|
| … | … | … |

## QA scenarios (ATAM-lite)

See [assets/planning/qa-scenarios.md](assets/planning/qa-scenarios.md). Paste 1–3:

1. …

## Chosen shape

- Style: …
- Boundaries: …
- Data: …
- Integration: …
- Tenancy: …
- Security highlights: …
- Observability highlights: …

## Forbidden approaches

- … (e.g. no Clean/onion/hex unless product later opts in via `/architect-layered`)

## ADRs

| ID | Title | Path |
|----|-------|------|
| … | … | `docs/adr/NNNN-….md` |

## Diagrams

- Context mermaid: (session or link)
- Container mermaid: (session or link)

## Acceptance probes (how harness knows done)

1. …
2. …

## Suggested next command

```text
/harness <same goal>. Constraints and ADRs: <paths>. Boundaries: <one-liner>. Forbidden: <one-liner>.
```

Or full gated design first:

```text
/design <same goal>
```
