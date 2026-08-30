# Observability architecture

Make failure diagnosable by design. Pair with [references/scalability-reliability-guide.md](references/scalability-reliability-guide.md) for SLOs.

## Pillars (topology)

| Pillar | Role | Architecture choice |
|--------|------|---------------------|
| Metrics | Cheap, aggregate, alert | RED/USE or golden signals per critical user journey |
| Logs | Discrete events, audit, debug | Structured; correlation ids; level policy; PII rules |
| Traces | Cross-service latency/cause | One trace id across edge → services → deps |
| Profiles (optional) | CPU/heap hot spots | Continuous or on-demand for critical services |

## Golden signals (per user-facing path)

Latency · Traffic · Errors · Saturation — define **where measured** (edge vs service vs datastore).

## Correlation contract

Every request carries / propagates:

- `trace_id` / `span_id` (W3C Trace Context preferred)
- `request_id` (if distinct from trace)
- `tenant_id` / `actor_id` when applicable (authorized values only)

Logs and metrics labels must reuse the same ids — not three naming schemes.

## Instrumentation ownership

| Layer | Owns |
|-------|------|
| Edge / gateway | Entry span, TLS/auth failures, rate-limit counters |
| Service | Business spans, dependency spans, domain error classes |
| Worker / async | Consumer lag, retry counts, poison messages |
| Data stores | Pool saturation, slow queries (via service or exporter) |

Prefer **OpenTelemetry** semantic conventions when choosing a stack; avoid bespoke field names for the same concepts.

## SLO → alert path

1. Product journey → SLI (e.g. p99 checkout < 300ms, 99.9% success)
2. Error budget policy (page vs ticket)
3. Alert on **burn rate / user impact**, not on every CPU blip
4. Runbook link from alert → first three checks

## Dashboards (minimum set)

| Dashboard | Audience |
|-----------|----------|
| Journey health | On-call: SLIs + error budget |
| Service golden signals | Owning team |
| Dependency health | Downstream status |
| Async / queue | Lag, DLQ depth |

## Anti-patterns

- Metrics without owners or cardinality bombs (`user_id` as label)
- Logs as the only “trace” (grep theater)
- Alerting on infrastructure before user SLIs exist
- PII/secrets in log bodies

## Related

- Security of telemetry: [references/security-architecture.md](references/security-architecture.md)
- Failure modes: [assets/operations/failure-modes-checklist.md](assets/operations/failure-modes-checklist.md)
