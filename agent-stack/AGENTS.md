# Shared agent tooling (all agents)

Same stack for **Claude Code, Codex, Cursor, Grok, Pi, Oh My Pi**, and anything new.
Do **not** invent a parallel workflow per agent.

**Ownership:** this file is the global source of truth in `.dotfiles/agent-stack/`.
Host paths (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, …) are **symlinks**
installed by `agent-stack/link.sh`. Packages/MCP installers live in **nix-setup**,
not here.

Tools are on PATH via Nix home packages + agent installers. Prefer them over
stock Unix / ad-hoc alternatives. Shell compression: **`rtk`** (see `RTK.md`).

## Layers (use in this order of preference)

| Layer | Tool | How |
|-------|------|-----|
| Shell output | **RTK** | Prefix with `rtk` when useful, or rely on host hooks. **Bare modern CLIs allowed.** See `RTK.md`. |
| Tasks / memory | **beads (`bd`)** | `bd ready`, `bd update --claim`, `bd close`. Not ad-hoc markdown TODOs when tracking matters. |
| Traffic compress | **headroom** | `headroom wrap claude\|codex\|cursor\|omp` when available. MCP: compress / retrieve. |
| Code structure | **tokensave only** | `tokensave_context`, search, callers, impact. **Never codebase-memory.** |
| Tool/MCP flood | **context-mode** | Large reads, logs, web → `ctx_execute` / sandbox. Prefer over raw MCP dumps. |
| Structural edits | **ast-grep** (`sg` alias) | AST search/rewrite over regex `sed`/`perl`. |
| External docs | **context7** | Library/API docs. Do not invent APIs. |
| Output brevity | **caveman** | Terse agent prose (`/caveman`). |
| Code minimalism | **ponytail** | YAGNI / reuse / stdlib-first code (`/ponytail`). Complements caveman. |

## Local CLI toolkit (prefer these)

Installed by Nix (`modules/common`). **Agents must use these** instead of legacy
equivalents when the job fits.

### Core set (wire with RTK; bare OK)

`rg` · `fd` · `eza` · `bat` · `sd` · `dust` · `procs` · `ast-grep`/`sg` · `jq` · `zoxide`

| Job | Prefer | Avoid |
|-----|--------|--------|
| Content search | **`rg`** | `grep -r` |
| File name search | **`fd`** | `find` (unless find-only predicates) |
| Directory listing | **`eza`** | plain `ls` when you need tree/long/git metadata |
| File preview | **`bat`** | `cat`/`less` for source |
| Simple string replace | **`sd`** | `sed -i` for straightforward s/old/new |
| AST / structural code edits | **`ast-grep`** or **`sg`** | multi-file `sed`/`perl` on code structure |
| Disk usage | **`dust`** | `du -sh` |
| Process list | **`procs`** | `ps aux` |
| JSON | **`jq`** | hand-rolled parsers |
| Directory jump | **`zoxide`** | blind path guessing |
| GitHub | **`gh`** | raw api.github.com curl when `gh` covers it |
| Python tooling | **`uv`** | bare `pip`/`pipx` for tool installs |
| JS CLIs (this setup) | **`bun`** | system `node`/`npm` for packages we control |
| Rust checks | **`bacon`**, **`cargo nextest`** | long unfiltered test spam when nextest/bacon fit |
| Nix rebuild / search | **`nh`**, **`nom`** | noisier raw nix rebuild when `nh` works |
| Semantic structural diff | **`difft`** | huge unified diffs when structure matters |
| Editor | **`nvim`** | only when an editor is actually required |

### RTK vs bare

- Prefer **`rtk rg`**, **`rtk git`**, **`rtk cargo …`** when you want compressed tool output.
- **Bare** `rg` / `fd` / `eza` / `bat` / `sd` / `dust` / `procs` / `sg` / `jq` / `zoxide` is **allowed** — required when the agent or pipeline needs non-RTK behavior.
- Do **not** use legacy `cat`/`grep`/`find`/`sed -i`/`du`/`ps` just because you omit `rtk`.

### Discovery order (code)

1. **tokensave MCP** — symbols, callers, impact, context.
2. **`rg` / `fd` / `ast-grep`** — literals, paths, AST patterns tokensave cannot answer.
3. Targeted file reads — not whole-repo thrashing.
4. **Never** codebase-memory-mcp.

```bash
rtk rg -n 'TODO|FIXME' -g '!**/target/**'
rtk fd -e rs -e nix
eza -la --git
bat -n path/to/file.rs
sd 'old_name' 'new_name' path/to/file.rs
ast-grep -p 'PATTERN' -l rust
jq '.dependencies' package.json
dust -d 2 .
procs
```

### Git UX (already wired in gitconfig)

- Diff: **difftastic** (`difft`) / **delta** where configured.
- Merge: **mergiraf** where configured.
- History rewrite (rare): **git-filter-repo** — only with explicit human intent.

Do not reconfigure git from agent sessions unless asked.

## Tokensave is the only code graph

- Prefer tokensave over Explore agents, raw `grep` for **symbol** lookup, and full-file thrashing.
- `rg`/`fd` remain required for literals, paths, non-indexed trees.
- Missing index: `tokensave init` then `tokensave sync`.
- **Do not use codebase-memory-mcp.**

## Shell

```bash
rtk git status
rtk cargo test
rtk cargo clippy
rtk cargo nextest run
rtk proxy <cmd>   # escape hatch: full output + tracking
```

Human default shell is **nushell**; agents may use bash/sh. Prefer modern binaries either way.

## Skills

| Skill | Shrinks | Invoke |
|-------|---------|--------|
| **caveman** | Agent **prose** | `/caveman [lite\|full\|ultra]` |
| **ponytail** | Generated **code** | `/ponytail [lite\|full\|ultra\|off]` |

Use both. Not alternatives.

## Headroom

```bash
headroom wrap claude
headroom wrap codex
headroom wrap omp    # Oh My Pi when installed
```

Do not configure a second primary code-intelligence MCP alongside tokensave.

## Refresh wiring

```bash
~/.dotfiles/agent-stack/link.sh
```
