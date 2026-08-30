# Pi agent

Global instructions. Live dir is `~/.pi/agent` (`~/.pi` → `~/.dotfiles/.pi`).

## Always-on extensions / packages

| Piece | Role | Model sees it as |
|-------|------|------------------|
| `extensions/rtk.ts` | GNU→brew then `rtk rewrite` on bash + ctx_execute shell + ctx_batch_execute | Invisible. Prefer **bash** for CLIs so it fires |
| `npm:pi-hashline-edit-pro` | Anchor `read` / `replace` / `insert` / `grep`; disables built-in `edit` | Those tools |
| `npm:pi-caveman` | `/caveman` — terse output. Default **full** | Injected when on |
| `npm:@dietrichgebert/ponytail` | `/ponytail` — YAGNI ladder. Default **full** | Injected when on |
| `npm:pi-mcp-adapter` + tokensave | Code graph MCP, keep-alive | `mcp` / `mcp__tokensave` |
| `skills/graphify` | Architecture / corpus graph | Skill — load it, then `graphify query` |
| `npm:context-mode` | `ctx_*` tools (extension only; skill catalog stripped) | Large-output processing, not default shell |

Hard routing lives in `APPEND_SYSTEM.md`. This file is the human-readable map.

## CLI replacements (brew)

Never GNU if a replacement is on PATH. Canonical brew set: **bat, eza, fd, fzf, rg, sd, dust, procs, git-delta** (`delta`).

| Don't | Use | Auto-swap |
|-------|-----|-----------|
| `grep` / `egrep` / `fgrep` | `rg` | yes → `rtk rg` |
| `ls` | `eza` | yes (`rtk ls` → `eza`) |
| `cat` / `less` / `more` | hashline `read` (edit) or `bat -P` (dump) | yes → `bat -P` |
| `du` / `du -sh` | `dust` | yes |
| `ps` / `ps aux` / `ps -ef` | `procs` | yes |
| `find` | `fd` | no — flags differ, type `fd` |
| `sed` | `sd` | no — flags differ, type `sd` |
| `diff` | `rtk diff` (agent) | git pager already `delta` |
| `git` / `gh` | via bash | yes — `rtk git` / `rtk gh` |

Never TUI from the agent: `fzf`, `lazygit`, `hx`, `zellij`.

## Code intel

- **tokensave** = live symbol graph (callers, impact, edits). Start with `tokensave_context`.
- **graphify** = architecture/corpus graph. Path-load the skill; need `graphify-out/graph.json`.
- **hashline** = file read/edit. Anchors from `read`/`grep` go into `replace`/`insert`.
- Do not invent a fourth memory system.

## Commands

- `/caveman [lite\|full\|ultra\|off]`
- `/ponytail [lite\|full\|ultra\|off\|status]`
- `/mcp` — tokensave should show connected, not merely cached
- `/reload` after editing this file, `APPEND_SYSTEM.md`, `mcp.json`, or `extensions/rtk.ts`
