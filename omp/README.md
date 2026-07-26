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

## Stage 3 parity (Pi goal-harness)

Before Pi removal / Stage 4 native hardening, prove parity:

```bash
cd ~/.dotfiles/omp   # or this tree
bun test tests/stage3-parity.test.ts
bash tests/smoke-stage3.sh
# optional live (providers authenticated):
OMP_LIVE_SMOKE=1 bash tests/smoke-stage3.sh
bunx tsc -p tsconfig.json --noEmit
```

`tests/stage3-parity.test.ts` asserts 19 roles, manifest fields, `/harness`
binding, scaffold-only `/init`, unshadowed `/goal`, research fan-out, human Spec
gate, budgets `3/3/2/3`, strict schemas, Beads hydrate restart, eight-lane
semaphore, integration order, model routing, and Milestone-blocks-PR.
Fixture project: `tests/fixtures/harness-project/`.

**Pi remains installed until Stage 3 + Stage 4 gates pass.**

## Stage 4 native acceptance (Pi removal eligibility)

After Stage 3, prove full OMP-native harness behavior before removing Pi:

```bash
cd ~/.dotfiles/omp   # or this tree
bun test tests/stage4-native.test.ts
bash tests/smoke-omp-harness.sh
bun test              # full suite
bash tests/link.test.sh
bash tests/shared-stack.test.sh
bunx tsc -p tsconfig.json --noEmit
# optional live (omp + providers authenticated):
OMP_LIVE_SMOKE=1 bash tests/smoke-omp-harness.sh
```

`tests/stage4-native.test.ts` extends Stage 3 with:

- live Superpowers skill resolution failures (missing/duplicate/unreadable/changed/claimed-only)
- Grok Hashline + high effort; LSP/AST typed fixtures; TokenSave-first code graph
- implementer RED/GREEN evidence + dual task reviews
- fresh verification on real integration worktree
- global `shake` + selective `snapcompact` / `context-full` policy
- Advisor cannot advance gates
- soft-sandbox positive/adversarial conformance
- harness spawn allowlist (no bundled sonic/scout/… spawns)
- zero foreign Pi workflow orchestration packages in runtime sources

**Only after Stage 4 PASS is Pi removal (Tasks 30–31) eligible.**

## Not here

Do not install extra orchestration packages, built-in TODO trackers, Autolearn
backends, or duplicate subagent packs via this tree. Shared cross-agent policy
stays in `agent-stack/`.

## Cross-repo smoke (from nixup)

```bash
DOTFILES_ROOT=/path/to/this/dotfiles bash /path/to/nixup/scripts/smoke-omp-migration.sh
```
