---
name: init
description: Empty shell — project scaffold only. Loads project-init on invoke.
---

# /init

**Empty shell.** Expand `$ARGUMENTS` as optional scope.

## On invoke only

1. Load `agents/project-init.md` / `runProjectInit` (`extensions/goal-harness/project-init.ts`).
2. Scaffold AGENTS/CLAUDE; safe bd init only if missing (`--prefix`, no `--remote`).
3. **Stop.** No Spec/Plan/Implement/PR. No `/harness`. Do not shadow `/goal`.
