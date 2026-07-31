# OMP agent (dotfiles)

Shared cross-agent policy lives in **`../agent-stack/`** (`AGENTS.shared.md`,
`RTK.md`) and is linked into this agent dir by `link.sh`. Do not duplicate it
here.

## OMP-only deltas

- **Binary:** installed by Nix activation (`install-omp.sh`) only — not configured here.
- **Launch:** prefer `headroom wrap omp` (nushell `omp` alias wraps it; `omp-raw` skips proxy).
- **Subagent model label:** `task.showResolvedModelBadge: true` — TUI shows resolved model id on task/agent spawn rows.
- **Harness model routes** (`extensions/goal-harness/model-router.ts`): research = Grok high (deep-research)→Sol medium; milestone = Terra xhigh→Fable→Sol→Opus; PR = Grok→Terra xhigh→Sonnet; implement = Grok→Composer→Sol→Sonnet; big gates = Sol ultra→Fable max→Opus max.
- **Config:** `config.yml` in this tree → lean defaults (shake, no Autolearn, no built-in task list, memory off, hashline edits, **yolo** tool approval + **smart-approve** high-risk gate).
- **MCP:** allowlist in `mcp.json` — **cold:** `tokensave` only. `headroom` / `context-mode` / `context7` defined with `enabled: false` → `/mcp enable <name>` or `/mcp-stack` when needed.
- **Harness:** custom `/harness` (not native `/goal`); Superpowers skills loaded live by path — never vendored into prompts.
- **Design flow:** custom `/design` (pre-`/harness`) — PDR + Arc42 in bd/session; ADRs only under `docs/adr/`. Never auto-starts `/harness`. Skill `design-flow`. Models (`model-router`): PDR/ADR = Opus 5 max/xhigh → Terra 5.6 max → Sol 5.6 xhigh → Grok; Arc42 = Grok → Composer 2.5.
- **Skills cold start:** ultra-core Superpowers + harness + caveman/ponytail roots + thin `stack-*` routers. Domain packs and sub-skills load **on demand** (`/stack-*`, stack-scout, pack overlays).
- **MCP cold start:** tokensave only; `disabledServers` blocks foreign discovery (codebase-memory, chrome-devtools, node_repl, …). `tools.xdevDocs: catalog` keeps xd:// inventory short.
- **Link:** `./link.sh` wires allowlisted paths into `~/.omp/agent` without touching `auth.json` / sessions / cache.

See `compatibility.json` for the pinned runtime contract and `README.md` for link safety rules.
