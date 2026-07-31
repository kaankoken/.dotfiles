# OMP Cold-Start + Intent Router Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Shrink OMP cold start to `intent-router` + `beads` (no Superpowers/caveman/stack cold catalog), enable cold MCP headroom+context-mode, and route freeform turns via skill+AGENTS into existing slash/start builders.

**Architecture:** Cold session is a thin classifier/worker. Freeform messages follow `skill://intent-router` + rewritten `omp/AGENTS.md` and dispatch once into the same start paths slash handlers already use (`handleHarnessCommand` / `buildStartMessage`, `buildDesignStartMessage`, `buildReviewPrControllerMessage`, `/init`, new `/code-review`, `/stack-*`, `/mcp-stack`). No extension middleware, no `commands/harness.md`, no `intent-dispatch.ts` by default. Caveman is fully purged from OMP-required surfaces; ponytail stays on-demand. `intent-router` agent is outside the parity-manifest 19-count pack.

**Tech Stack:** Oh My Pi agent tree under `omp/` (Bun tests), YAML `config.yml`, JSON `mcp.json`, markdown skills/agents/commands, TypeScript goal-harness/design-flow/pr-review extensions.

**Design SoT:** `docs/superpowers/specs/2026-07-31-omp-cold-start-intent-router-design.md`  
**Beads:** epic `dotfiles-3v6` · plan `dotfiles-yl4`  
**Test runner:** `cd omp && bun test <file>`  
**Worktree:** implement on an isolated branch/worktree; do not half-edit cold config on main without tests.

**Pinned product decisions (do not re-litigate):**

| Pin | Choice |
|-----|--------|
| Cold `includeSkills` | Exactly `intent-router`, `beads` (order flexible) |
| Cold MCP | tokensave + headroom + context-mode **enabled**; context7 `enabled: false` |
| Freeform dispatch | Session model loads `skill://intent-router`; primary action = follow skill dispatch table (prefer same start semantics / user-equivalent slash). **No** new extension middleware. |
| Double-start guard | AGENTS.md + intent-router skill only (no code guard helper) |
| `commands/harness.md` | **SKIP** (entry-assets already forbids it; extension-only `/harness`) |
| `intent-dispatch.ts` | **SKIP** default (only if implementer proves duplicated builders — YAGNI says no) |
| NLP / classifier unit tests | **None** |
| Parity `agentCount` | **Stay 19** — do **not** add `intent-router` to `parity-manifest.json` |
| GCP pack | Deferred comment in `domain-packs.ts` / README only |

**Route ids (design §4.3 — use these exact enums in skill/AGENTS, not mermaid labels):**

`harness` | `design` | `init` | `review_pr` | `code_review` | `stack` | `mcp` | `local` | `ambiguous`

**Builders to reuse by name (do not fork payloads):**

- `handleHarnessCommand` / `buildStartMessage` — `omp/extensions/goal-harness/index.ts`, `omp/workflows/goal-harness.ts`
- `buildDesignStartMessage` — `omp/workflows/design-flow.ts`
- `buildReviewPrControllerMessage` — `omp/extensions/pr-review/command.ts`
- `/init` → `runProjectInit` — `omp/extensions/goal-harness/project-init.ts`

---

## Task map (execution order)

| Task | Theme | Design § |
|------|--------|----------|
| 1 | Caveman purge: role map + skill-loading/stack-skills tests | §7, §8 |
| 2 | Caveman purge: manifests, agents, templates, pack ymls, default goals | §7 |
| 3 | Cold config.yml + mcp.json + lean-config tests (TDD) | §5, §12 |
| 4 | intent-router skill + agent + AGENTS rewrite + entry-assets tests | §4, §5.4 |
| 5 | `/code-review` + mcp-stack + stack-* + init/design minor | §6 |
| 6 | domain-packs GCP comment + README + residual greps | §9, §16 |
| 7 | Final verification suite | §14 |

Each task is one implementer pass (worktree-sized). Commit at end of each task.

---

### Task 1: Caveman purge — role map + skill-loading tests

**Files:**
- Modify: `omp/extensions/goal-harness/skills.ts` (`REQUIRED_SKILLS_BY_ROLE`)
- Modify: `omp/tests/skill-loading.test.ts`
- Modify: `omp/tests/stack-skills.test.ts`
- Test: `omp/tests/skill-loading.test.ts`, `omp/tests/stack-skills.test.ts`

**Step 1: Write the failing test (update expectations first)**

In `omp/tests/skill-loading.test.ts`, change role attestation fixtures so they **no longer** seed or expect `caveman`:

```ts
// Spec producer required skills — replace caveman roots/expects
test("Spec producer required skills", () => {
  const roots = rootsWith(
    "brainstorming",
    "receiving-code-review",
    "ponytail",
  );
  const session = attestAndUnlock({
    role: "spec-producer",
    skillRoots: roots,
    roleTools: ["write", "read"],
  });
  expect(session.briefs.map((b) => b.name).sort()).toEqual(
    ["brainstorming", "ponytail", "receiving-code-review"].sort(),
  );
});

test("Plan producer required skills", () => {
  const roots = rootsWith(
    "writing-plans",
    "receiving-code-review",
    "ponytail",
  );
  const session = attestAndUnlock({
    role: "plan-producer",
    skillRoots: roots,
    roleTools: ["write"],
  });
  expect(session.unlocked).toBe(true);
});

test("implementer required skills + stack", () => {
  const roots = rootsWith(
    "subagent-driven-development",
    "test-driven-development",
    "receiving-code-review",
    "ponytail",
    "rust-skills",
  );
  const session = attestAndUnlock({
    role: "implementer",
    skillRoots: roots,
    roleTools: ["bash", "edit"],
    stackSkills: ["rust-skills"],
  });
  expect(session.required.map((s) => s.name)).toContain("rust-skills");
  expect(session.required.map((s) => s.name)).not.toContain("caveman");
});
```

Add/keep a mapping-level assertion (same file or adjacent describe):

```ts
test("REQUIRED_SKILLS_BY_ROLE has zero caveman entries", () => {
  for (const [role, req] of Object.entries(REQUIRED_SKILLS_BY_ROLE)) {
    expect(req.skills ?? [], role).not.toContain("caveman");
  }
});
```

In `omp/tests/stack-skills.test.ts`, drop `"caveman"` from any expected implementer skill arrays (keep `ponytail`).

**Rename multi-root fixture only if comments claim caveman product requirement** — the duplicate-skill test that writes a skill named `caveman` is a **generic** multi-root collision fixture: rename skill folder to `dup-skill` (or keep name but comment "multi-root collision fixture, not product skill").

**Step 2: Run tests to verify they fail**

```bash
cd omp && bun test tests/skill-loading.test.ts tests/stack-skills.test.ts
```

Expected: FAIL — role map still lists `caveman`; attest expects mismatch / missing name.

**Step 3: Minimal implementation**

In `omp/extensions/goal-harness/skills.ts`, remove `"caveman"` from:

- `spec-producer.skills`
- `plan-producer.skills`
- `bitesize-producer.skills`
- `implementer.skills`
- `task-fixer.skills`

