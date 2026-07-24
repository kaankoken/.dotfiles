# agent-stack

Global agent instruction files for **Claude Code, Codex, Cursor, Grok, Pi, Oh My Pi**.

Not managed by Nix. Packages/MCP installers stay in **nix-setup**; prose rules + RTK hooks live here.

## Layout

| File | Role |
|------|------|
| `AGENTS.md` | Shared stack (tokensave, modern CLI toolkit, RTK, beads, skills) |
| `RTK.md` | RTK + modern CLI contract (bare modern tools allowed) |
| `claude.CLAUDE.md` | Personal prefs + `@AGENTS.shared.md` + `@RTK.md` |
| `codex.AGENTS.md` | Shared stack + beads block |
| `grok.Agents.md` | Shared stack include |
| `home.AGENTS.md` | `~/AGENTS.md` for home-walking hosts |
| `cursor.shared-stack.mdc` | alwaysApply Cursor rule |
| `hooks/rtk-shell-rewrite.sh` | PreToolUse rewrite (Grok + reusable) |
| `hooks/grok-rtk.json` | Grok hook registration |
| `hooks/rtk-pi-extension.ts` | Pi / Oh My Pi `rtk rewrite` extension |
| `link.sh` | Install/refresh symlinks + RTK vendor hooks |

## Install / refresh

```bash
~/.dotfiles/agent-stack/link.sh
# skip vendor rtk init:
~/.dotfiles/agent-stack/link.sh --no-rtk-init
```

Idempotent. Replaces host files with symlinks; first replacement is backed up as `*.bak-agent-stack`.

What `link.sh` does:

1. Symlinks instructions into Claude, Codex, Grok, Cursor, `~/AGENTS.md`, `~/.agents/`.
2. Links `RTK.md` (+ `AGENTS.shared.md`) into `~/.pi/agent` and `~/.omp/agent` (creates omp dir if missing).
3. Installs Grok PreToolUse hook → `rtk rewrite`.
4. Runs `rtk init -g` for Claude / Cursor / Pi (hook registration).
5. Re-asserts our `RTK.md` symlinks if vendor init wrote a plain file.

## After `bd setup codex`

`bd setup` may rewrite `~/.codex/AGENTS.md`. Re-run `link.sh` to restore the symlink.

## Policy (summary)

- Prefer modern CLI: `rg` `fd` `eza` `bat` `sd` `dust` `procs` `ast-grep`/`sg` `jq` `zoxide`.
- Prefer `rtk …` for compression when available.
- **Bare modern tools are allowed** (no mandatory `rtk` prefix on those binaries).
- Legacy `cat`/`grep`/`find`/… get rewritten by hooks where the host supports it.
