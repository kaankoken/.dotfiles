---
name: bp-review-to-json
description: >
  Normalize Bigpowers audit-code / request-review findings into REVIEW-POLICY
  JSON { ok, feedback, blocking }. Default quality:normal (not full Santa Method).
---

# bp-review-to-json

**Policy:** ADR-0003.

## Profiles

### quality: normal (default)

1. Path-load Bigpowers `audit-code` — self-review first.
2. External review: one fresh reviewer agent and/or dynamic-workflows angle.
3. Always load **ponytail-review** (and **ponytail-audit** if multi-file/tree/milestone).
4. Optional: Bigpowers `request-review` as **guidance**, not mandatory dual-blind AND-gate.
5. Emit exactly:

```json
{
  "ok": true,
  "feedback": "…",
  "blocking": []
}
```

or `ok: false` with `blocking` as non-empty string array of must-fix items.

6. Gate PASS requires `ok: true` **and** fresh verify command evidence (see `verify-work` / task `verify:`).

### quality: strict

- Full Bigpowers `request-review` Santa Method allowed (dual-blind, thresholds, iteration cap).
- Still emit the same JSON summary for harness bookkeeping after the loop.

## Forbidden

- Claiming Santa AND-gate PASS under normal profile
- Loading Superpowers `requesting-code-review` / `receiving-code-review`
- Skipping ponytail-review on code-review / milestone paths
