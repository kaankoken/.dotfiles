# Multi-tenancy & isolation

## Decision tree

```text
Need tenant isolation?
  ├─ Single-tenant deploy (one customer per instance) → strongest isolation, highest ops cost
  ├─ Shared app, separate DB per tenant → strong data isolation; migration/ops heavy
  ├─ Shared DB, schema/table per tenant → medium; watch migrations & noisy neighbor
  └─ Shared tables + tenant_id column → cheapest; requires ruthless AuthZ + indexing discipline
```

**Default for small teams / early product:** shared tables + verified `tenant_id` from token, unless compliance forces harder isolation.

## Isolation dimensions

| Dimension | Weak | Strong |
|-----------|------|--------|
| Data | `tenant_id` filter | Separate DB/cluster |
| Compute | shared workers | dedicated pools/nodes |
| Network | shared VPC | per-tenant network |
| Encryption | shared CMK | per-tenant keys |
| Blast radius | noisy neighbor OK | noisy neighbor contained |

## Hard rules (shared-table model)

1. Tenant id from **verified identity**, never sole trust in request body
2. Every query/storage path tenant-scoped (ORM global filter or equivalent) — test for missing filter
3. Cross-tenant admin paths explicit + audited
4. Background jobs carry tenant context; no “process all rows” without tenant loop
5. Caches/keys include tenant prefix
6. Exports/backups respect tenant boundaries

## Noisy neighbor

Rate limits and quotas **per tenant** at edge and expensive dependencies. Separate critical-path pools when one tenant can starve others.

## Compliance fork

| Requirement | Usually implies |
|-------------|-----------------|
| Data residency | region pinning or single-tenant regional deploys |
| Customer-managed keys | per-tenant CMK + careful key lifecycle |
| Hard delete / right-to-erasure | tenant-scoped purge jobs + backup story |

## Related

- AuthZ: [references/security-architecture.md](references/security-architecture.md)
- Data patterns: [references/data-architecture-patterns.md](references/data-architecture-patterns.md)
