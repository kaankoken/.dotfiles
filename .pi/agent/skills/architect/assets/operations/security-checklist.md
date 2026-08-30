# Security checklist (architecture)

Companion to [references/security-architecture.md](references/security-architecture.md).

## Boundaries

- [ ] Trust boundaries drawn on container diagram
- [ ] Each external ingress has AuthN story
- [ ] Service-to-service identity defined (or consciously same-trust-network)

## Data

- [ ] Data classes identified (public → restricted)
- [ ] Encryption in transit everywhere outside localhost-dev
- [ ] Encryption at rest for confidential+ with key owner named
- [ ] PII fields listed; log redaction policy exists

## AuthZ

- [ ] Deny by default
- [ ] Resource checks in owning service
- [ ] Tenant id from verified principal (if multi-tenant)
- [ ] Admin/break-glass path separate + audited

## Secrets & supply

- [ ] No long-lived secrets in git/images
- [ ] Runtime injection path named
- [ ] Egress destinations for third parties known

## Abuse & availability

- [ ] Rate limits at edge
- [ ] Costly endpoints protected (export, search, AI)
- [ ] STRIDE-lite done on top 3 boundaries

## Audit

- [ ] Security-relevant events logged with actor + tenant + request id
