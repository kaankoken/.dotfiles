# OMP Cold-Start + Intent Router — Bite-Sized Tasks

> **For implementers:** one worktree pass per bite. Follow the parent plan for full code/snippets.  
> **Parent plan:** `docs/plans/2026-07-31-omp-cold-start-intent-router.md`  
> **Design SoT:** `docs/superpowers/specs/2026-07-31-omp-cold-start-intent-router-design.md`  
> **Beads:** epic `dotfiles-3v6` · bite issue `dotfiles-6d4` · implement `dotfiles-8b5`  
> **Test runner:** `cd omp && bun test <file>`  
> **Pins (do not re-litigate):** no `commands/harness.md`, no `intent-dispatch.ts`, parity `agentCount` **19** (intent-router outside manifest).

## Sizing decision

Plan tasks 1–7 are already one-pass sized. **No split.** Map 1:1 to bites B1–B7.

| Concern | Decision |
|---------|----------|
| Task 2 multi-file caveman scrub | **Keep one bite** — single theme (purge product caveman), mechanical edits, one commit |
| Task 3 + 4 skill-existence coupling | **Keep separate** — B3 owns config/MCP/lean-config allowlists **without** requiring `skills/intent-router/SKILL.md` on disk; B4 creates skill/agent and owns existence probes + `allowedSkillMd` extension. Same branch; do not claim full suite green until B4 |
| Merge 3+4? | **No** — safer two commits; avoids bloating one pass with skill body + AGENTS rewrite |

## Bite map

| ID | Title | planTask | depends_on |
|----|-------|----------|------------|
| B1 | Caveman purge: role map + skill-loading tests | 1 | — |
| B2 | Caveman purge: manifests, agents, templates, packs | 2 | B1 |
| B3 | Lean cold config.yml + mcp.json + lean-config tests | 3 | B2 |
| B4 | intent-router skill + agent + AGENTS + entry-assets | 4 | B3 |
| B5 | `/code-review` + mcp-stack + stack-* command docs | 5 | B4 |
| B6 | domain-packs GCP comment + README + residual greps | 6 | B5 |
| B7 | Final verification suite | 7 | B6 |

```text
B1 → B2 → B3 → B4 → B5 → B6 → B7
```

---

## B1 — Caveman purge: role map + skill-loading tests

| Field | Value |
|-------|--------|
| **id** | `B1` |
| **title** | Caveman purge: role map + skill-loading tests |
| **planTask** | 1 |
| **depends_on** | `[]` |
| **Design** | §7, §8 |

**Files:**
- Modify: `omp/extensions/goal-harness/skills.ts` (`REQUIRED_SKILLS_BY_ROLE`)
- Modify: `omp/tests/skill-loading.test.ts`
- Modify: `omp/tests/stack-skills.test.ts`

**Scope (one pass):**
1. Update skill-loading / stack-skills expectations: drop `caveman`, keep `ponytail`.
2. Assert `REQUIRED_SKILLS_BY_ROLE` has zero `caveman` entries.
3. Remove `"caveman"` from: `spec-producer`, `plan-producer`, `bitesize-producer`, `implementer`, `task-fixer`.
4. Multi-root collision fixture named `caveman` → rename to `dup-skill` (or comment “fixture, not product skill”).

**Out of scope:** design-manifest, agent md, packs, templates, config.yml (those are B2/B3).

**Test command:**
```bash
cd omp && bun test tests/skill-loading.test.ts tests/stack-skills.test.ts
```

**Done when:**
- [ ] No role in `REQUIRED_SKILLS_BY_ROLE` lists `caveman`
- [ ] `ponytail` still on producers/implementers/task-fixer as in plan
- [ ] Both test files PASS
- [ ] Commit: `refactor(omp): drop caveman from REQUIRED_SKILLS_BY_ROLE`

**Plan detail:** parent plan Task 1 (full test/impl snippets).

---

## B2 — Caveman purge: manifests, agents, templates, packs

| Field | Value |
|-------|--------|
| **id** | `B2` |
| **title** | Caveman purge: manifests, agents, templates, packs |
| **planTask** | 2 |
| **depends_on** | `["B1"]` |
| **Design** | §7 |

