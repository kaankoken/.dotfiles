# RTK + modern CLI contract (all agents)

**RTK** (Rust Token Killer) compresses shell output before it hits the model.
**Modern CLI toolkit** is what you run *under* RTK (or bare when needed).

Hosts: **Claude Code · Codex · Grok · Cursor · Oh My Pi (`omp`)**.

---

## Policy (hard rules)

1. **Use the modern toolkit** for the jobs below. Do not reach for stock Unix when a modern binary fits.
2. **Prefer `rtk <cmd>`** when RTK has a filter (smaller context). Hooks rewrite many legacy commands automatically.
3. **Bare modern tools are allowed** — `rg`, `fd`, `eza`, `bat`, `sd`, `dust`, `procs`, `ast-grep`/`sg`, `jq`, `zoxide` without an `rtk` prefix are **OK**. Use bare when the host/tool needs unfiltered output, RTK has no subcommand, or a pipeline/agent integration breaks under rewrite.
4. **Escape hatches:** `rtk proxy <cmd>` (track, no filter), `RTK_DISABLED=1` (hooks skip rewrite).

---

## Modern CLI toolkit (Nix home)

| Job | Prefer (modern) | Avoid (legacy) | RTK note |
|-----|-----------------|----------------|----------|
| Content search | **`rg`** | `grep -r` | `rtk rg` preferred; bare `rg` OK |
| File names | **`fd`** | `find` (unless find-only predicates) | bare `fd` OK (no RTK filter) |
| Directory list | **`eza`** | plain `ls` when you need tree/long/git | bare `eza` OK; hooks may rewrite bare `ls` → `rtk ls` |
| File preview | **`bat`** | `cat` / `less` for source | bare `bat` OK; hooks may rewrite `cat` → `rtk read` |
| String replace | **`sd`** | `sed -i` for simple s/old/new | bare `sd` OK |
| Disk usage | **`dust`** | `du -sh` | bare `dust` OK; hooks may rewrite `du` → `rtk du` |
| Processes | **`procs`** | `ps aux` | bare `procs` OK; hooks may rewrite `ps` → `rtk ps` |
| AST search/edit | **`ast-grep`** / **`sg`** | multi-file `sed`/`perl` on code structure | bare OK |
| JSON | **`jq`** | hand-rolled parsers | bare `jq` OK |
| Jump / cd | **`zoxide`** (`z`) | hunting paths by hand | bare OK |

Also common with RTK filters: `git`, `cargo`, `gh`, tests, builds — always fine as `rtk …`.

### Examples

```bash
# Preferred: modern tool + rtk when filtered
rtk rg -n 'TODO|FIXME' -g '!**/target/**'
rtk git status
rtk cargo nextest run

# Bare modern — allowed (no rtk prefix required)
rg -n 'pattern' src/
fd -e rs
eza -la --git
bat -n path/to/file.rs
sd 'old' 'new' path/to/file.rs
dust -d 2 .
procs
ast-grep -p 'PATTERN' -l rust   # or: sg -p 'PATTERN' -l rust
jq '.dependencies' package.json
zoxide query foo

# Escape hatches
rtk proxy cargo test -- --nocapture
RTK_DISABLED=1 some-script-that-parses-raw-output
```

### What hooks rewrite (typical)

| Agent command | Often becomes |
|---------------|---------------|
| `cat file` | `rtk read file` |
| `grep …` | `rtk grep …` (prefer writing **`rg`** yourself) |
| `ls …` | `rtk ls …` (prefer writing **`eza`** yourself) |
| `find …` | `rtk find …` (prefer writing **`fd`** yourself) |
| `rg …` | `rtk rg …` |
| `git status` | `rtk git status` |
| already `rtk …` / bare `bat`/`fd`/`eza`/… | unchanged |

Hooks fail open: if rewrite fails, the original command still runs.

---

## Meta RTK commands

```bash
rtk gain              # savings analytics
rtk gain --history
rtk discover          # missed opportunities (where supported)
rtk proxy <cmd>       # raw output + tracking
rtk rewrite '<cmd>'   # dry-run what a hook would do
rtk hook check '<cmd>'
```

> **Name collision:** crates.io also has an unrelated `rtk`. If `rtk gain` fails, reinstall from https://github.com/rtk-ai/rtk (or nix-setup agents module).

---

## Per-host wiring

| Host | Instructions | Shell rewrite |
|------|--------------|---------------|
| **Claude Code** | `~/.claude/CLAUDE.md` → `@AGENTS.shared.md` + `@RTK.md` | `rtk hook claude` in `settings.json` PreToolUse |
| **Cursor** | `~/.cursor/rules/shared-agent-stack.mdc` | `rtk hook cursor` in `hooks.json` |
| **Codex** | `~/.codex/AGENTS.md` + `RTK.md` | no native rewrite — follow this file; bare modern OK |
| **Grok** | `~/.grok/Agents.md` + Claude-compat hooks | `~/.grok/hooks/rtk-shell.json` (+ Claude `settings` scan) |
| **Oh My Pi** | `~/.omp/agent/` | `RTK.md` + `extensions/rtk.ts` → `rtk-omp-extension.ts` |

Refresh instruction symlinks + hooks:

```bash
~/.dotfiles/agent-stack/link.sh
```

Install / refresh RTK **hooks only** (do not let `rtk init` overwrite this RTK.md):

```bash
rtk init -g --auto-patch --hook-only
rtk init -g --agent cursor --auto-patch --hook-only
```

---

## Verification

```bash
rtk --version && rtk gain
rtk rewrite 'cat foo'     # → rtk read foo
rtk rewrite 'rg pattern'  # → rtk rg pattern
rtk rewrite 'bat foo'     # empty / no rewrite → bare bat OK
command -v rg fd eza bat sd dust procs ast-grep sg jq zoxide
```
