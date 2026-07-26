# OMP agent (dotfiles)

Shared cross-agent policy lives in **`../agent-stack/`** (`AGENTS.shared.md`,
`RTK.md`) and is linked into this agent dir by `link.sh`. Do not duplicate it
here.

## OMP-only deltas

- **Binary:** installed by Nix activation (`install-omp.sh`) only — not configured here.
- **Config:** `config.yml` in this tree → lean defaults (shake, no Autolearn, no built-in task list, memory off, always-ask).
- **MCP:** only `tokensave`, `headroom`, `context-mode`, `context7` (`mcp.json`).
- **Harness:** custom `/harness` (not native `/goal`); Superpowers skills loaded live by path — never vendored into prompts.
- **Link:** `./link.sh` wires allowlisted paths into `~/.omp/agent` without touching `auth.json` / sessions / cache.

See `compatibility.json` for the pinned runtime contract and `README.md` for link safety rules.