**Files:**
- Modify: `omp/agents/design-manifest.json`
- Modify: `omp/agents/spec-writer.md`, `implementer.md`, `pdr-writer.md`, `arc42-writer.md`, `adr-writer.md`, `project-init.md`
- Modify: `omp/skills/goal-harness/SKILL.md`, `omp/skills/design-flow/SKILL.md`
- Modify: `omp/extensions/goal-harness/project-init.ts`
- Modify: `omp/templates/project/AGENTS.md.tmpl`, `subdir-AGENTS.md.tmpl`
- Modify: `omp/configs/pack-rust.yml`, `pack-ios.yml`, `pack-android.yml`
- Modify: tests hosting new asserts (prefer `omp/tests/design-ponytail-wiring.test.ts` or extend `skill-loading.test.ts`)

**Do not touch:** `omp/agents/parity-manifest.json` / `agentCount`.

**Scope (one pass):**
1. Add failing asserts: design-manifest zero caveman; packs/templates omit caveman; goal-harness/design-flow default mandates omit caveman, keep ponytail.
2. Strip caveman from design-manifest requiredSkills, agent md name-drops, SKILL default lines, project-init Prefer list, templates, pack overlay `includeSkills` (`caveman`, `caveman-*`, `cavecrew`).
3. Pack overlays stay **full-session** catalogs (keep Superpowers / goal-harness / ponytail / stack routers).

**Test command:**
```bash
cd omp && bun test tests/design-ponytail-wiring.test.ts tests/design-manifest.test.ts tests/skill-loading.test.ts tests/project-init.test.ts tests/entry-assets.test.ts
```

**Manual grep (must be clean for product paths):**
```bash
rg -n '\bcaveman\b' omp/agents omp/skills/goal-harness omp/skills/design-flow omp/templates omp/configs omp/extensions/goal-harness/skills.ts omp/extensions/goal-harness/project-init.ts
```
Expected: no product-required hits (tests may still use the word as a negative assert).

**Done when:**
- [ ] design-manifest + packs + templates + skill defaults + project-init Prefer: zero required caveman
- [ ] ponytail retained where plan specifies
- [ ] Tests above PASS; residual product rg clean
- [ ] Commit: `refactor(omp): purge caveman from agents, packs, and templates`

**Plan detail:** parent plan Task 2.

---

## B3 — Lean cold config.yml + mcp.json + lean-config tests

| Field | Value |
|-------|--------|
| **id** | `B3` |
| **title** | Lean cold config.yml + mcp.json + lean-config tests |
| **planTask** | 3 |
| **depends_on** | `["B2"]` |
| **Design** | §5, §12 |

**Files:**
- Modify: `omp/tests/lean-config.test.ts` (**first** — TDD)
- Modify: `omp/config.yml`
- Modify: `omp/mcp.json`

**Scope (one pass):**
1. Rewrite lean-config MCP test: headroom + context-mode `enabled: true`; context7 `enabled: false`; tokensave cold; disabledServers keepouts.
2. customDirectories: drop caveman marketplace root; keep superpowers + agents + omp skills + pack roots; assert no path contains `caveman`.
3. `includeSkills` exact (order-insensitive): `intent-router`, `beads` only + forbidden cold list (Superpowers names, goal-harness, design-flow, caveman/ponytail/stack-*, domain globs).
4. Pack overlays still expand Superpowers/goal-harness and must **not** list caveman (post-B2).
5. Apply matching `config.yml` + `mcp.json` edits.

### Footgun: intent-router skill not on disk yet

| Rule | Detail |
|------|--------|
| **B3 MUST NOT** | Assert `existsSync(omp/skills/intent-router/SKILL.md)` or fail the suite on missing skill body |
| **B3 MAY** | List `intent-router` in `includeSkills` config + lean-config exact allowlist |
| **B3 SHOULD** | Leave `allowedSkillMd` regex as-today **or** only extend it in B4 when the file exists |
| **B4 owns** | Skill/agent creation, existence probes, `allowedSkillMd` + `omp/agent/skills` intent-router probe |
| **Full suite** | Not claimed green until B4 on the same branch |

Do **not** create a placeholder `SKILL.md` in B3 (YAGNI stub). Config may reference the skill name before the file exists; parse/allowlist tests do not need the body.

**Out of scope:** `omp/AGENTS.md` rewrite, skill/agent bodies, entry-assets intent asserts (B4).

**Test command:**
```bash
cd omp && bun test tests/lean-config.test.ts
```
Expected: PASS for MCP + includeSkills + customDirectories **without** intent-router file existence.

**Done when:**
- [ ] `includeSkills` sorts to `["beads","intent-router"]`
- [ ] No caveman in customDirectories
- [ ] MCP cold flags match design §5.3
- [ ] No B3 test requires intent-router skill file on disk
- [ ] Commit: `feat(omp): lean cold includeSkills and enable headroom/context-mode`

