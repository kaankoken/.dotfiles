---
name: intent-router
description: >
  Cold-session freeform intent classifier. Routes user text into existing
  OMP flows (harness/design/init/pr-reviewer/code-review/stack/mcp) or stays
  local. Not a second orchestrator.
---

# Intent router

Cold-start skill. Load on freeform turns when no slash command and no active
harness/design/PR controller binding.

## When this skill applies

1. User message has **no** leading slash command.
2. Session is **not** already inside an active `goal-harness-start`,
   `design-flow-start`, or `PR REVIEW CONTROLLER` turn.
3. Not inside implementer/task-fixer lanes (those roles use their own maps).

If (2) is true: treat the message as steering for the active flow — **do not**
re-route or start a second controller.

## Classification output

Decide a route (mentally or as a single short JSON line), then **act once**:

```json
{
  "route": "harness|design|init|review_pr|code_review|stack|mcp|local|ambiguous",
  "boundGoal": "string",
  "stackId": "rust|ios|android|null",
  "prTarget": "string|null",
  "confidence": "high|low"
}
```

`boundGoal` = user message trimmed (verbatim). Do not invent a second goal.
`stackId: gcp` is reserved/not installed → explain pack missing or ask; do not fake skills.

## Taxonomy (route ids)

| route | Meaning |
|-------|---------|
| `harness` | Multi-step feature/bugfix-with-process / "build X" |
| `design` | Design-only (PDR/Arc42/ADR), explicitly not build |
| `init` | Scaffold AGENTS/CLAUDE/bd |
| `review_pr` | GitHub PR by URL / `owner/repo#n` / number |
| `code_review` | Local diff/branch/milestone multi-angle review (not PR dual-review) |
| `stack` | Explicit language pack work |
| `mcp` | Need docs MCP / enable stack MCP |
| `local` | Q&A, small edit, explain, one-file fix |
| `ambiguous` | Cannot choose confidently |

### Precedence (first match wins)

1. Explicit PR target shape → `review_pr`
2. Explicit design-only / PDR / Arc42 / ADR without implement → `design`
3. Explicit scaffold/init agents → `init`
4. Explicit pack name → `stack`
5. Multi-step build/fix with verification → `harness`
6. Review my diff/branch without PR → `code_review`
7. Otherwise → `local`

### Anti-patterns

- Do not route every coding question to `harness`.
- Do not route "what does this function do?" to `design`.
- Do not start `harness` and `design` together.
- Prefer `local` when unsure between local and harness unless multi-step process is clear.
- Low confidence → `ambiguous` (one clarifying question), not a guess start.

## Dispatch table (same semantics as slash)

Primary path: **follow this table**. Prefer invoking the same start builders /
user-equivalent slash the extensions already expose. There is **no** separate
intent-dispatch middleware module and **no** second harness registration.

| route | Action |
|-------|--------|
| `harness` | Same as `/harness`: `handleHarnessCommand(boundGoal)` → one `sendMessage` of `buildStartMessage` / `{ kind: "goal-harness-start", ... }` with `{ triggerTurn: true }`. If the model cannot call the extension API, emit user-equivalent `/harness <boundGoal>` once. |
| `design` | `buildDesignStartMessage(boundGoal)` → design start send, or `/design <boundGoal>`. |
| `init` | Follow `commands/init.md` / `runProjectInit` — no Spec/Plan issues. |
| `review_pr` | Same as `/pr-reviewer`: require parseable target; `buildReviewPrControllerMessage({ target, dryRun })` → sendMessage. Missing target → ask once. |
| `code_review` | Follow `commands/code-review.md` → `agents/code-reviewer.md` + live skills there. **Not** PR dual-review. |
| `stack` | Follow matching `commands/stack-{rust,ios,android}.md`; load entry skills by absolute path. |
| `mcp` | Point at `/mcp-stack` / `/mcp enable context7` (headroom+context-mode already cold). |
| `local` | Answer with cold tools only (tokensave, rtk, headroom, context-mode, bd). May ad-hoc `read skill://ponytail` if user wants minimal code — still not cold-listed. |
| `ambiguous` | Ask **one** clarifying question; stop; do not start a flow. |

## Double-start guard

- At most one of `{goal-harness-start, design-flow-start, PR REVIEW CONTROLLER}` active per session thread.
- Mid-harness freeform = harness steering, not new intent.
- Slash `/harness` while harness active: existing harness behavior; do not parallel-start.

## Optional spawn

Agent `omp/agents/intent-router.md` may be spawned for long/ambiguous turns with
read-only bias tools `[bash, read, search]`. Happy-path short prompts: session
default model applies this skill directly — spawn not required.

## Out of scope

- Native `/goal` / `/guided-goal` (never shadow).
- Creating `commands/harness.md`.
- NLP keyword classifier code or accuracy tests.
- Auto-chaining `/design` → `/harness`.
