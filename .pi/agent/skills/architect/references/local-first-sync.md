# Local-first & sync

Architecture for offline-capable clients and multi-device state. Not CRDT library tutorials.

## When

Notes, editors, field apps, multi-device UX where **local write** must succeed without network.

## Consistency chooser

| Model | UX | Conflict story | Ops cost |
|-------|-----|----------------|----------|
| Last-write-wins (LWW) | simple | silent loss possible | low |
| Field-level LWW | better | still lossy | low |
| CRDT / OT | merge-friendly | complexity in types | medium–high |
| Authoritative server | online-first | server wins | familiar |
| Manual conflict UI | honest | user resolves | product cost |

**Default:** start LWW or field-LWW until product proves merge value; don't CRDT the world for a todo list.

## Topology

```text
Device local store  ←→  sync engine  ←→  cloud / peer
        ↑                     ↑
   UI reads/writes      auth, queue, backoff
```

- Local store is source for UI reads
- Sync engine owns transport, retry, cursors/checkpoints
- Server may be relay, authority, or both — **say which**

## Hard requirements to decide early

1. **Identity of records** (UUIDs, device-scoped ids)
2. **Clock story** (hybrid logical clocks vs server timestamp)
3. **Deletion** (tombstones, GC)
4. **Attachment/blob** path (separate from doc sync)
5. **Partial sync** / filters (per tenant, per notebook)
6. **Security**: E2E encryption vs server-readable; key custody

## Conflict UX

If merge isn't automatic, design the **user-visible** conflict before picking fancy CRDTs. Architecture fails when sync is perfect and product is confused.

## Anti-patterns

- “Sync” as ad-hoc REST PUT of whole document without version/vector
- No tombstones + multi-device deletes
- Blocking UI on network round-trip while claiming local-first

## Related

- Multi-tenant cloud side: [references/multi-tenancy.md](references/multi-tenancy.md)
- Integration/retry: [references/integration-patterns.md](references/integration-patterns.md)
