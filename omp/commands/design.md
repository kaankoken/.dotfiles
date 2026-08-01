---
name: design
description: Empty shell — PDR/Arc42/ADR. Loads design-flow on invoke. Never auto-starts /harness.
---

# /design

**Empty shell.** Expand `$ARGUMENTS` as bound design goal (required; ask once if empty).

## On invoke only

1. Load live: `skill://using-superpowers`, `skill://design-flow`, `skill://brainstorming`.
2. Run `runDesignFlow` (`extensions/design-flow`) — PDR → Arc42 → ADR → handoff.
3. ADRs only under `docs/adr/`. No superpowers specs in git.
4. **Stop.** Do **not** start `/harness`, open feature PRs, or create implementer worktrees.
