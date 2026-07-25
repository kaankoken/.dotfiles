---
name: init
description: Scaffold project AGENTS tree, CLAUDE.md symlinks, bd init. No Spec/Plan/Implement.
---

# /init

Scaffold-only entry. Expand `$ARGUMENTS` as optional project description/scope, then delegate **only** to the `project-init` agent.

Do **not**:

- start Spec, Plan, Implement, Milestone, or PR phases
- shadow OMP native `/goal` or `/guided-goal`
- run the full goal harness

After scaffold completes, stop and report what was written.
