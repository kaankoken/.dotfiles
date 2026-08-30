# Integration patterns (sync & edge)

Complements EDA/CQRS in [references/data-architecture-patterns.md](references/data-architecture-patterns.md) and [assets/patterns/event-driven-template.md](assets/patterns/event-driven-template.md). Use when services call each other or the outside world **synchronously**.

## Pattern chooser

| Need | Pattern | Notes |
|------|---------|-------|
| UI/BFF aggregates many backends | **BFF** | One client-facing API; hide fan-out |
| Mobile/web needs stable façade | **API gateway + BFF** | Gateway = cross-cutting; BFF = product-shaped |
| Exactly-once *effect* after DB write | **Outbox** | DB transaction + publisher relay |
| At-least-once delivery | **Idempotent consumers** | Idempotency keys / natural keys |
| External system pushes to us | **Webhooks** | Verify signature, queue ASAP, retry semantics |
| We push to external | **Outbound with retry + DLQ** | Backoff, poison handling |
| Avoid chatty cross-service reads | **Cache / read model** | Or async projection — don't N+1 RPCs |

## Request/response (sync)

- Timeouts on **every** outbound call (budget from user SLO)
- Retries only for **idempotent** ops or with idempotency key
- Circuit breaker / bulkhead for unstable deps
- Explicit error taxonomy: retryable vs permanent vs auth

Prefer **fewer sync hops** on the user critical path. If chain depth > 2–3, reconsider async or a read model.

## Outbox (dual-write safe)

```text
1. Begin txn
2. Write business row(s)
3. Write outbox row (payload, headers, key)
4. Commit
5. Relay publishes to bus; marks outbox sent
```

Do **not** “write DB then publish” without outbox/inbox — you will double-send or lose events.

## Idempotency

| Side | Mechanism |
|------|-----------|
| HTTP writes | `Idempotency-Key` stored with response |
| Consumers | Dedupe table / unique constraint on event id |
| Sagas | Step tokens; never bare “increment counter” twice |

## Webhooks inbound

1. Verify signature/timestamp (reject skew)
2. Persist raw envelope quickly (or queue)
3. Return 2xx fast; process async
4. Make handler idempotent (provider retries)

## BFF rules

- BFF owns **client experience** mapping, not core domain authority
- Domain invariants stay in domain services
- Don't let BFF become a second monolith of business rules without ownership

## Anti-patterns

- Distributed transactions across services without saga/outbox story
- Infinite retry without jitter/DLQ
- Trusting webhook body without auth
- Sync call chains that exceed latency budget

## Related

- Mesh/gateway: [references/api-gateway-service-mesh.md](references/api-gateway-service-mesh.md)
- Failure modes: [assets/operations/failure-modes-checklist.md](assets/operations/failure-modes-checklist.md)
