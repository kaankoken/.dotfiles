# Pi setup and orchestration

## Current audit — 2026-09-12

Live tree: `~/.pi/agent` → `~/.dotfiles/.pi/agent`.
Host checked: Pi 0.85.1, Bun 1.4.2. Current session: `openai-codex/gpt-6-astra`.

The [September shared review](https://chatgpt.com/share/6aa532d9-dcfc-83ed-ad1a-53398d0bb624) was recovered from its embedded page data. It says fixes were committed in **two local repositories**, but GitHub publishing failed with `403: Resource not accessible by integration`. A downloaded bundle is not an installed fix.

The live workflow checkout and settings still select `15a1361a215bb2c32053fe92af024112fc24db61`, the reviewed pre-fix runtime. The Downloads bundle could not be inspected because filesystem access was denied. Its exact contents and commit IDs remain unverified here.

### Fixed in this pass

- Test discovery: `bun test tests` used to discover dependency suites under `git/`, not just local tests. Those suites can mutate live workflow settings. `bunfig.toml` now confines discovery to `tests/`; the recommended command also uses explicit file paths. The fake model tiers written during reproduction were restored to the original tracked bytes. Subsequent checks verified model tiers and workflow settings stayed unchanged.
- Generated harness instructions: replaced obsolete 3-character/hash-bounds edit contracts with current 4-character anchors, `remove_from`/`remove_to`/`replacement_lines`, and `undo_last_change`. Removed requirements for unavailable background/fusion tools.
- Busy commands: rejected `/design` and architecture commands no longer replace an active harness before checking whether the session is idle.
- Harness evidence: failed workflow results cannot advance gates; implementation evidence must satisfy the existing JSON schema; milestones require explicit `goalComplete` rather than treating omission as completion.
- PR script syntax: retained escaped newlines in generated JavaScript with `String.raw`. Regression checks run the installed workflow parser and compile its returned body without calling providers.
- Instructions: corrected missing skill paths, the optional intent-router agent, package/version claims, MCP inventory, and absent approval-gate claims. Added a scoped-source fallback for unusable graph results.

### Still open — do not treat these as fixed

1. **Workflow runtime:** installed runner still disables host extensions, does not execute role `route:` chains, and treats worktree isolation as best-effort. Listing hashline/web tools in a role does not deliver their implementations. Truncated worktree names can collide. Import and validate the prepared runtime fixes before relying on delegated editing or isolation.
2. **PR protocol:** schema/nonce/reference validation, safe freeze reuse, moving-head consistency, and full model fallback still need the coordinated prior patch. Current `{}` acceptance and `Boolean(judge)` are not proof of a valid review. **Do not use automated PR publishing until those checks are fixed.**
3. **Graph health:** Tokensave reports the correct dotfiles root but only one indexed file, 16 stale commits at audit time, and unrelated symbols; database size is about 24 GiB. No destructive rebuild or database deletion was attempted. Do not trust this index for impact analysis until repaired.
4. **Security:** neither `smart-approve` nor `pi-background-tasks` is enabled. Tool allowlists and worktrees are not security sandboxes. Use a restricted environment for untrusted repositories/extensions.
5. **End-to-end proof:** no paid multi-agent/provider run, TUI interaction test, or GitHub publish was performed. Harness also consumes assistant text as evidence; its phase guards are not an independent attestation system. The existing bd golden-path task remains relevant.

Run the prior bundle's own application/validation instructions after moving it to an accessible workspace folder. Review both patches against current changes; do not blindly overwrite the agent tree. Keep the runtime source change, built `dist/pi-extension.js`, agent definitions, and package pin coordinated. Do not set a remote Git pin to a commit that has not been published.

## Verification

Audit result: **57 local tests passed, 0 failed**; static/runtime methodology gates passed; model-tier and workflow-settings checksums unchanged after guarded test runs. Remaining work: bd `dotfiles-4yv` (runtime/PR fixes), `dotfiles-6re` (graph repair).

From the agent directory:

```sh
cd ~/.pi/agent
bun test ./tests/*.test.ts
bash scripts/assert-no-superpowers.sh
bun ~/.bun/bin/pi --offline --list-models
```

Local suite includes role contracts, command/FSM behavior, generated PR syntax, and setup regressions. Model listing checks catalog/load availability, not successful authentication or requests against every provider. Biome LSP found no errors in changed production files/new setup tests; style warnings remain in existing code. No full TypeScript build was configured or claimed.

Never run third-party test suites with the live HOME. Use their supported test runner in a disposable environment; changing HOME inside Bun is not sufficient evidence of isolation.

## Use Astra as orchestrator

**Today:** use this parent session for direct inspection, fixes, and verification. Repair the runtime gaps above before enabling delegated editing. No extra orchestrator package is needed.

**After runtime repair:** use Astra to scope work, divide responsibilities, resolve disagreements, and accept evidence. Use narrow scouts for retrieval, one implementer per disjoint change, and a fresh reviewer. Keep **bd** as the durable task record and one parent as the integrator.

| Need | Entry point |
|------|-------------|
| Small fix | Direct request; no workflow overhead |
| Architecture decision | `/architect <question>` |
| Design before code | `/design <goal>` |
| Full build with spec/plan approval | `/harness <goal>`, then `go` at each of its two gates |
| Independent parallel investigation | Explicitly request a workflow; bound agent count and scope |
| Resume | Read `bd ready` / issue evidence; inspect saved workflow state rather than starting duplicate work |

**Controllers:** default parent, `/harness` (`/goal-harness`), `/design`, `/architect`, `/architect-layered`, and `research-orchestrator` now prefer `openai-codex/gpt-6-astra:xhigh`. Flow commands explicitly select the controller model before starting; they do not inherit a previously selected specialist model. Shared chain remains named `harness-research` in `workflows/model-routes.json`. Existing Grok → Terra availability/auth fallbacks remain and emit warnings; no available authenticated model means no new run. Writers, reviewers, scouts, and model tiers are unchanged.

Controller-routing follow-up: **60 local tests passed**, including all five command names, effort selection, and failed authentication preserving an active run. Use `/reload` to activate the updated command handlers; new sessions use the updated default settings.

Named role model pins override small/medium/big tiers. Explicit workflow `model` overrides the role pin. Your `small` tier is Grok at xhigh, not a guarantee of low cost. `pr-terra-judge` currently uses Opus; its name does not describe its actual model, and the PR script shares its model list with the Opus reviewer.

Example request after the runtime fixes:

> Run a workflow for <goal>. Keep Astra as parent. Use at most three read-only scouts for code, tests, and dependencies. Record findings in bd. Assign disjoint files to implementers; use worktrees and stop if isolation fails. Run fresh verification and one independent review. Return changed files, commands, results, and remaining risks. No commits, package installs, pushes, or PR publishing without my approval.

Good escalation targets for Astra: complex planning, root-cause debugging, cross-module synthesis, disputed review findings. Benchmark a few representative tasks before routing every scout to it. Supply token/time caps when wanted; they are not evidence of task completion.

## Clean-machine order

1. Install Bun, Node, Git, stow, and required project CLIs. Preserve credentials separately; never commit auth files.
2. From `~/.dotfiles`, use the existing stow setup; verify `~/.pi` resolves to this tree. Do not create a second agent-tree copy.
3. Install the Pi host and packages selected by `settings.json` using their documented installers. Keep pinned Git commits available remotely. Do not bulk-upgrade during restore.
4. Verify `~/.pi/workflows/model-tiers.json` points to `../agent/workflows/model-tiers.json`.
5. Authenticate with `/login`, run the checks above, then perform a small controlled provider smoke test before using parallel editing.

Use `/reload` after owned extension/context edits. Restart after package/MCP changes. Reload clears the in-memory harness FSM, so record bd progress first.
