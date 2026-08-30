---
name: bp-plan-to-bd
description: >
  Adapt Bigpowers plan-work / scope-work / slice-tasks discipline so outputs
  land as bd issues with verify: commands. Use on Pi Plan and BiteSize phases.
---

# bp-plan-to-bd

**Policy:** ADR-0002 + design B-hybrid.

## When loaded

After path-loading Bigpowers `scope-work`, `slice-tasks`, `plan-work`, optional `assess-impact`.

## Output contract (overrides pure YAML epic capsules)

1. Create/update **bd** issues — not only `specs/epics/**`.
2. Every bite/task issue body **must** include a line:

```text
verify: <runnable command>
```

3. Prefer small vertical bites (one focused worktree when parallel).
4. Optional: if `specs/` exists and user wants cockpit, mirror titles into epic YAML — still link ids in `specs/pi-bridge.yaml`.
5. Do not mark tasks passing at plan time; status stays open until verify exits 0 during implement.

## Forbidden

- Plans that live only under `docs/plans/` or Superpowers paths as SoT
- Tasks without runnable `verify:`
- Dual unlinked BP release-plan + bd epic for the same goal
