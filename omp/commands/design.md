---
name: design
description: Empty shell — PDR/Arc42/ADR. Loads design-flow on invoke. Never auto-starts /harness.
---

# /design

**Empty shell.** Expand `$ARGUMENTS` as bound design goal (required; ask once if empty).

## On invoke only

1. Load by **path** (cold catalog is only intent-router+beads — not `skill://` for these):
   - `~/.agents/skills/superpowers/using-superpowers/SKILL.md`
   - `~/.omp/agent/skills/design-flow/SKILL.md`
   - `~/.agents/skills/superpowers/brainstorming/SKILL.md`
2. Run `runDesignFlow` (`extensions/design-flow`) — PDR → Arc42 → ADR → handoff.
3. ADRs only under `docs/adr/`. No superpowers specs in git.
4. **Stop.** Do **not** start `/harness`, open feature PRs, or create implementer worktrees.
