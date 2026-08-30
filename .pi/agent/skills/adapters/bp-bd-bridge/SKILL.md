---
name: bp-bd-bridge
description: >
  Bridge Bigpowers optional specs/ cockpit to beads (bd) primary task SoT.
  Use on Pi harness Init/resume and whenever a Bigpowers skill wants specs/state.yaml.
---

# bp-bd-bridge

**Policy:** ADR-0002 — **bd is primary**. `specs/` is optional secondary.

## Rules

1. Always `bd where` first. Foreign prefix → STOP.
2. Durable work = **bd issues** (epic + bites). Never invent a second task list only in YAML.
3. If project has **no** `specs/` directory:
   - Do not create a full Bigpowers epic capsule tree by default.
   - Satisfy planning/resume via bd issue bodies + session notes.
   - Create minimal `specs/` **only** if a Bigpowers skill hard-fails without it **and** the user/project opts in.
4. If `specs/` **exists**:
   - Maintain bridge file `specs/pi-bridge.yaml` (create if missing):

```yaml
# specs/pi-bridge.yaml — bd ↔ Bigpowers cockpit bridge
bd_prefix: "<from bd where>"
bd_epic_id: "<active epic id or empty>"
harness_run_id: "<optional>"
handoff_next_skill: "<optional phase hint>"
updated_at: "<ISO-8601>"
```

5. If both `specs/state.yaml` and bd exist, **bd wins** on task status; update bridge fields to match bd, not the reverse.
6. Never open parallel unlinked trackers for the same goal (bd epic + full BP release-plan as two sources of truth).

## Resume

- Prefer `bd ready` / open epic issues.
- If `specs/state.yaml` has `handoff.next_skill`, treat as **hint only**; confirm against bd before acting.
- Path-load Bigpowers `survey-context` only after bridge rules above.
