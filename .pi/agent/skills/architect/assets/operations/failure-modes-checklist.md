# Failure modes checklist

Tick before locking architecture. Pair with [references/scalability-reliability-guide.md](references/scalability-reliability-guide.md).

## Cascade & coupling

- [ ] Timeout budgets on every outbound dependency
- [ ] Circuit breaker / fail-fast for unstable deps
- [ ] Bulkhead pools (one dep cannot exhaust all threads)
- [ ] No unbounded sync call chains on user path

## Traffic & backpressure

- [ ] Load shedding / queue limits defined
- [ ] Backpressure signal to callers (429/503 + Retry-After story)
- [ ] Per-tenant quotas if multi-tenant

## Data & async

- [ ] Poison message → DLQ + alert (not infinite retry)
- [ ] At-least-once consumers are idempotent
- [ ] Outbox/inbox if dual-write risk exists
- [ ] Migration/rollback story for schema

## Partition & dependency loss

- [ ] Behavior when cache down (degrade vs hard fail)
- [ ] Behavior when bus down
- [ ] Behavior when third-party auth down
- [ ] Multi-region: RPO/RTO named if claimed

## Release & human

- [ ] Canary/flag kill switch for risky paths
- [ ] Broken deploy rollback path
- [ ] Runbook owners for top alerts

## Security-related failure

- [ ] Key/secret rotation without downtime plan
- [ ] Partial auth outage doesn't open anonymous write paths

## Related

- Observability: [references/observability-architecture.md](references/observability-architecture.md)
- Security: [assets/operations/security-checklist.md](assets/operations/security-checklist.md)
