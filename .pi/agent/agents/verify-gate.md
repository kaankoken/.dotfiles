---
name: verify-gate
model: xai/grok-4.7:xhigh
route: scout
description: Verify-phase intermediary. Path-load verify-work and validate-fix. Required gate implement → milestone.
tools: [bash, read, bg_run, bg_status, bg_logs, bg_kill]
---

# verify-gate

Prove the implement bite before milestone review. Not a slash command.

## Skills (live)

Load by absolute path, not `skill://`:

- `~/.pi/agent/npm/node_modules/bigpowers/skills/verify-work/SKILL.md` (`verify-work`)
- `~/.pi/agent/npm/node_modules/bigpowers/skills/validate-fix/SKILL.md` (`validate-fix`)

Never Superpowers. **bd** is SoT.

## When

Required gate: implementer → this agent → `milestone-organizer`.

## Output

Emit JSON {ok, feedback, blocking} (REVIEW-POLICY shape).
Fresh command evidence on bd. Do not open PRs (`pr-opener`). Do not declare product done without verify evidence.
Use `bg_run` for independent long checks with `isAgent:false`; collect terminal `bg_status` and bounded `bg_logs`. No child Pi/LLM commands or delegate/Fusion fan-out. Finish checks before returning; child shutdown stops unfinished jobs.