Keep `ponytail` wherever it was paired. Do **not** change parent-orchestrator / gate-controller / bug / reviewer rows unless they currently contain caveman (they should not).

Target shapes after edit:

```ts
"spec-producer": {
  skills: ["brainstorming", "receiving-code-review", "ponytail"],
},
"plan-producer": {
  skills: ["writing-plans", "receiving-code-review", "ponytail"],
  fromParityManifest: true,
  parityAgent: "plan-writer",
},
"bitesize-producer": {
  skills: ["writing-plans", "receiving-code-review", "ponytail"],
  fromParityManifest: true,
  parityAgent: "bite-size-writer",
},
implementer: {
  skills: [
    "subagent-driven-development",
    "test-driven-development",
    "receiving-code-review",
    "ponytail",
  ],
  includeAutomaticStackSkills: true,
},
"task-fixer": {
  skills: [
    "subagent-driven-development",
    "test-driven-development",
    "receiving-code-review",
    "ponytail",
  ],
  includeAutomaticStackSkills: true,
},
```

**Step 4: Run tests to verify they pass**

```bash
cd omp && bun test tests/skill-loading.test.ts tests/stack-skills.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add omp/extensions/goal-harness/skills.ts omp/tests/skill-loading.test.ts omp/tests/stack-skills.test.ts
git commit -m "$(cat <<'EOF'
refactor(omp): drop caveman from REQUIRED_SKILLS_BY_ROLE

Keep ponytail on-demand for producers/implementers; update skill-loading
and stack-skills attest expectations.
EOF
)"
```

---

### Task 2: Caveman purge — manifests, agents, templates, packs, default goals

**Files:**
- Modify: `omp/agents/design-manifest.json`
- Modify: `omp/agents/spec-writer.md`
- Modify: `omp/agents/implementer.md`
- Modify: `omp/agents/pdr-writer.md`
- Modify: `omp/agents/arc42-writer.md`
- Modify: `omp/agents/adr-writer.md`
- Modify: `omp/agents/project-init.md`
- Modify: `omp/skills/goal-harness/SKILL.md` (default goal line 4)
- Modify: `omp/skills/design-flow/SKILL.md`
- Modify: `omp/extensions/goal-harness/project-init.ts` (Prefer tools string)
- Modify: `omp/templates/project/AGENTS.md.tmpl`
- Modify: `omp/templates/project/subdir-AGENTS.md.tmpl`
- Modify: `omp/configs/pack-rust.yml`
- Modify: `omp/configs/pack-ios.yml`
- Modify: `omp/configs/pack-android.yml`
- Test: lightweight grep + existing design/ponytail tests

**Do not** touch `omp/agents/parity-manifest.json` agent list or `agentCount`.

**Step 1: Write the failing test**

Add a small focused test (prefer extending an existing file rather than a new suite). Good home: `omp/tests/design-ponytail-wiring.test.ts` or a new block in `omp/tests/skill-loading.test.ts`:

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const OMP_ROOT = join(import.meta.dir, "..");

test("design-manifest requiredSkills contain zero caveman", () => {
  const m = JSON.parse(
    readFileSync(join(OMP_ROOT, "agents/design-manifest.json"), "utf8"),
  ) as { agents: Array<{ name: string; requiredSkills: string[] }> };
  for (const a of m.agents) {
    expect(a.requiredSkills ?? [], a.name).not.toContain("caveman");
  }
});

