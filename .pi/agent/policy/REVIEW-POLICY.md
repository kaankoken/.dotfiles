# Harness review policy (blocking vs nits)

Applies to **every** harness reviewer (`spec-reviewer`, `plan-reviewer`,
`bite-size-reviewer`, `code-reviewer`, and any parallel review angle).

## Decision rule

**Default to PASS:** `{ "ok": true, "feedback": "…", "blocking": [] }`.

Set `ok: false` **only** when at least one **blocking** class below applies.
If unsure → put it in `feedback` as a **nit** and keep `ok: true`.

Nits never force a producer rewrite. Only non-empty `blocking` with `ok: false`
triggers a revision (budget is a fail ceiling, not a quota).

## Blocking (only these)

Each `blocking[]` item must be a **concrete fix instruction** for one producer pass.

1. **Wrong / contradictory** — conflicts with the bound goal, an already-approved
   artifact (spec/plan), or itself in a material way.
2. **Impossible to implement** — missing required inputs, no real paths/surfaces,
   depends on systems that do not exist and are not in scope to build.
3. **Unsafe** — credential/secret exposure, data-loss risk, force-push / destroy
   main without recovery, unbounded destructive ops with no rollback story.
4. **Unverifiable core claim** — acceptance that literally cannot be checked at
   all (not “would prefer more automated proof”).
5. **Broken ordering / hard dependency gap** — step B needs A’s output but A is
   missing, after B, or cyclic in a way that blocks first implementation.

## Never blocking (nits → `feedback` only)

Keep `ok: true` and `blocking: []` for all of these:

- Missing exhaustive evidence / fixtures / digests / Playwright / browser-contract
  **before** primary product work exists or has a first green path
- “Could be more thorough”, “add more cases”, “prefer more scouts/research”
- Style, naming, docs, comment polish
- Process theater (extra phases, more agents, more review rounds)
- Task-count aesthetics when tasks remain coherent and implementable
- Optional tooling polish when a manual or lighter verification path exists
- Nice-to-have follow-ups that do not block first green implementation
- Preference for more proof when the plan already defers evidence correctly

## Defer-evidence rule

When the goal is primarily product, UI, feature, or site work:

- Specs/plans that **do product work first** and **defer** heavy evidence /
  proof factories until after first green are **correct**.
- Do **not** fail a review for lacking exhaustive proof scaffolding early.
- Prefer: implement → smoke → then optional evidence hardening.

When the goal is **explicitly** “frozen contract / evidence only”, proof depth
may be in scope — still prefer `ok: true` + nits unless the contract is
unimplementable or unsafe.

## Output discipline

```json
{ "ok": true, "feedback": "short note; nits as bullets ok", "blocking": [] }
```

| Field | Rule |
|-------|------|
| `ok: true` | `blocking` **must** be `[]`. All suggestions live in `feedback`. |
| `ok: false` | `blocking` **must** be non-empty; every item actionable once. |
| Ambiguity | PASS with nits. Do not fail to “raise the bar.” |
| Revisions | Do not invent RevisionN when the artifact is already implementable. |

## Anti-patterns (forbidden)

- Failing because “evidence suite incomplete” while product work has not started
- Failing to force another revision loop when the plan is already shippable
- Putting soft preferences in `blocking[]`
- `ok: true` with non-empty `blocking` (invalid)
- `ok: false` with empty `blocking` (invalid)
