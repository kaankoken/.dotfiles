# Security architecture

Threat model, trust boundaries, and control placement at system level. Not app-framework auth tutorials.

## When to read

New system, major redesign, multi-tenant boundaries, external integrations, regulated data.

## Trust boundaries (draw these first)

| Boundary | Typical controls |
|----------|------------------|
| Public internet → edge | TLS, WAF/rate limit, bot/abuse, DDoS posture |
| Edge → app | AuthN, request validation, mTLS or signed internal calls |
| App → data stores | Least privilege IAM, network policy, encryption at rest |
| App → third parties | Egress allowlist, scoped tokens, no ambient cloud creds |
| Admin / break-glass | Separate path, stronger AuthN, full audit |
| Tenant A ↔ tenant B | See [references/multi-tenancy.md](references/multi-tenancy.md) |

Mark every arrow on the container diagram with: authenticated? authorized? encrypted? logged?

## STRIDE-lite (per boundary)

| Threat | Ask | Default mitigations |
|--------|-----|---------------------|
| Spoofing | Who proves identity? | Strong AuthN, service identity, no shared long-lived keys |
| Tampering | Can body/path be altered? | Integrity (TLS, signatures), server-side validation |
| Repudiation | Can actor deny action? | Audit log with actor, tenant, request id |
| Info disclosure | What leaks on error/logs? | Redact secrets/PII; separate debug from prod |
| DoS | What exhausts us? | Limits, backpressure, bulkheads — [assets/operations/failure-modes-checklist.md](assets/operations/failure-modes-checklist.md) |
| Elevation | Can role jump? | AuthZ at resource, not only at UI; deny-by-default |

Depth: 3–5 high-impact boundaries, not a novel.

## Data classification → controls

| Class | Examples | At rest | In transit | Access |
|-------|----------|---------|------------|--------|
| Public | marketing copy | optional | TLS preferred | open |
| Internal | ops metrics | encrypt | TLS | staff roles |
| Confidential | PII, tokens | encrypt + key custody | TLS + short-lived creds | least privilege + audit |
| Restricted | secrets, payments, health | HSM/KMS, strict retention | mTLS or equivalent | break-glass + dual control |

## AuthN / AuthZ placement

| Decision | Prefer | Avoid |
|----------|--------|-------|
| User AuthN | OIDC/OAuth2 at edge or BFF | Custom crypto password stores without review |
| Service AuthN | Workload identity / mTLS / signed JWT | Long-lived static API keys in env of every pod |
| AuthZ | Resource-level checks in the owning service | “UI hid the button” as only control |
| Multi-tenant AuthZ | Tenant id from verified token, never from client body alone | Client-supplied `tenant_id` trusted blindly |

## Secrets & supply chain (architecture-level)

- Secrets inject at runtime (platform store); never bake into images or git
- Separate **build** identity from **runtime** identity
- Third-party apps: least scope, rotation, egress destination known
- Dependency/risk: pin + scan is ops; **architecture** owns “what must never be a dependency”

## Checklist companion

Use [assets/operations/security-checklist.md](assets/operations/security-checklist.md) before locking ADRs.

## Out of scope here

OWASP page laundry lists, framework middleware setup → stack packs + live docs.