test("pack overlays and templates do not require caveman", () => {
  for (const pack of ["pack-rust", "pack-ios", "pack-android"]) {
    const y = parseYaml(
      readFileSync(join(OMP_ROOT, "configs", `${pack}.yml`), "utf8"),
    ) as { skills?: { includeSkills?: string[] } };
    const include = y.skills?.includeSkills ?? [];
    expect(include, pack).not.toContain("caveman");
    expect(include, pack).not.toContain("caveman-*");
    expect(include, pack).not.toContain("cavecrew");
    // overlays remain full-session catalogs — keep superpowers/goal-harness/ponytail
    expect(include).toContain("ponytail");
  }
  const rootT = readFileSync(
    join(OMP_ROOT, "templates/project/AGENTS.md.tmpl"),
    "utf8",
  );
  const subT = readFileSync(
    join(OMP_ROOT, "templates/project/subdir-AGENTS.md.tmpl"),
    "utf8",
  );
  expect(rootT.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(subT.toLowerCase()).not.toMatch(/\bcaveman\b/);
});

test("goal-harness and design-flow default skill mandates omit caveman", () => {
  const gh = readFileSync(
    join(OMP_ROOT, "skills/goal-harness/SKILL.md"),
    "utf8",
  );
  const df = readFileSync(
    join(OMP_ROOT, "skills/design-flow/SKILL.md"),
    "utf8",
  );
  expect(gh.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(df.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(gh).toMatch(/ponytail/);
});
```

**Step 2: Run test to verify it fails**

```bash
cd omp && bun test tests/design-ponytail-wiring.test.ts tests/skill-loading.test.ts
```

(or whatever file hosts the new asserts)

Expected: FAIL on design-manifest / pack yml / templates still mentioning caveman.

**Step 3: Minimal implementation**

1. **design-manifest.json** — strip `"caveman"` from every `requiredSkills` array:
   - pdr-writer → `["brainstorming", "ponytail"]`
   - arc42-writer → `["brainstorming", "ponytail"]`
   - adr-writer → `["ponytail"]`

2. **Agent md files** — remove caveman name-drops; keep ponytail:
   - `spec-writer.md`: `Also name: ponytail.` (drop caveman)
   - `implementer.md`: drop `` `caveman`, `` keep ponytail
   - `pdr-writer.md` / `arc42-writer.md`: `` `ponytail` `` only (plus brainstorming where present)
   - `adr-writer.md`: `` `ponytail` `` only
   - `project-init.md`: `Non-Superpowers: ponytail by name when minimalism applies.`

3. **goal-harness SKILL.md** default goal line 4 →:

```text
4. Mandated skills: using-superpowers + project stack skills + ponytail (exact skill:// names; never empty skill://).
```

4. **design-flow SKILL.md** skills list →:

```markdown
- `brainstorming` (required)
- `ponytail` on writers
- When skill `architect` exists later, load it; until then brainstorming only
- Never vendor Superpowers bodies into prompts
```

5. **project-init.ts** Prefer line — remove caveman token, e.g.:

```text
Prefer: rtk, bd, tokensave, sg, headroom, context-mode, context7, ponytail.
```

6. **templates/project/AGENTS.md.tmpl**:
   - Delete caveman row from CLI/skills table
   - Mandated skills line: `superpowers + stack + ponytail`
   - Bullet list: keep **ponytail**, drop **caveman**

7. **templates/project/subdir-AGENTS.md.tmpl**:
   - Inherit list without caveman: `rtk, bd, tokensave, sg, headroom, context-mode, context7, ponytail`

8. **configs/pack-*.yml** — delete these three entries from each overlay `includeSkills`:
   - `caveman`
   - `caveman-*`
   - `cavecrew`  
   Keep superpowers workflow set, goal-harness, beads, ponytail(+/*), stack routers, domain globs. Pack overlays are **full-session** catalogs (not cold); they may still list Superpowers.

**Step 4: Run tests**

```bash
cd omp && bun test tests/design-ponytail-wiring.test.ts tests/design-manifest.test.ts tests/skill-loading.test.ts tests/project-init.test.ts tests/entry-assets.test.ts
```

Expected: PASS. Manually:

```bash
rg -n '\bcaveman\b' omp/agents omp/skills/goal-harness omp/skills/design-flow omp/templates omp/configs omp/extensions/goal-harness/skills.ts omp/extensions/goal-harness/project-init.ts
```

Expected: no product-required hits (test fixture names only if any remain under `omp/tests`).

**Step 5: Commit**

```bash
git add \
  omp/agents/design-manifest.json \
  omp/agents/spec-writer.md omp/agents/implementer.md \
  omp/agents/pdr-writer.md omp/agents/arc42-writer.md \
  omp/agents/adr-writer.md omp/agents/project-init.md \
  omp/skills/goal-harness/SKILL.md omp/skills/design-flow/SKILL.md \
  omp/extensions/goal-harness/project-init.ts \
  omp/templates/project/AGENTS.md.tmpl omp/templates/project/subdir-AGENTS.md.tmpl \
  omp/configs/pack-rust.yml omp/configs/pack-ios.yml omp/configs/pack-android.yml \
  omp/tests
git commit -m "$(cat <<'EOF'
refactor(omp): purge caveman from agents, packs, and templates

Design-manifest, default goals, project-init Prefer list, and pack
overlays keep ponytail only for brevity/minimalism.
EOF
)"
```

---

### Task 3: Cold config.yml + mcp.json + lean-config tests (TDD)

**Files:**
- Modify: `omp/tests/lean-config.test.ts` (**first**)
- Modify: `omp/config.yml`
- Modify: `omp/mcp.json`
- Test: `omp/tests/lean-config.test.ts`

**Step 1: Write the failing tests**

Update `omp/tests/lean-config.test.ts` in three places.

**(a) MCP test** — rename and flip headroom/context-mode:

```ts
test("mcp.json cold-loads tokensave, headroom, context-mode; context7 opt-in", () => {
  const path = join(OMP_ROOT, "mcp.json");
  expect(existsSync(path)).toBe(true);
  const mcp = JSON.parse(readFileSync(path, "utf8")) as {
    mcpServers: Record<string, { enabled?: boolean; command?: string; url?: string }>;
    disabledServers?: string[];
  };
  const keys = Object.keys(mcp.mcpServers).sort();
  expect(keys).toEqual(
    ["context-mode", "context7", "headroom", "tokensave"].sort(),
  );
  // Cold: tokensave + headroom + context-mode connect; context7 stays opt-in.
  expect(mcp.mcpServers.tokensave?.enabled).not.toBe(false);
  expect(mcp.mcpServers.headroom?.enabled).not.toBe(false);
  expect(mcp.mcpServers["context-mode"]?.enabled).not.toBe(false);
  // headroom/context-mode may omit enabled (treat absent as on) OR enabled:true
  // Prefer explicit enabled: true in mcp.json for clarity.
  expect(mcp.mcpServers.headroom?.enabled).toBe(true);
  expect(mcp.mcpServers["context-mode"]?.enabled).toBe(true);
  expect(mcp.mcpServers.context7?.enabled).toBe(false);

  const disabled = mcp.disabledServers ?? [];
  for (const name of [
    "codebase-memory-mcp",
    "chrome-devtools",
    "node_repl",
    "computer-use",
  ]) {
    expect(disabled).toContain(name);
  }
  expect(existsSync(join(OMP_ROOT, "commands", "mcp-stack.md"))).toBe(true);
});
```

**(b) customDirectories test** — remove caveman fragment + probe:

```ts
const requiredFragments = [
  "superpowers",
  ".agents/skills",
  "omp/agent/skills",
  // NO marketplaces/caveman/skills
  "marketplaces/rust-skills/skills",
  "axiom-marketplace/axiom-codex/skills",
];
for (const frag of requiredFragments) {
  expect(
    dirs.some((d) => d.includes(frag)),
    `missing customDirectories entry containing ${frag}`,
  ).toBe(true);
}
// Explicitly forbid caveman root
expect(dirs.some((d) => d.includes("caveman"))).toBe(false);

const probeSkill: Record<string, string> = {
  superpowers: "using-superpowers",
  "marketplaces/rust-skills/skills": "rust-router",
  "axiom-marketplace/axiom-codex/skills": "axiom-swiftui",
  "omp/agent/skills": "goal-harness",
};
// after Task 4, also probe intent-router under omp/agent/skills — until then
// goal-harness probe is enough; Task 4 extends allowedSkillMd + probe.
```

**(c) includeSkills cold-core test** — replace required/forbidden lists:

```ts
test("includeSkills is cold-core only (domain packs on demand)", () => {
  const config = parseYaml(
    readFileSync(join(OMP_ROOT, "config.yml"), "utf8"),
  ) as Record<string, any>;
  const include: string[] = config.skills.includeSkills ?? [];

  // Exact cold allowlist (order-insensitive)
  expect([...include].sort()).toEqual(["beads", "intent-router"].sort());

  const forbiddenCold = [
    // former superpowers cold set
    "using-superpowers",
    "brainstorming",
    "writing-plans",
    "requesting-code-review",
    "receiving-code-review",
    "systematic-debugging",
    "test-driven-development",
    "subagent-driven-development",
    "using-git-worktrees",
    "verification-before-completion",
    "finishing-a-development-branch",
    "dispatching-parallel-agents",
    "executing-plans",
    // flow skills
    "goal-harness",
    "design-flow",
    // brevity / stacks
    "caveman",
    "ponytail",
    "stack-rust",
    "stack-ios",
    "stack-android",
    // pack labels + domain extras (keep existing forbiddenColdExtras list)
    "superpowers",
    "rust-skills",
    "axiom",
    "android",
    "webwright",
    "writing-skills",
    "caveman-*",
    "ponytail-*",
    "cavecrew",
    "axiom-*",
    "rust-*",
    "android-cli",
    // …retain the rest of the prior forbiddenColdExtras array…
  ];
  for (const name of forbiddenCold) {
    expect(include).not.toContain(name);
  }

  // cold tool surface unchanged
  expect(config.generate_image?.enabled).toBe(false);
  expect(config.inspect_image?.mode).toBe("off");
  expect(config.browser?.enabled).toBe(false);
  expect(config.tools?.xdev).toBe(true);
  expect(config.tools?.xdevDocs).toBe("catalog");

  // Thin routers still on disk for on-demand /stack-*
  for (const name of ["stack-rust", "stack-ios", "stack-android"]) {
    expect(existsSync(join(OMP_ROOT, "skills", name, "SKILL.md"))).toBe(true);
  }

  // Pack overlays still expand domain globs (full session — may list superpowers)
  for (const pack of ["pack-rust", "pack-ios", "pack-android"]) {
    const overlayPath = join(OMP_ROOT, "configs", `${pack}.yml`);
    expect(existsSync(overlayPath)).toBe(true);
    const overlay = parseYaml(readFileSync(overlayPath, "utf8")) as Record<
      string,
      any
    >;
    const oInclude: string[] = overlay.skills?.includeSkills ?? [];
    expect(oInclude).toContain("using-superpowers");
    expect(oInclude).toContain("goal-harness");
    expect(oInclude).not.toContain("caveman");
  }
  // …keep rust-*/axiom-*/android-cli overlay asserts + Bun.Glob semantics…
});
```

**(d) SKILL.md allowlist under omp/** — prepare for Task 4 by allowing `intent-router`:

```ts
const allowedSkillMd =
  /skills\/(goal-harness|design-flow|stack-rust|stack-ios|stack-android|intent-router)\/SKILL\.md$/;
```

(If Task 3 lands before skill file exists, either (1) land Task 3 config without this regex change and update regex in Task 4, or (2) create empty placeholder only in Task 4 — **do not** create SKILL in Task 3. Prefer update regex in Task 4; keep Task 3 regex as today until skill exists.)

**Step 2: Run tests to verify they fail**

```bash
cd omp && bun test tests/lean-config.test.ts
```

Expected: FAIL — includeSkills still fat; mcp headroom/context-mode false; caveman dir still required/present.

**Step 3: Minimal implementation**

`omp/config.yml` skills block:

```yaml
skills:
  enabled: true
  enableClaudeUser: false
  enableClaudeProject: false
  enableCodexUser: false
  enablePiUser: false
  enablePiProject: false
  enableAgentsUser: true
  enableAgentsProject: true
  enableSkillCommands: true
  customDirectories:
    - ~/.agents/skills/superpowers
    - ~/.agents/skills
    - ~/.omp/agent/skills
    - ~/.claude/plugins/marketplaces/rust-skills/skills
    - ~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills
  includeSkills:
    - intent-router
    - beads
  ignoredSkills:
    []
```

**Delete** the caveman marketplace customDirectory line entirely.

`omp/mcp.json`:

```json
{
  "mcpServers": {
    "tokensave": {
      "command": "tokensave",
      "args": ["serve"]
    },
    "headroom": {
      "enabled": true,
      "command": "headroom",
      "args": ["mcp", "serve"]
    },
    "context-mode": {
      "enabled": true,
      "command": "context-mode"
    },
    "context7": {
      "enabled": false,
      "url": "https://mcp.context7.com/mcp"
    }
  },
  "disabledServers": [
    "codebase-memory-mcp",
    "codebase_memory_mcp",
    "codebase_memory",
    "chrome-devtools",
    "chrome_devtools",
    "chrome_devtools_mcp",
    "chrome-devtools-mcp",
    "node_repl",
    "computer-use",
    "rust_skills_actionbook",
    "actionbook",
    "plugin_chrome-devtools-mcp_chrome-devtools"
  ]
}
```

Note: `includeSkills` references `intent-router` before the skill file exists. That is OK for config parse tests; Task 4 creates the skill in the same branch before link/ship. If lean-config probes `omp/agent/skills/intent-router/SKILL.md` on disk via customDirectories expand, either defer that probe to Task 4 or create the skill directory in Task 4 immediately after this commit on the same branch before running full suite.

**Practical sequencing inside the branch:** implement Task 3 tests+config, run lean-config (may need intent-router skill file present for existence probes — if any probe fails, create minimal skill stub in Task 4 before claiming Task 3 green, or combine end of Task 3 with start of Task 4). Prefer: finish Task 3 config assertions that do not require skill body; allow `existsSync(skills/intent-router)` asserts only in Task 4.

**Step 4: Run tests**

```bash
cd omp && bun test tests/lean-config.test.ts
```

Expected: PASS for updated MCP + includeSkills + customDirectories (skill existence for intent-router may wait until Task 4 if asserted).

**Step 5: Commit**

```bash
git add omp/config.yml omp/mcp.json omp/tests/lean-config.test.ts
git commit -m "$(cat <<'EOF'
feat(omp): lean cold includeSkills and enable headroom/context-mode

Cold catalog is intent-router + beads only. Remove caveman customDirectory.
context7 remains opt-in.
EOF
)"
```

---

### Task 4: intent-router skill + agent + AGENTS.md + entry-assets tests

**Files:**
- Create: `omp/skills/intent-router/SKILL.md`
- Create: `omp/agents/intent-router.md`
- Modify: `omp/AGENTS.md` (full cold-contract rewrite)
- Modify: `omp/tests/entry-assets.test.ts`
- Modify: `omp/tests/lean-config.test.ts` (allowedSkillMd + optional probe for intent-router)
- Test: `omp/tests/entry-assets.test.ts`, `omp/tests/lean-config.test.ts`, `omp/tests/agent-parity.test.ts` (must stay 19)

**Parity rule:** Do **not** add `intent-router` to `omp/agents/parity-manifest.json`. Agent md lives beside design/WF7 extras; `agentCount` remains **19**.

**Step 1: Write the failing tests**

Append to `omp/tests/entry-assets.test.ts`:

```ts
test("intent-router skill and agent exist with route taxonomy", () => {
  const skill = join(OMP_ROOT, "skills/intent-router/SKILL.md");
  const agent = join(OMP_ROOT, "agents/intent-router.md");
  expect(existsSync(skill)).toBe(true);
  expect(existsSync(agent)).toBe(true);
  const sk = readFileSync(skill, "utf8");
  const ag = readFileSync(agent, "utf8");
  // §4.3 route ids
  for (const route of [
    "harness",
    "design",
    "init",
    "review_pr",
    "code_review",
    "stack",
    "mcp",
    "local",
    "ambiguous",
  ]) {
    expect(sk).toContain(route);
  }
  expect(sk).toMatch(/boundGoal/);
  expect(sk).toMatch(/double-start|already active|at most one/i);
  expect(sk).toMatch(/buildStartMessage|handleHarnessCommand|\/harness/);
  expect(sk).toMatch(/buildDesignStartMessage|\/design/);
  expect(sk).toMatch(/buildReviewPrControllerMessage|\/review-pr/);
  expect(sk).not.toMatch(/intent-dispatch\.ts/);
  expect(sk).not.toMatch(/\bcaveman\b/i);
  // agent is thin optional spawn
  expect(ag).toMatch(/intent-router/);
  expect(ag).toMatch(/tools:\s*\[.*read/i);
});

test("still no commands/harness.md (extension-only /harness)", () => {
  const files = readdirSync(join(OMP_ROOT, "commands"));
  expect(files).not.toContain("harness.md");
  expect(files).not.toContain("goal.md");
  expect(files).not.toContain("guided-goal.md");
});

test("AGENTS.md documents freeform intent routing and lean cold catalog", () => {
  const text = readFileSync(join(OMP_ROOT, "AGENTS.md"), "utf8");
  expect(text).toMatch(/intent-router/);
  expect(text).toMatch(/freeform/i);
  expect(text).not.toMatch(/ultra-core Superpowers|caveman\/ponytail roots/i);
  expect(text.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(text).toMatch(/tokensave/);
  expect(text).toMatch(/headroom/);
  expect(text).toMatch(/context-mode/);
  expect(text).toMatch(/context7/);
  // cold skills claim
  expect(text).toMatch(/intent-router/);
  expect(text).toMatch(/beads/);
});
```

Update lean-config `allowedSkillMd` regex to include `intent-router` (see Task 3 note).

Add parity guard (in entry-assets or agent-parity — prefer **not** changing agent-parity expected list):

```ts
// in entry-assets or a one-liner in agent-parity remains agentCount 19
// Do NOT expect intent-router inside parity-manifest agents[]
test("intent-router agent is outside parity-manifest 19", () => {
  const manifest = JSON.parse(
    readFileSync(join(OMP_ROOT, "agents/parity-manifest.json"), "utf8"),
  ) as { agentCount: number; agents: Array<{ name: string }> };
  expect(manifest.agentCount).toBe(19);
  expect(manifest.agents.map((a) => a.name)).not.toContain("intent-router");
  expect(existsSync(join(OMP_ROOT, "agents/intent-router.md"))).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

```bash
cd omp && bun test tests/entry-assets.test.ts
```

Expected: FAIL — missing skill/agent; AGENTS still old cold catalog.

**Step 3: Minimal implementation**

#### 3a. Create `omp/skills/intent-router/SKILL.md`

```markdown
---
name: intent-router
description: >
  Cold-session freeform intent classifier. Routes user text into existing
  OMP flows (harness/design/init/review-pr/code-review/stack/mcp) or stays
  local. Not a second orchestrator.
---

# Intent router

Cold-start skill. Load on freeform turns when no slash command and no active
harness/design/PR controller binding.

## When this skill applies

1. User message has **no** leading slash command.
2. Session is **not** already inside an active `goal-harness-start`,
   `design-flow-start`, or `WF7 PR REVIEW CONTROLLER` turn.
3. Not inside implementer/task-fixer lanes (those roles use their own maps).

If (2) is true: treat the message as steering for the active flow — **do not**
re-route or start a second controller.

## Classification output

Decide a route (mentally or as a single short JSON line), then **act once**:

```json
{
  "route": "harness|design|init|review_pr|code_review|stack|mcp|local|ambiguous",
  "boundGoal": "string",
  "stackId": "rust|ios|android|null",
  "prTarget": "string|null",
  "confidence": "high|low"
}
```

`boundGoal` = user message trimmed (verbatim). Do not invent a second goal.
`stackId: gcp` is reserved/not installed → explain pack missing or ask; do not fake skills.

## Taxonomy (route ids)

| route | Meaning |
|-------|---------|
| `harness` | Multi-step feature/bugfix-with-process / "build X" |
| `design` | Design-only (PDR/Arc42/ADR), explicitly not build |
| `init` | Scaffold AGENTS/CLAUDE/bd |
| `review_pr` | GitHub PR by URL / `owner/repo#n` / number |
| `code_review` | Local diff/branch/milestone multi-angle review (not WF7) |
| `stack` | Explicit language pack work |
| `mcp` | Need docs MCP / enable stack MCP |
| `local` | Q&A, small edit, explain, one-file fix |
| `ambiguous` | Cannot choose confidently |

### Precedence (first match wins)

1. Explicit PR target shape → `review_pr`
2. Explicit design-only / PDR / Arc42 / ADR without implement → `design`
3. Explicit scaffold/init agents → `init`
4. Explicit pack name → `stack`
5. Multi-step build/fix with verification → `harness`
6. Review my diff/branch without PR → `code_review`
7. Otherwise → `local`

### Anti-patterns

- Do not route every coding question to `harness`.
- Do not route "what does this function do?" to `design`.
- Do not start `harness` and `design` together.
- Prefer `local` when unsure between local and harness unless multi-step process is clear.
- Low confidence → `ambiguous` (one clarifying question), not a guess start.

## Dispatch table (same semantics as slash)

Primary path: **follow this table**. Prefer invoking the same start builders /
user-equivalent slash the extensions already expose. There is **no**
`intent-dispatch.ts` middleware and **no** second harness registration.

| route | Action |
|-------|--------|
| `harness` | Same as `/harness`: `handleHarnessCommand(boundGoal)` → one `sendMessage` of `buildStartMessage` / `{ kind: "goal-harness-start", ... }` with `{ triggerTurn: true }`. If the model cannot call the extension API, emit user-equivalent `/harness <boundGoal>` once. |
| `design` | `buildDesignStartMessage(boundGoal)` → design start send, or `/design <boundGoal>`. |
| `init` | Follow `commands/init.md` / `runProjectInit` — no Spec/Plan issues. |
| `review_pr` | Require parseable target; `buildReviewPrControllerMessage({ target, dryRun })` → sendMessage. Missing target → ask once. |
| `code_review` | Follow `commands/code-review.md` → `agents/code-reviewer.md` + live skills there. **Not** WF7. |
| `stack` | Follow matching `commands/stack-{rust,ios,android}.md`; load entry skills by absolute path. |
| `mcp` | Point at `/mcp-stack` / `/mcp enable context7` (headroom+context-mode already cold). |
| `local` | Answer with cold tools only (tokensave, rtk, headroom, context-mode, bd). May ad-hoc `read skill://ponytail` if user wants minimal code — still not cold-listed. |
| `ambiguous` | Ask **one** clarifying question; stop; do not start a flow. |

## Double-start guard

- At most one of `{goal-harness-start, design-flow-start, WF7 PR REVIEW CONTROLLER}` active per session thread.
- Mid-harness freeform = harness steering, not new intent.
- Slash `/harness` while harness active: existing harness behavior; do not parallel-start.

## Optional spawn

Agent `omp/agents/intent-router.md` may be spawned for long/ambiguous turns with
read-only bias tools `[bash, read, search]`. Happy-path short prompts: session
default model applies this skill directly — spawn not required.

## Out of scope

- Native `/goal` / `/guided-goal` (never shadow).
- Creating `commands/harness.md`.
- NLP keyword classifier code or accuracy tests.
- Auto-chaining `/design` → `/harness`.
```

#### 3b. Create `omp/agents/intent-router.md`

```markdown
---
name: intent-router
description: Optional freeform intent classifier spawn. Thin; prefers session skill path.
tools: [bash, read, search]
spawns: []
---

# intent-router

Optional spawn when freeform intent is long or ambiguous. Default path is the
session model loading `skill://intent-router` — do not require this agent every turn.

## Mandatory

1. Read live `skill://intent-router` (complete SKILL.md).
2. Classify with § taxonomy route ids only.
3. Dispatch **once** using the skill dispatch table (same builders/slash semantics).
4. Never start a second harness/design/PR controller while one is active.
5. Never implement product features in this role — route or ask, then stop.

## Tools

Read-only bias. No writes. No PR opens. No worktree creation.
```

#### 3c. Rewrite `omp/AGENTS.md`

Replace cold-catalog bullets with OMP-delta intent contract. Keep binary/launch/model-router/gate/link lines short. Target structure:

```markdown
# OMP agent (dotfiles)

Shared cross-agent policy lives in **`../agent-stack/`** (`AGENTS.shared.md`,
`RTK.md`) and is linked into this agent dir by `link.sh`. Do not duplicate it
here.

## OMP-only deltas

- **Binary:** installed by Nix activation (`install-omp.sh`) only — not configured here.
- **Launch:** prefer `headroom wrap omp` (nushell `omp` alias wraps it; `omp-raw` skips proxy).
- **Subagent model label:** `task.showResolvedModelBadge: true`.
- **Harness model routes** (`extensions/goal-harness/model-router.ts`): keep existing date-gated Sol note (short).
- **Gate token budget:** Spec/Plan/BiteSize/Milestone ceilings **2**. Producer effort **max**, reviewer **high**.
- **Config:** `config.yml` → lean defaults (shake, no Autolearn, no built-in task list, memory off, hashline, **yolo** + **smart-approve**).
- **Link:** `./link.sh` → `~/.omp/agent` without touching `auth.json` / sessions / cache.

## Cold session

- **Skills cold catalog:** exactly `intent-router`, `beads` (`config.yml` `includeSkills`).
- **customDirectories:** Superpowers + agents + omp skills + pack roots for **resolve only** — not cold-catalogued.
- **MCP cold:** `tokensave`, `headroom`, `context-mode` enabled. `context7` opt-in via `/mcp enable` or `/mcp-stack`.
- **Shell toolkit:** rtk + modern CLIs (see `RTK.md`). RTK is not an MCP server.
- **Not cold-loaded:** Superpowers workflow skills, `goal-harness`, `design-flow`, `ponytail`(+review/audit), `stack-*` routers, domain pack globs. Flows load them live when invoked.

## Freeform intent routing

When the user message has **no** leading slash and no harness/design/PR controller
is already active:

1. Follow `skill://intent-router` (and optional agent `intent-router`).
2. Classify to one route id: `harness` | `design` | `init` | `review_pr` |
   `code_review` | `stack` | `mcp` | `local` | `ambiguous`.
3. Dispatch **once** using the same start semantics as the slash/extension
   handlers (`handleHarnessCommand`/`buildStartMessage`, `buildDesignStartMessage`,
   `buildReviewPrControllerMessage`, `/init`, `/code-review`, `/stack-*`, `/mcp-stack`).
4. Prefer conservative `local` when unsure; `ambiguous` → one clarifying question.

Slash commands bypass the router and load their flow directly.

### Double-start

At most one of `{goal-harness-start, design-flow-start, WF7 PR REVIEW CONTROLLER}`
per thread. Mid-flow freeform is steering, not a new route.

## Flows (on-demand loaders)

| Entry | Loads (live) |
|-------|----------------|
| `/harness` | extension-registered only — `using-superpowers` → `goal-harness` → phase roles via `REQUIRED_SKILLS_BY_ROLE` |
| `/design` | `using-superpowers`, `design-flow`, `brainstorming` |
| `/init` | `runProjectInit` / `project-init` (no Superpowers required) |
| `/review-pr` | WF7 controller (extension) |
| `/code-review` | `code-reviewer` + `requesting-code-review`, `ponytail-review`(+audit) — not WF7 |
| `/stack-rust` `/stack-ios` `/stack-android` | thin routers + pack entry paths |
| `/mcp-stack` | primarily enable `context7` (headroom/context-mode already cold) |

Do **not** shadow native `/goal` or `/guided-goal`. Do **not** add `commands/harness.md`.

See `compatibility.json` for the pinned runtime contract and `README.md` for link safety rules.
```

Keep the model-router date sentence accurate from current AGENTS.md (copy the existing Sol date clause rather than inventing).

**Step 4: Run tests**

```bash
cd omp && bun test tests/entry-assets.test.ts tests/lean-config.test.ts tests/agent-parity.test.ts tests/design-manifest.test.ts
```

Expected: PASS. `agentCount` still 19; intent-router md exists outside manifest.

**Step 5: Commit**

```bash
git add \
  omp/skills/intent-router/SKILL.md \
  omp/agents/intent-router.md \
  omp/AGENTS.md \
  omp/tests/entry-assets.test.ts \
  omp/tests/lean-config.test.ts
git commit -m "$(cat <<'EOF'
feat(omp): add intent-router skill/agent and lean AGENTS contract

Freeform turns classify via skill://intent-router and dispatch once into
existing slash/start builders. Agent stays outside parity-manifest 19.
EOF
)"
```

---

### Task 5: `/code-review` command + mcp-stack + stack-* + init/design minor

**Files:**
- Create: `omp/commands/code-review.md`
- Modify: `omp/commands/mcp-stack.md`
- Modify: `omp/commands/stack-rust.md`
- Modify: `omp/commands/stack-ios.md`
- Modify: `omp/commands/stack-android.md`
- Modify: `omp/commands/init.md` (only if caveman/superpowers-cold assumptions remain — currently clean; scrub if any)
- Modify: `omp/commands/design.md` (confirm thin; no caveman)
- Modify: `omp/tests/entry-assets.test.ts` (code-review asserts)
- Test: `omp/tests/entry-assets.test.ts`, `omp/tests/harness-command.test.ts`

**Step 1: Write the failing test**

```ts
test("commands/code-review.md maps to code-reviewer not WF7", () => {
  const path = join(OMP_ROOT, "commands/code-review.md");
  expect(existsSync(path)).toBe(true);
  const raw = readFileSync(path, "utf8");
  expect(raw).toMatch(/code-reviewer/);
  expect(raw).toMatch(/REVIEW-POLICY|ponytail-review/i);
  expect(raw).not.toMatch(/WF7|wf7-fable|grok-judge/i);
  expect(raw).not.toMatch(/review-pr/);
});

test("stack commands do not claim routers are cold-listed", () => {
  for (const name of ["stack-rust", "stack-ios", "stack-android"]) {
    const raw = readFileSync(join(OMP_ROOT, "commands", `${name}.md`), "utf8");
    expect(raw).not.toMatch(/router always cold-listed/i);
    expect(raw).toMatch(/on-demand|not cold/i);
  }
});

test("mcp-stack documents cold headroom/context-mode and opt-in context7", () => {
  const raw = readFileSync(join(OMP_ROOT, "commands/mcp-stack.md"), "utf8");
  expect(raw).toMatch(/context7/);
  expect(raw).toMatch(/tokensave/);
  // cold already has headroom + context-mode
  expect(raw.toLowerCase()).toMatch(/already|cold/);
});
```

**Step 2: Run test to verify it fails**

```bash
cd omp && bun test tests/entry-assets.test.ts
```

Expected: FAIL — missing `code-review.md`; stack text still says cold-listed; mcp-stack still "tokensave only".

**Step 3: Minimal implementation**

#### `omp/commands/code-review.md`

```markdown
---
name: code-review
description: Local/branch/diff multi-angle code review via code-reviewer. Not PR/WF7.
---

# /code-review

Local milestone-style review. Expand `$ARGUMENTS` as scope (paths, branch, "staged", summary of intent).

## Not this command

- GitHub PR review → use **`/review-pr`** (WF7 controller).
- Multi-step build → `/harness`.

## Skills / agent

Load live:

- `agents/code-reviewer.md` (role prompt + JSON output contract)
- `requesting-code-review`
- `ponytail-review` (every review)
- `ponytail-audit` when scope is multi-file / whole-tree / milestone
- Stack skills only if markers require them

Do **not** load `receiving-code-review` in the reviewer role.

## Do this now

1. Resolve review scope from `$ARGUMENTS` (default: current diff / changed files).
2. Spawn or act as `code-reviewer` with tools `[bash, read, search]`.
3. Follow `agents/REVIEW-POLICY.md` (default PASS; blocking only for real defects).
4. Return JSON:

```json
{ "ok": true, "feedback": "summary; nits ok", "blocking": [] }
```

## Stop

After the JSON review result, **stop**. Do not implement fixes unless the user explicitly asks in a follow-up (that follow-up is a new intent, often `local` or `harness`).
```

#### `omp/commands/mcp-stack.md` — rewrite cold story

```markdown
---
name: mcp-stack
description: Enable opt-in docs MCP (context7). headroom/context-mode are already cold.
---

# /mcp-stack

## Cold MCP (already connected)

- **tokensave** — code graph
- **headroom** — compress/retrieve large tool outputs
- **context-mode** — sandbox + FTS for big logs/files

RTK remains shell/hooks, not MCP.

## Opt-in now

```text
/mcp enable context7
```

| Server | When |
|--------|------|
| **context7** | Library/API docs (docs-scout primary path) |

`headroom` / `context-mode` should already be on; re-enable only if a session disabled them.

## Do not

- Re-enable codebase-memory / chrome-devtools / node_repl (`disabledServers`).
- Invent APIs from training data when context7 can answer.
```

#### Stack commands — fix step 1 wording

In each of `stack-rust.md`, `stack-ios.md`, `stack-android.md`:

- Replace `(router always cold-listed)` with `(on-demand router; not in cold includeSkills)`.
- Keep absolute path loads.
- Ensure intro still says domain pack names are omitted from cold `includeSkills` (already true; routers themselves are also no longer cold-listed — update any sentence that implies only domain globs were omitted while routers stayed cold).

Example rust intro tweak:

```markdown
Cold-start `includeSkills` is only `intent-router` + `beads`. This command
loads the Rust pack on demand. Pack roots remain on disk via `customDirectories`.
```

Step 1:

```markdown
1. `read skill://stack-rust` (on-demand router; not cold-listed).
```

#### init.md / design.md

- Confirm no caveman and no "Superpowers is cold" claims (current files look fine).
- Optional one-liner under design Skills: "These load on invocation — not cold-catalogued."

**Do not create** `commands/harness.md`.

**Step 4: Run tests**

```bash
cd omp && bun test tests/entry-assets.test.ts tests/harness-command.test.ts tests/lean-config.test.ts
```

Expected: PASS. harness still extension-only; no harness.md.

**Step 5: Commit**

```bash
git add omp/commands/code-review.md omp/commands/mcp-stack.md \
  omp/commands/stack-rust.md omp/commands/stack-ios.md omp/commands/stack-android.md \
  omp/commands/init.md omp/commands/design.md omp/tests/entry-assets.test.ts
git commit -m "$(cat <<'EOF'
feat(omp): add /code-review shell and fix on-demand command docs

mcp-stack targets context7; stack-* no longer claim cold-listed routers.
EOF
)"
```

---

### Task 6: domain-packs GCP comment + README + residual greps

**Files:**
- Modify: `omp/extensions/goal-harness/domain-packs.ts` (header + deferred GCP comment)
- Modify: `omp/README.md`
- Grep cleanup any residual OMP docs still claiming old cold catalog
- Test: `omp/tests/domain-packs.test.ts`, residual `rg`

**Step 1: Write the failing test / grep gate**

```ts
// extend domain-packs.test.ts or lean-config
test("domain-packs documents deferred GCP without implementing pack", () => {
  const src = readFileSync(
    join(OMP_ROOT, "extensions/goal-harness/domain-packs.ts"),
    "utf8",
  );
  expect(src).toMatch(/DomainPackId = "rust" \| "ios" \| "android"/);
  expect(src).toMatch(/Future|GCP|gcp/); // deferred comment present
  expect(src).not.toMatch(/DOMAIN_PACKS\.gcp\s*=/);
  // cold header must not claim stack routers are cold-listed
  expect(src).not.toMatch(/Cold catalog only lists core \+ thin stack-\* routers/);
});
```

README manual checks via test optional:

```ts
test("README cold catalog matches lean allowlist", () => {
  const text = readFileSync(join(OMP_ROOT, "README.md"), "utf8");
  expect(text).toMatch(/intent-router/);
  expect(text).toMatch(/beads/);
  expect(text.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(text).toMatch(/headroom/);
  expect(text).toMatch(/context-mode/);
});
```

**Step 2: Run to fail**

```bash
cd omp && bun test tests/domain-packs.test.ts
```

**Step 3: Implementation**

**domain-packs.ts** header rewrite:

```ts
/**
 * Domain skill packs loaded on demand — not in cold-start includeSkills.
 *
 * Pack roots stay in config.yml customDirectories so harness resolveSkill and
 * filesystem reads work. Cold includeSkills is only intent-router + beads;
 * stack-* routers and pack entry skills load via /stack-* or stack-scout.
 *
 * Future — not implemented this phase:
 *   export type DomainPackId = "rust" | "ios" | "android" | "gcp";
 *   // DOMAIN_PACKS.gcp = { id: "gcp", stackLabels: ["gcp","google-cloud"], ... }
 *   // Research: https://github.com/google/skills
 *   // When added: audit android includeGlobs for GCP bleed (follow-up).
 */
```

Keep `export type DomainPackId = "rust" | "ios" | "android";` as the real type.

**README.md** — update tables/sections that currently say:

- Cold catalog = Superpowers + caveman/ponytail + stack routers  
- Cold MCP = tokensave only  

Replace with:

| Topic | Value |
|-------|--------|
| Skill catalog | `includeSkills`: **intent-router**, **beads** only |
| Intent | freeform → `skill://intent-router` → one dispatch into existing flows |
| Domain packs | On demand: `/stack-*`, stack-scout, `configs/pack-*.yml` |
| Cold MCP | tokensave + headroom + context-mode; context7 opt-in |
| Caveman | removed from OMP-required surfaces |
| GCP pack | deferred (see domain-packs.ts comment) |

**Residual grep (must be clean for product paths):**

```bash
rg -n '\bcaveman\b' omp --glob '!**/node_modules/**' --glob '!**/tests/**'
rg -n 'ultra-core Superpowers|router always cold-listed|cold-loads tokensave only' omp
rg -n 'intent-dispatch\.ts|commands/harness\.md' omp
```

Fix any remaining hits under `omp/` product files (not git history). Tests may still use the word caveman only as a negative assertion string.

**Step 4: Run tests**

```bash
cd omp && bun test tests/domain-packs.test.ts tests/lean-config.test.ts tests/entry-assets.test.ts
```

**Step 5: Commit**

```bash
git add omp/extensions/goal-harness/domain-packs.ts omp/README.md omp/tests
git commit -m "$(cat <<'EOF'
docs(omp): align README and domain-packs with lean cold start

Document deferred GCP extension point; scrub residual cold-catalog claims.
EOF
)"
```

---

### Task 7: Final verification suite

**Files:** none new (verification only). Fix only regressions discovered.

**Step 1: Run targeted suite (exact commands)**

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

Expected: all PASS.

**Step 2: Parity + harness invariants**

```bash
cd omp && bun test tests/stage3-parity.test.ts tests/stage4-native.test.ts
```

Expected: `agentCount` 19; native `/goal` unshadowed; harness command still registered from extension only.

**Step 3: Acceptance grep checklist (design §14)**

```bash
# 1–2 cold skills exact
cd omp && bun -e '
import { parse } from "yaml";
import { readFileSync } from "fs";
const c = parse(readFileSync("config.yml","utf8"));
const inc = [...c.skills.includeSkills].sort();
if (JSON.stringify(inc) !== JSON.stringify(["beads","intent-router"])) {
  console.error("BAD includeSkills", inc); process.exit(1);
}
if ((c.skills.customDirectories||[]).some((d:string)=>d.includes("caveman"))) {
  console.error("caveman dir present"); process.exit(1);
}
console.log("config ok");
'

# 3 MCP flags
cd omp && bun -e '
const m = JSON.parse(readFileSync("mcp.json","utf8"));
const s = m.mcpServers;
if (s.headroom.enabled !== true || s["context-mode"].enabled !== true || s.context7.enabled !== false) {
  console.error(s); process.exit(1);
}
console.log("mcp ok");
' 

# 4–7 assets
test -f omp/skills/intent-router/SKILL.md
test -f omp/agents/intent-router.md
test -f omp/commands/code-review.md
test ! -f omp/commands/harness.md

# 10–11 zero caveman in role surfaces
rg -n '"caveman"|caveman' omp/extensions/goal-harness/skills.ts omp/agents/design-manifest.json && exit 1 || true
rg -n '\bcaveman\b' omp/configs omp/templates omp/skills/goal-harness omp/skills/design-flow && exit 1 || true

# 13 no gcp pack
rg -n 'DOMAIN_PACKS\.gcp\s*=' omp/extensions/goal-harness/domain-packs.ts && exit 1 || true

# parity 19
cd omp && bun -e '
const m=JSON.parse(readFileSync("agents/parity-manifest.json","utf8"));
if (m.agentCount!==19) process.exit(1);
if (m.agents.some(a=>a.name==="intent-router")) process.exit(2);
console.log("parity ok");
'
```

**Step 4: Optional broader smoke** (if time; not a substitute for Step 1)

```bash
cd omp && bun test tests/integration.test.ts
```

Do **not** require full PR-review suite green for cold-start acceptance unless those tests fail due to caveman/config coupling — then fix the coupling only.

**Step 5: Commit only if Step 1–3 forced fixes**

```bash
git add -A omp
git commit -m "$(cat <<'EOF'
test(omp): finish cold-start intent-router acceptance fixes
EOF
)"
```

If no fixes: no empty commit.

**Step 6: Beads / handoff**

- Close plan issue work notes on `dotfiles-yl4` when plan approved by plan-reviewer (this plan file is the artifact).
- Implement phase uses this plan under epic `dotfiles-3v6`.
- After implement: `omp/link.sh` on the machine; restart `omp` sessions to pick lean cold config.

---

## Design §14 acceptance mapping

| # | Criterion | Task(s) | Verification |
|---|-----------|---------|--------------|
| 1 | `includeSkills` exactly `intent-router`, `beads` | 3 | `lean-config.test.ts` + bun -e sort compare |
| 2 | No caveman dir; no superpowers/stack/caveman names in includeSkills | 2–3 | lean-config forbidden list + rg |
| 3 | MCP: tokensave/headroom/context-mode on; context7 off; disabledServers kept | 3 | lean-config MCP test |
| 4 | `skills/intent-router/SKILL.md` taxonomy + dispatch §4 | 4 | entry-assets route id asserts |
| 5 | `agents/intent-router.md` thin role | 4 | entry-assets + parity-outside-19 |
| 6 | `AGENTS.md` freeform routes; no Superpowers/caveman/stack cold claims | 4 | entry-assets AGENTS test |
| 7 | `commands/code-review.md` → code-reviewer not WF7 | 5 | entry-assets |
| 8 | `/review-pr` remains extension PR slash | 5–7 | no rename; existing pr-review tests |
| 9 | `/harness` extension-only; native `/goal` unshadowed | 4–5, 7 | entry-assets no harness.md; harness-command + stage4 |
| 10 | `REQUIRED_SKILLS_BY_ROLE` + design-manifest zero caveman; ponytail kept | 1–2 | skill-loading + design tests |
| 11 | Pack ymls + templates zero required caveman | 2 | pack/template tests + rg |
| 12 | Updated `lean-config.test.ts` passes | 3, 7 | bun test lean-config |
| 13 | Domain packs rust/ios/android only; GCP deferred comment | 6 | domain-packs test |
| 14 | Superpowers still resolve on-demand from customDirectories | 3 | lean-config superpowers root probe |
| 15 | No TODO stubs; skill+AGENTS sufficient; no intent-dispatch.ts | 4–7 | rg intent-dispatch; skill complete |

---

## Explicit non-work (YAGNI)

| Item | Status |
|------|--------|
| `omp/commands/harness.md` | **SKIP** |
| `omp/extensions/goal-harness/intent-dispatch.ts` | **SKIP** (default) |
| NLP / keyword classifier tests | **SKIP** |
| GCP pack / `stack-gcp` command | **SKIP** (comment only) |
| Android GCP distill | **SKIP** (follow-up) |
| Pre-model extension hook intercepting all messages | **SKIP** |
| Bumping `parity-manifest.json` `agentCount` for intent-router | **FORBIDDEN** |
| Caveman purge outside `omp/` (agent-stack hosts) | **OUT OF SCOPE** unless OMP tests demand it |
| WF7 core / model-router dates / gate ceilings | **DO NOT TOUCH** |
| Native `/goal` registration | **DO NOT TOUCH** |

---

## Risk notes for implementer

1. **Skill file timing:** `includeSkills: [intent-router]` before `skills/intent-router/SKILL.md` exists will break any existence probe — land Task 4 on the same branch before claiming full suite green.
2. **Pack overlays** still list Superpowers for full-catalog sessions; only **cold** `config.yml` is lean. Do not "helpfully" gut overlays down to intent-router only.
3. **skill-loading multi-root fixture** named `caveman` is not product policy — rename to avoid false rg greys.
4. **Double-start** is documentation-only; do not invent session middleware if AGENTS+skill already state the rule.
5. **Freeform dispatch** is LLM-followed skill text, not a TypeScript router — tests assert allowlists/assets/builders existence, never classification accuracy.
6. **agent-parity / stage3** will fail if anyone adds intent-router to the 19-list — keep agent file only.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-07-31-omp-cold-start-intent-router.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — fresh subagent per task, review between tasks (`superpowers:subagent-driven-development`)
2. **Parallel Session (separate)** — new session with `superpowers:executing-plans`, batch with checkpoints

Plan-reviewer gates approval before implement phase under epic `dotfiles-3v6`.
