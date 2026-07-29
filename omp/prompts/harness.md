# Internal harness controller prompt

This file is an **internal controller** prompt for the OMP goal harness. It is
**not** a user-facing slash command (no `commands/harness.md`).

Custom entry: **`/harness [text]`** (see extensions/commands binding in later tasks).
Native OMP `/goal` and `/guided-goal` stay untouched.

When invoked, load `skills/goal-harness/SKILL.md` and orchestrate phases with
live Superpowers skill reads — never vendored skill bodies.

Large producer yields (`agent://` plan/spec JSON over ~50 KiB): use session
`.md` path or `readAgentJsonFull` / range reassembly — never a single uncapped
`json.loads(read('agent://…'))` (OMP read head-truncates).

Gate revisions: **not mandatory**. Writer → reviewer once; rewrite only if
`ok: false` + blocking. Max attempts is a fail ceiling. Never auto-queue
Revision1/2/3 when the latest review already passed.
