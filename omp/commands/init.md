---
name: init
description: Scaffold project AGENTS tree, CLAUDE.md symlinks, bd init. No Spec/Plan/Implement.
---

# /init

Scaffold-only entry. Expand `$ARGUMENTS` as optional project description/scope.

## Deterministic layer

Call `runProjectInit` from `extensions/goal-harness/project-init.ts` (or the
`project-init` agent wrapping it) against the active repository root.

- Infer description from README / `$ARGUMENTS`; otherwise **ask for scope**.
- Write/merge root + nested `AGENTS.md`, `CLAUDE.md` symlinks.
- Exclude `.git`, worktrees, vendor/deps, build/cache.
- Beads only when `.beads` missing — **never bare `bd init`**:
  `bd init --prefix <repo-basename> --init-if-missing --non-interactive --skip-agents`
  (or `runSafeBdInit` / `buildSafeBdInitArgs`). After init, `bd where` prefix must
  match the repo; refuse foreign bootstrap (`Bootstrapped from remote` / prefix
  mismatch). Never `--remote` from another project.
- Record stack skill requirements + worktree convention + ponytail (nixup toolchain).

## Stop

After scaffold completes, **stop**. Do **not**:

- create Spec / Plan / Implement / Milestone / PR issues
- start `/harness` phases
- shadow OMP native `/goal` or `/guided-goal`

