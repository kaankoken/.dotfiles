# Internal harness controller prompt

This file is an **internal controller** prompt for the OMP goal harness. It is
**not** a user-facing slash command (no `commands/harness.md`).

Custom entry: **`/harness [text]`** (see extensions/commands binding in later tasks).
Native OMP `/goal` and `/guided-goal` stay untouched.

When invoked, load `skills/goal-harness/SKILL.md` and orchestrate phases with
live Superpowers skill reads — never vendored skill bodies.
