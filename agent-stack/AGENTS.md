# Shared agent tooling (all agents)

Same stack for Claude Code, Codex, Cursor, Grok, pi, and anything new.
Do **not** invent a parallel workflow per agent.

**Ownership:** this file is the global source of truth in `.dotfiles/agent-stack/`.
Host paths (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, …) are **symlinks**
installed by `agent-stack/link.sh`. Packages/MCP installers live in **nix-setup**,
not here.

Tools are on PATH via Nix home packages + agent installers. Prefer them over
stock Unix / ad-hoc alternatives. Prefix shell with **`rtk`** (see `RTK.md`).

## Layers (use in this order of preference)

| Layer | Tool | How |
|-------|------|-----|
| Shell output | **RTK** | Prefix shell with `rtk` (or RTK hooks). See `RTK.md`. |
| Tasks / memory | **beads (`bd`)** | `bd ready`, `bd update --claim`, `bd close`. Not ad-hoc markdown TODOs when tracking matters. |
| Traffic compress | **headroom** | `headroom wrap claude\|codex\|cursor` when available. MCP: compress / retrieve. |
| Code structure | **tokensave only** | `tokensave_context`, search, callers, impact. **Never codebase-memory.** |
| Tool/MCP flood | **context-mode** | Large reads, logs, web → `ctx_execute` / sandbox. Prefer over raw MCP dumps. |
| Structural edits | **ast-grep** (`sg` alias) | AST search/rewrite over regex `sed`/`perl`. |
| External docs | **context7** | Library/API docs. Do not invent APIs. |
| Output brevity | **caveman** | Terse agent prose (`/caveman`). |
| Code minimalism | **ponytail** | YAGNI / reuse / stdlib-first code (`/ponytail`). Complements caveman. |

## Local CLI toolkit (prefer these)

**Agents must use these** instead of legacy equivalents when the job fits.

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
| GitHub | **`gh`** | raw api.github.com curl when `gh` covers it |
| Python tooling | **`uv`** | bare `pip`/`pipx` for tool installs |
| JS CLIs (this setup) | **`bun`** | system `node`/`npm` for packages we control |
| Rust checks | **`bacon`**, **`cargo nextest`** | long unfiltered test spam when nextest/bacon fit |
| Nix rebuild / search | **`nh`**, **`nom`** | noisier raw nix rebuild when `nh` works |
| Semantic structural diff | **`difft`** | huge unified diffs when structure matters |
| Editor | **`nvim`** | only when an editor is actually required |

### Discovery order (code)

1. **tokensave MCP** — symbols, callers, impact, context.
2. **`rg` / `fd` / `ast-grep`** — literals, paths, AST patterns tokensave cannot answer.
3. Targeted file reads — not whole-repo thrashing.
4. **Never** codebase-memory-mcp.

Prefer `rtk rg …` / `rtk fd …` / `rtk ast-grep …` so output stays compressed.

```bash
rtk rg -n 'TODO|FIXME' -g '!**/target/**'
rtk fd -e rs -e nix
rtk eza -la --git
rtk bat -n path/to/file.rs
rtk sd 'old_name' 'new_name' path/to/file.rs
rtk ast-grep -p 'PATTERN' -l rust
rtk jq '.dependencies' package.json
rtk dust -d 2 .
rtk procs
rtk gh pr view
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
```

Do not configure a second primary code-intelligence MCP alongside tokensave.
