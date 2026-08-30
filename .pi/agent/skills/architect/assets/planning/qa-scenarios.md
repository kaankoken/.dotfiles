# Quality-attribute scenarios (ATAM-lite)

Use ≥1 scenario for non-trivial designs. Keep short.

## Template

| Field | Content |
|-------|---------|
| **Attribute** | e.g. availability, latency, durability, security, cost |
| **Stimulus** | What happens (spike, region loss, bad deploy, tenant flood) |
| **Environment** | Load/state when it happens |
| **Response** | What the system does |
| **Measure** | Numeric or binary success (p99, RPO/RTO, zero cross-tenant rows) |

## Examples

| Attribute | Stimulus | Response | Measure |
|-----------|----------|----------|---------|
| Latency | 10× read QPS on catalog | cache + shed noncritical | p99 < 200ms at edge |
| Availability | primary DB unreachable | fail over read path; writes queue or 503 | RTO < 5m; no split-brain |
| Security | stolen user session token | revoke + short TTL + bind | session unusable < 1m |
| Tenancy | tenant A API key used with B id | deny + audit | 0 cross-tenant reads |
| Durability | worker crash mid-outbox | relay resumes | 0 lost accepted writes |

## How many

- 1 scenario: small consult
- 3–5: system redesign / `/design` PDR quality section
- Skip essays; table rows only