**Plan detail:** parent plan Task 3.

---

## B4 — intent-router skill + agent + AGENTS + entry-assets

| Field | Value |
|-------|--------|
| **id** | `B4` |
| **title** | intent-router skill + agent + AGENTS + entry-assets |
| **planTask** | 4 |
| **depends_on** | `["B3"]` |
| **Design** | §4, §5.4 |

**Files:**
- Create: `omp/skills/intent-router/SKILL.md`
- Create: `omp/agents/intent-router.md`
- Modify: `omp/AGENTS.md` (cold-contract rewrite)
- Modify: `omp/tests/entry-assets.test.ts`
- Modify: `omp/tests/lean-config.test.ts` (`allowedSkillMd` + optional intent-router probe only)

**Parity:** Do **not** add `intent-router` to `parity-manifest.json`. `agentCount` stays **19**.

**Scope (one pass):**
1. Failing entry-assets tests: skill+agent exist; route ids `harness|design|init|review_pr|code_review|stack|mcp|local|ambiguous`; dispatch/builder names; double-start rule; no `intent-dispatch.ts`; no caveman; no `commands/harness.md`; AGENTS freeform + lean cold claims; parity-outside-19 guard.
2. Create skill + thin agent from plan Task 4 snippets (full taxonomy + dispatch table).
3. Rewrite `omp/AGENTS.md` per plan cold session + freeform routing contract.
4. Extend lean-config `allowedSkillMd` for `intent-router`; add existence/probe asserts that B3 deferred.

**Out of scope:** `/code-review` command file (B5); README/domain-packs (B6); NLP classifier code; `intent-dispatch.ts`; `commands/harness.md`.

**Test command:**
```bash
cd omp && bun test tests/entry-assets.test.ts tests/lean-config.test.ts tests/agent-parity.test.ts tests/design-manifest.test.ts
```
Expected: PASS; `agentCount` 19; intent-router md exists outside manifest.

**Done when:**
- [ ] Skill + agent on disk with §4.3 route ids and dispatch/double-start text
- [ ] AGENTS documents freeform routing + lean cold MCP/skills
- [ ] lean-config existence/`allowedSkillMd` green with real skill file
- [ ] No harness.md; no intent-router in parity 19
- [ ] Commit: `feat(omp): add intent-router skill/agent and lean AGENTS contract`

**Plan detail:** parent plan Task 4 (full markdown bodies).

---

## B5 — `/code-review` + mcp-stack + stack-* command docs

| Field | Value |
|-------|--------|
| **id** | `B5` |
| **title** | `/code-review` + mcp-stack + stack-* command docs |
| **planTask** | 5 |
| **depends_on** | `["B4"]` |
| **Design** | §6 |

**Files:**
- Create: `omp/commands/code-review.md`
- Modify: `omp/commands/mcp-stack.md`
- Modify: `omp/commands/stack-rust.md`, `stack-ios.md`, `stack-android.md`
- Modify: `omp/commands/init.md`, `design.md` only if caveman/superpowers-cold claims remain
- Modify: `omp/tests/entry-assets.test.ts` (code-review / stack / mcp-stack asserts)

**Scope (one pass):**
1. Tests: code-review → `code-reviewer` not WF7; stack commands do not claim “router always cold-listed”; mcp-stack documents cold headroom/context-mode + opt-in context7.
2. Add thin `/code-review` shell per plan.
3. Rewrite mcp-stack cold story; fix stack-* wording to on-demand.
4. **Do not** create `commands/harness.md`.

**Test command:**
```bash
cd omp && bun test tests/entry-assets.test.ts tests/harness-command.test.ts tests/lean-config.test.ts
```

**Done when:**
- [ ] `commands/code-review.md` exists; maps to code-reviewer + REVIEW-POLICY/ponytail-review; not WF7
- [ ] stack-* / mcp-stack docs match lean cold reality
- [ ] harness still extension-only; no harness.md
- [ ] Commit: `feat(omp): add /code-review shell and fix on-demand command docs`

**Plan detail:** parent plan Task 5.

---

## B6 — domain-packs GCP comment + README + residual greps

| Field | Value |
|-------|--------|
| **id** | `B6` |
| **title** | domain-packs GCP comment + README + residual greps |
| **planTask** | 6 |
| **depends_on** | `["B5"]` |
| **Design** | §9, §16 |

**Files:**
- Modify: `omp/extensions/goal-harness/domain-packs.ts` (header + deferred GCP comment only)
- Modify: `omp/README.md`
- Modify: `omp/tests/domain-packs.test.ts` (and lean/entry asserts if needed)
- Grep cleanup residual OMP product docs claiming old cold catalog

