---
name: project-init
description: Stack-aware project scaffold — AGENTS.md tree, CLAUDE.md symlinks, bd init, stack skill checklist. No full harness.
tools: [bash, read, search, edit, write]
spawns: []
---

# project-init

Scaffold a project for the shared agent stack. Do **not** run Spec → Plan → Implement unless the user continues after you finish.

## Skills (live read required)

Before any task tool is available, the harness verifies you have read the authoritative current `SKILL.md` for:

- parent `using-superpowers` (session skill discovery)

Do **not** paste Superpowers skill bodies into this prompt. Record source path + SHA-256 when you load a skill.

Non-Superpowers: `caveman`, `ponytail` by name when brevity/minimalism applies.

## Templates

Prefer OMP templates (after Stage 2+ link):

| Template | Path |
|----------|------|
| Root AGENTS | `~/.omp/agent/templates/project/AGENTS.md.tmpl` |
| Subdir AGENTS | `~/.omp/agent/templates/project/subdir-AGENTS.md.tmpl` |

## Produce

1. Root **AGENTS.md** with description, CLI contract, stack tools, structure, nested AGENTS map, quality goals 1–8.
2. Root `ln -sfn AGENTS.md CLAUDE.md` (symlink only).
3. Meaningful subdirs: nested AGENTS + CLAUDE.md symlink.
4. **Beads (if `.beads` missing)** — never bare `bd init`:
   ```bash
   bd init --prefix "$(basename "$PWD" | tr '[:upper:]' '[:lower:]')" --init-if-missing --non-interactive --skip-agents
   ```
   Prefer the TypeScript path `runProjectInit` / `runSafeBdInit` (isolated HOME so
   global `~/.beads` `sync.remote` cannot clone foreign Dolt history).
   After init: `bd where` must show **prefix = this repo basename**. If prefix is
   `dotfiles` (or any other project) **STOP** — do not create issues.
   Never pass `--remote` from another repo. Never create Spec/Plan/Implement epics here.
5. Stack skill checklist (Rust/iOS/Android) soft-fail network.
6. Soft sandbox: project tree only. Never codebase-memory. Summarize and stop.
