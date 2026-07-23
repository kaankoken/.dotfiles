# agent-stack

Global agent instruction files for **Claude Code, Codex, Cursor, Grok, pi**.

Not managed by Nix. Packages/MCP installers stay in **nix-setup**; prose rules live here.

## Layout

| File | Role |
|------|------|
| `AGENTS.md` | Shared stack (tokensave, local CLI toolkit, RTK, beads, skills) |
| `RTK.md` | Shell prefix rules |
| `claude.CLAUDE.md` | Personal prefs + `@AGENTS.md` + `@RTK.md` |
| `codex.AGENTS.md` | Shared stack + beads block |
| `grok.Agents.md` | Shared stack include |
| `home.AGENTS.md` | `~/AGENTS.md` for home-walking hosts |
| `cursor.shared-stack.mdc` | alwaysApply Cursor rule |
| `link.sh` | Install/refresh symlinks into `$HOME` |

## Install / refresh

```bash
~/.dotfiles/agent-stack/link.sh
```

Idempotent. Replaces host files with symlinks; first replacement is backed up as `*.bak-agent-stack`.

## After `bd setup codex`

`bd setup` may rewrite `~/.codex/AGENTS.md`. Re-run `link.sh` to restore the symlink.

## Includes

Host wrappers use same-directory `@AGENTS.md` / `@RTK.md`. `link.sh` places those
names next to each host file (or points CLAUDE.md into this directory via symlink
so Claude resolves includes against `agent-stack/`).