**Scope (one pass):**
1. Tests: DomainPackId remains rust|ios|android; deferred GCP/Future comment present; no `DOMAIN_PACKS.gcp =`; cold header does not claim stack routers cold-listed; README mentions intent-router/beads/headroom/context-mode, no caveman.
2. Header rewrite + README table update per plan.
3. Residual product greps clean (tests may keep negative assert strings).

**Do not:** implement GCP pack, stack-gcp command, or gut pack overlays to intent-router-only.

**Test command:**
```bash
cd omp && bun test tests/domain-packs.test.ts tests/lean-config.test.ts tests/entry-assets.test.ts
```

**Residual greps:**
```bash
rg -n '\bcaveman\b' omp --glob '!**/node_modules/**' --glob '!**/tests/**'
rg -n 'ultra-core Superpowers|router always cold-listed|cold-loads tokensave only' omp
rg -n 'intent-dispatch\.ts|commands/harness\.md' omp
```

**Done when:**
- [ ] domain-packs documents deferred GCP without implementing it
- [ ] README cold catalog matches lean allowlist
- [ ] Residual product greps clean
- [ ] Commit: `docs(omp): align README and domain-packs with lean cold start`

**Plan detail:** parent plan Task 6.

---

## B7 — Final verification suite

| Field | Value |
|-------|--------|
| **id** | `B7` |
| **title** | Final verification suite |
| **planTask** | 7 |
| **depends_on** | `["B6"]` |
| **Design** | §14 |

**Files:** none new. Fix **only** regressions discovered (no new features).

**Scope (one pass):**
1. Targeted suite (exact list below).
2. Parity + native harness invariants.
3. Design §14 acceptance greps / bun -e checks from parent plan Task 7.
4. Optional `integration.test.ts` if time — not a substitute for step 1.
5. Commit **only if** fixes were required; no empty commit.

**Test command (primary):**
```bash
cd omp && bun test \
  tests/lean-config.test.ts \
  tests/skill-loading.test.ts \
  tests/stack-skills.test.ts \
  tests/entry-assets.test.ts \
  tests/domain-packs.test.ts \
  tests/agent-parity.test.ts \
  tests/design-manifest.test.ts \
  tests/design-ponytail-wiring.test.ts \
  tests/harness-command.test.ts \
  tests/project-init.test.ts \
  tests/compatibility.test.ts
```

**Parity / native:**
```bash
cd omp && bun test tests/stage3-parity.test.ts tests/stage4-native.test.ts
```

**Done when:**
- [ ] Primary suite PASS
- [ ] `agentCount` 19; intent-router not in parity agents[]; native `/goal` unshadowed; harness extension-only
- [ ] §14 checklist greps from parent plan Task 7 pass (includeSkills exact, MCP flags, assets present, no harness.md, no DOMAIN_PACKS.gcp, zero caveman on role surfaces)
- [ ] Pins intact: no harness.md, no intent-dispatch.ts, parity 19
- [ ] Handoff notes: implement complete under epic `dotfiles-3v6`; run `omp/link.sh` after merge; restart omp sessions

**Plan detail:** parent plan Task 7 + Design §14 acceptance mapping.

---

## Pins checklist (every bite)

| Pin | Rule |
|-----|------|
| Cold `includeSkills` | Exactly `intent-router`, `beads` (after B3+) |
| Cold MCP | tokensave + headroom + context-mode on; context7 off |
| Freeform dispatch | skill://intent-router + AGENTS only — no extension middleware |
| `commands/harness.md` | **SKIP** |
| `intent-dispatch.ts` | **SKIP** |
| NLP classifier tests | **SKIP** |
| Parity `agentCount` | **19** — never add intent-router to manifest |
| GCP pack | Comment only (B6) |

## YAGNI

Do not invent bites for: pre-model message hooks, keyword classifiers, android GCP distill, agent-stack host caveman purge outside `omp/`, WF7 core changes, native `/goal` registration.

## Implementer notes

1. Work on an isolated branch/worktree; do not half-edit cold config on main without tests.
2. TDD order inside each bite: failing test → fail → minimal impl → pass → commit.
3. B3→B4: same branch sequential; B3 green ≠ full product green.
4. Freeform dispatch is LLM-followed skill text — tests assert allowlists/assets/builders, never classification accuracy.
5. Full snippets and commit messages live in the parent plan; this file is the bite map + acceptance cards only.
