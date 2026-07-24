# OMP configuration (dotfiles-owned)

Nix installs only the `omp` binary. All OMP configuration, agents, commands,
extensions, and skills for this machine live here under `~/.dotfiles/omp` and
are linked into `~/.omp/agent` by `link.sh`.

## Link

```bash
~/.dotfiles/omp/link.sh
# or, for tests:
OMP_AGENT_DIR=/tmp/fake-agent ./link.sh
```

### Allowlist (live paths under `~/.omp/agent`)

| Path | Source |
|------|--------|
| `config.yml`, `AGENTS.md`, `mcp.json`, `agents/`, `commands/`, `extensions/`, `skills/` | this directory (`omp/`) |
| `AGENTS.shared.md`, `RTK.md` | `../agent-stack/` |

### Safety

- Never replaces `~/.omp` or `~/.omp/agent` itself
- Regular file conflicts → one-time backup `*.bak-omp-dotfiles`; second conflict with backup present → refuse
- Leaves `agent.db`, `auth.json`, `sessions/`, `cache/`, and unknown files untouched
- Missing tracked source → non-zero exit (no dangling link)
- Idempotent when links already point at the correct sources

## Contract

`compatibility.json` pins the verified OMP settings/SDK surface for the harness.
Run `bun test` in this directory after installing `omp`.

## Not here

Do not install Swarm, OMP TODO, Autolearn backends, Taskplane, or duplicate
subagent packs via this tree. Shared cross-agent policy stays in `agent-stack/`.
