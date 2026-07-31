---
name: code-review
description: Local/branch/diff multi-angle code review via code-reviewer. Not PR dual-agent review.
---

# /code-review

Local milestone-style review. Expand `$ARGUMENTS` as scope (paths, branch, "staged", summary of intent).

## Not this command

- GitHub PR dual-agent review → use **`/pr-reviewer`** (extension controller; agents `pr-*`).
- Multi-step build → `/harness`.

## Skills / agent

Load live:

- `agents/code-reviewer.md` (role prompt + JSON output contract)
- `requesting-code-review`
- `ponytail-review` (every review)
- `ponytail-audit` when scope is multi-file / whole-tree / milestone
- Stack skills only if markers require them

Do **not** load `receiving-code-review` in the reviewer role.

## Do this now

1. Resolve review scope from `$ARGUMENTS` (default: current diff / changed files).
2. Spawn or act as `code-reviewer` with tools `[bash, read, search]`.
3. Follow `agents/REVIEW-POLICY.md` (default PASS; blocking only for real defects).
4. Return JSON:

```json
{ "ok": true, "feedback": "summary; nits ok", "blocking": [] }
```

## Stop

After the JSON review result, **stop**. Do not implement fixes unless the user explicitly asks in a follow-up (that follow-up is a new intent, often `local` or `harness`).
