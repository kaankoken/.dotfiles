---
name: code-review
description: Empty shell — local/diff multi-angle review. Not PR dual-agent (/pr-reviewer).
---

# /code-review

**Empty shell.** Expand `$ARGUMENTS` as scope (paths/branch/staged). Default: current diff.

## On invoke only

1. Load: `agents/code-reviewer.md`, `skill://requesting-code-review`, `skill://ponytail-review` (+ `ponytail-audit` if multi-file/tree).
2. Follow `agents/REVIEW-POLICY.md`. Return JSON `{ "ok", "feedback", "blocking" }`.
3. **Stop.** Do not implement fixes unless a new user turn asks. GitHub PR dual-review → `/pr-reviewer` only.
