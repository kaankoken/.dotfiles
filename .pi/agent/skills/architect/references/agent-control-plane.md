# Agent / tooling control plane (thin)

For multi-agent harnesses, skill routers, and tool gateways — system shape only.

## Pieces

| Piece | Job |
|-------|-----|
| Router / intent | Classify user text → one flow (no double-start) |
| Orchestrator | Phase order, budgets, gates |
| Workers | Bounded roles; explicit tools |
| Skill catalog | Cold vs on-demand load (token budget) |
| Memory / SoT | Issues, ADRs, session artifacts — one authority |
| Tool policy | Allow/deny, approval mode, secret paths |
| Model router | Role → model chain; not one god model |

## Invariants

1. **At most one** top-level controller per thread (harness XOR design XOR PR review)
2. Cold start stays tiny; domain packs path-loaded
3. Workers don't invent parallel orchestrators
4. Artifacts have a home: bd / `docs/adr/` / session — not random markdown TODOs
5. Handoff between design and build is **explicit** ([assets/planning/architecture-handoff.md](assets/planning/architecture-handoff.md))

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Agent loops / budget burn | attempt ceilings; PASS-biased reviewers |
| Context flood | compress; don't vendor skill bodies into prompts |
| Conflicting writers | single writer per artifact type (e.g. controller writes ADRs) |
| Silent tool RCE | approval policy; no unbounded shell in untrusted roles |

## Anti-patterns

- Second intent classifier that re-starts flows mid-harness
- Every question → full gated pipeline
- Storing secrets in session logs

## Related

- OMP flows stay in AGENTS.md / design-flow / goal-harness — this ref does not replace them
