# `architect` Skill Implementation Plan — `/architect` command + `/design` embedding

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Vendor the adapted `software-architecture-design` skill as `omp/skills/architect/`, add a standalone `/architect` empty-shell command, and embed the skill as a **required** live-path load on the `/design` PDR/Arc42 writers — per approved Spec dotfiles-8mu.1.

**Architecture:** Pure file-contract change: one new skill tree (SKILL.md + 6 references + 4 assets), one new command shell, string edits to six wiring files, and one file-content contract test (`architect-entry.test.ts`) in the house `design-entry.test.ts` style. No new extension, agents, schemas, or model-router phases. Ships through the existing `link.sh` `skills` directory symlink with zero linker changes.

**Tech Stack:** Markdown skill files, Bun tests (`bun:test`), POSIX sh (`link.sh`), `bd` for tracking.

- **Epic:** dotfiles-8mu · **Spec:** dotfiles-8mu.1 (approved 2026-08-01) · **Plan:** dotfiles-8mu.2
- **Spec SoT:** `/tmp/omp-architect-harness/spec-draft.md` — decisions there are **locked**; this plan implements, never reopens.
- **Workspace:** `/Users/legolas/.dotfiles` (all paths below relative to repo root unless `~`-prefixed). Run all commands from repo root.

---

## ⚠ Base-state reconciliation (READ FIRST)

While this plan was being drafted, commit **`e87d2a5b`** ("feat(omp): embed architect skill into /design flow", author Kaan, 2026-08-01 14:59) landed an **interim hand-rolled embedding** that diverges from the Spec he approved the same day:

| e87d2a5b state (current HEAD) | Locked Spec decision |
|---|---|
| Skill at `~/.agents/skills/architect/` (untracked here; claimed SoT `nix-setup/modules/agents/skills/architect` — a different repo) | Spec §4a **rejected** exactly this as Option A; skill lives at `omp/skills/architect/`, runtime `~/.omp/agent/skills/architect/` |
| "when present — **fail-open** if missing" on writers | Required load on `pdr-writer`/`arc42-writer` (skill is repo-vendored, always present) |
| `adr-writer` + ADR prompt + manifest gained `architect` | Spec §7: ADR phase **unchanged**, adr-writer untouched by architect |
| Raw upstream vendored incl. `architecture-trends-2026.md`, `data/sources.json`, `adr-template.md` | Spec §8 drops all three |
| Test `design-architect-wiring.test.ts` pinning the above | Spec §10: contract test is `architect-entry.test.ts` |
| No `/architect` command | Bound goal requires standalone command |

**This plan migrates e87d2a5b to the Spec state** (it is the human-approved SoT and strictly newer in intent), while **salvaging** the good parts: Kaan's 5.1KB `~/.agents/skills/architect/SKILL.md` rewrite is the base for the vendored SKILL.md, his `UPSTREAM.md` pin (`6a223ba13c311c09b41c1dc09c14ab75e703894b`) feeds the provenance footer, and his local tree is the offline vendor source (byte-identical to upstream at the pin for references/assets).

**STOP condition:** if Kaan states e87d2a5b was meant to *override* the Spec (keep `~/.agents/skills/` + fail-open), STOP — do not implement this plan; the Spec must be revised first (CLAUDE.md Rule #1). Absent that statement, the approved Spec governs.

Unrelated dirty files (`.codex/config.toml`, `.gitignore`, `.zshrc`, `package.json`, `CLAUDE.md`, `.keylore-root`) are Kaan's — **never** stage, revert, or touch them.

## Spec deviation register (exactly one)

Spec §5 gives the `workflows/design-flow.ts` controllerPolicy line verbatim ending in `(never skill://architect)` — but Spec §10.3 requires `rg "skill://architect" omp/` → **0 matches**. The two cannot both hold. The testable acceptance criterion wins: this plan words the line `(never cold skill://)` (Task 6 Step 2), preserving the semantic while keeping the repo free of the literal. No other string deviates from the Spec.

---

## Current state at base `e87d2a5b` (verified line anchors)

- `omp/skills/design-flow/SKILL.md:42-44` — `~/.agents/skills/architect/SKILL.md` on writers, fail-open sub-bullet
- `omp/workflows/design-flow.ts:32` — controllerPolicy fail-open line (line 28 parent-skills path-load fix is **good — keep**)
- `omp/extensions/design-flow/workflow.ts:298` (PDR), `:333` (Arc42), `:369` (ADR) — fail-open prompt lines; ADR line must revert to original `"Controller will write docs/adr/NNNN-slug.md only.",`
- `omp/agents/pdr-writer.md:19`, `arc42-writer.md:19`, `adr-writer.md:18` — fail-open bullets (the `~/.agents/skills/ponytail/SKILL.md` path-form bullets above them are fine — keep)
- `omp/agents/design-manifest.json` — `architect` in requiredSkills of pdr-writer, arc42-writer, **and adr-writer** (last one must go)
- `omp/commands/design.md:17` — writers-path-load line (revert; spec doesn't modify design.md)
- `omp/README.md:44-46` — nix-setup install note (stale under spec; rewrite)
- `omp/tests/design-architect-wiring.test.ts` — 70-line test pinning the divergent contract (superseded; deleted in Task 6, assertions folded into the new test per the mapping in Task 1)
- All three original "architect exists later" stubs already removed by e87d2a5b — the new test keeps guarding them anyway
- No `omp/skills/architect/`, no `omp/commands/architect.md`, `AGENTS.md` unchanged
- `~/.agents/skills/architect/` — Kaan's tree: custom SKILL.md (5.1KB), UPSTREAM.md, full raw upstream refs/assets incl. the three spec-dropped files

## Commit discipline (why one feature commit)

Spec reviewer nit 6 + Spec §2.6: vendor tree and wiring must land in the **same logical batch** — never wiring that points at a not-yet-vendored path, never a vendored tree with stale fail-open wiring. All tasks below therefore build one working-tree state, verified red→green, committed **once** in Task 9 (plus an optional separate docs commit). Bite-sized tasks still end with a verify command each; they just don't each commit.

---

### Task 0: Preflight

**Files:** none (checks only)

**Step 1: Confirm base + clean omp/ tree**

Run: `git log --oneline -1 && git status --short -- omp/`
Expected: HEAD is `e87d2a5b` (or a descendant that hasn't touched `omp/` further); no output from the status (omp/ clean). If omp/ is dirty or new commits touch these files, re-read the touched files and reconcile anchors before proceeding.

**Step 2: Capture full-suite baseline**

Run: `bun test omp/tests/ 2>&1 | tail -5`
Expected: all pass (record count, e.g. "N pass, 0 fail"). If anything is already red, note it in bd — it is pre-existing, not yours to fix here.

**Step 3: Claim work in bd**

Run: `bd update dotfiles-8mu.2 --claim` (or the implement child issue if Main created one — `bd ready` to check)

**DoneWhen:** baseline recorded; base commit confirmed; issue claimed.

---

### Task 1: Write the failing contract test `architect-entry.test.ts`

**Files:**
- Create: `omp/tests/architect-entry.test.ts`
- (Do **not** delete `omp/tests/design-architect-wiring.test.ts` yet — that happens with the wiring migration in Task 6.)

**Supersede mapping** (old test → new, for the reviewer's benefit):
- path assertions on `~/.agents/skills/architect/SKILL.md` + `fail-open` → replaced by required-load assertions on `~/.omp/agent/skills/architect/SKILL.md` (Spec §5/§7)
- `design.md` architect mention → dropped (design.md reverts; `commands/architect.md` gets its own contract)
- stub-phrase negatives → kept, widened to a walk over `omp/{skills,workflows,agents}`
- adr-writer **contains** architect → inverted to **must not** (Spec §7)
- manifest membership incl. reviewers-excluded + brainstorming/ponytail retention → kept as-is (spec-compatible, salvaged)

**Step 1: Write the test exactly as below**

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");
const SKILL_DIR = join(OMP_ROOT, "skills/architect");
const RUNTIME_PATH = "~/.omp/agent/skills/architect/SKILL.md";
// Built by concatenation so this file never matches its own guard.
const COLD_NEEDLE = "skill:" + "//architect";

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const VENDORED = [
  "SKILL.md",
  "references/modern-patterns.md",
  "references/scalability-reliability-guide.md",
  "references/data-architecture-patterns.md",
  "references/migration-modernization-guide.md",
  "references/api-gateway-service-mesh.md",
  "references/operational-playbook.md",
  "assets/planning/architecture-blueprint.md",
  "assets/patterns/microservices-template.md",
  "assets/patterns/event-driven-template.md",
  "assets/operations/scalability-checklist.md",
];

describe("architect entry contract", () => {
  test("commands/architect.md is a stop-clean in-session shell", () => {
    const p = join(OMP_ROOT, "commands/architect.md");
    expect(existsSync(p)).toBe(true);
    const cmd = readFileSync(p, "utf8");
    expect(cmd).toMatch(/never auto|do \*\*not\*\*/i);
    expect(cmd).toMatch(/\/design/);
    expect(cmd).toMatch(/\/harness/);
    expect(cmd).toContain(RUNTIME_PATH);
    expect(cmd).toMatch(/docs\/adr/);
    expect(cmd).toMatch(/next free `?NNNN`?|NNNN/);
  });

  test("skills/architect/SKILL.md carries name + OMP ADR contract", () => {
    const p = join(SKILL_DIR, "SKILL.md");
    expect(existsSync(p)).toBe(true);
    const skill = readFileSync(p, "utf8");
    expect(skill).toMatch(/(^|\n)name:\s*architect(\n|$)/);
    expect(skill).toMatch(/MADR-lite/i);
    expect(skill).toMatch(/docs\/adr/);
    expect(skill).toMatch(/controller|session writes/i);
  });

  test("stub phrases are gone from live wiring", () => {
    for (const sub of ["skills", "workflows", "agents"]) {
      for (const f of walk(join(OMP_ROOT, sub))) {
        if (!/\.(md|ts|json)$/.test(f)) continue;
        const raw = readFileSync(f, "utf8");
        expect(raw, f).not.toMatch(/until then brainstorming only/i);
        expect(raw, f).not.toMatch(/architect[^\n]*exists later/i);
        expect(raw, f).not.toMatch(/Future architect/i);
      }
    }
  });

  test("vendored tree is link-clean, drops dead upstream files, and is complete", () => {
    // Link/guard sweep FIRST so adaptation failures surface file-by-file
    // (Task 3) before the completeness asserts (SKILL.md arrives in Task 4).
    const files = walk(SKILL_DIR).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const raw = readFileSync(f, "utf8");
      // Dead upstream content must not be vendored or referenced.
      expect(raw, f).not.toMatch(/\.\.\/software-/);
      expect(raw, f).not.toMatch(/architecture-trends-2026/);
      expect(raw, f).not.toMatch(/sources\.json/);
      expect(raw, f).not.toMatch(/adr-template\.md/);
      // Every markdown link must be root-relative (references/… or assets/…)
      // or external — and must resolve on disk.
      for (const m of raw.matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1].trim();
        if (/^(https?:|#|mailto:)/.test(target)) continue;
        expect(target, `${f} → ${target}`).toMatch(/^(references|assets)\//);
        expect(existsSync(join(SKILL_DIR, target.split("#")[0])), `${f} → ${target}`).toBe(true);
      }
      // Path mentions outside link syntax must resolve too.
      for (const m of raw.matchAll(/(?:references|assets)\/[A-Za-z0-9_./-]+\.md/g)) {
        expect(existsSync(join(SKILL_DIR, m[0])), `${f} → ${m[0]}`).toBe(true);
      }
    }
    // Completeness: exactly the ten kept upstream files + SKILL.md.
    for (const rel of VENDORED) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true);
    }
    expect(files.length).toBe(VENDORED.length);
  });

  test("design flow embeds architect by required path load", () => {
    for (const rel of [
      "skills/design-flow/SKILL.md",
      "agents/pdr-writer.md",
      "agents/arc42-writer.md",
      "workflows/design-flow.ts",
      "extensions/design-flow/workflow.ts",
    ]) {
      expect(readFileSync(join(OMP_ROOT, rel), "utf8"), rel).toContain(RUNTIME_PATH);
    }
    // Spec §7: ADR phase untouched by architect.
    const adr = readFileSync(join(OMP_ROOT, "agents/adr-writer.md"), "utf8");
    expect(adr).not.toMatch(/skills\/architect\/SKILL\.md/);
    // AGENTS.md documents the standalone entry.
    const agentsDoc = readFileSync(join(OMP_ROOT, "AGENTS.md"), "utf8");
    expect(agentsDoc).toMatch(/\/architect/);
  });

  test("design-manifest wires architect by name (writers only)", () => {
    const m = JSON.parse(
      readFileSync(join(OMP_ROOT, "agents/design-manifest.json"), "utf8"),
    ) as {
      agentCount: number;
      phases: string[];
      agents: Array<{ name: string; requiredSkills?: string[] }>;
    };
    const by = Object.fromEntries(
      m.agents.map((a) => [a.name, a.requiredSkills ?? []]),
    );
    expect(by["pdr-writer"]).toContain("architect");
    expect(by["pdr-writer"]).toContain("brainstorming");
    expect(by["pdr-writer"]).toContain("ponytail");
    expect(by["arc42-writer"]).toContain("architect");
    expect(by["arc42-writer"]).toContain("brainstorming");
    expect(by["adr-writer"]).not.toContain("architect");
    expect(by["adr-writer"]).toContain("ponytail");
    expect(by["adr-writer"]).not.toContain("brainstorming");
    expect(by["pdr-reviewer"] ?? []).not.toContain("architect");
    expect(by["arc42-reviewer"] ?? []).not.toContain("architect");
    expect(m.agentCount).toBe(5);
    expect(m.phases).toEqual(["Intake", "Pdr", "Arc42", "Adr", "Handoff"]);
  });

  test("cold catalog never resolves architect", () => {
    const roots = ["commands", "skills", "workflows", "agents", "extensions"];
    const files = roots.flatMap((r) => walk(join(OMP_ROOT, r)));
    files.push(join(OMP_ROOT, "AGENTS.md"), join(OMP_ROOT, "config.yml"));
    for (const f of files) {
      if (!/\.(md|ts|json|yml)$/.test(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toContain(COLD_NEEDLE);
    }
  });
});
```

Notes on deliberate choices (do not "fix" these):
- No byte-size assertion on SKILL.md — ≤9KB is a target, not a gate (spec-review nit 3).
- Dropped-file guard uses the path-form anchor `adr-template.md` (nit 4) so prose like "ADR template" can't false-positive.
- Manifest lookup is by `name` (nit 1).
- adr-writer negative uses the generic `skills/architect/SKILL.md` substring so it also fails on the divergent `~/.agents/...` form.
- Link/guard sweep runs before the completeness asserts inside the vendored-tree test so Task 3 can iterate on adaptation while `SKILL.md` doesn't exist yet.
- `modern-patterns.md` contains a TS snippet importing `'../orders/api/OrdersModule'` — the guards (`../software-`, root-relative rule on markdown links only) deliberately don't match plain code imports.

**Step 2: Run it to verify it fails in exactly the expected places**

Run: `bun test omp/tests/architect-entry.test.ts`
Expected: **FAIL** — command shell (missing file), SKILL.md (missing dir), vendored-tree (completeness: missing files), embedding (no `~/.omp/...` path anywhere; adr-writer currently *contains* an architect path), manifest (adr-writer contains `architect`). Expected **PASS** already: stub phrases, cold-catalog needle. If the failure set differs, the base state drifted — re-run Task 0 Step 1.

**DoneWhen:** test file exists; red/green split matches the list above.

---

### Task 2: Vendor references + assets from Kaan's pinned local tree

**Files:**
- Create: `omp/skills/architect/references/` (6 files), `omp/skills/architect/assets/{planning,patterns,operations}/` (4 files)

Source `~/.agents/skills/architect/` is byte-identical to upstream `vasilyu1983/AI-Agents-public@6a223ba1` for references/assets (verified sizes against the GitHub API listing) — copy locally, no network needed.

**Step 1: Create tree and copy exactly the ten kept files**

```bash
mkdir -p omp/skills/architect/references omp/skills/architect/assets/planning omp/skills/architect/assets/patterns omp/skills/architect/assets/operations
SRC=~/.agents/skills/architect
for f in modern-patterns scalability-reliability-guide data-architecture-patterns migration-modernization-guide api-gateway-service-mesh operational-playbook; do
  cp "$SRC/references/$f.md" omp/skills/architect/references/
done
cp "$SRC/assets/planning/architecture-blueprint.md" omp/skills/architect/assets/planning/
cp "$SRC/assets/patterns/microservices-template.md" "$SRC/assets/patterns/event-driven-template.md" omp/skills/architect/assets/patterns/
cp "$SRC/assets/operations/scalability-checklist.md" omp/skills/architect/assets/operations/
```

Fallback if the local tree is gone: fetch the same ten paths from `https://raw.githubusercontent.com/vasilyu1983/AI-Agents-public/6a223ba13c311c09b41c1dc09c14ab75e703894b/frameworks/shared-skills/skills/software-architecture-design/<references|assets>/...`.

**Step 2: Verify exactly ten files, none of the dropped three**

Run: `fd . omp/skills/architect -t f | sort`
Expected: exactly the 10 paths (no SKILL.md yet, no `data/`, no `architecture-trends-2026.md`, no `adr-template.md`).

**DoneWhen:** ten files vendored; dropped files absent.

---

### Task 3: Adapt vendored files (links + content per Spec §8)

**Files:**
- Modify: `omp/skills/architect/references/api-gateway-service-mesh.md:594-597`
- Modify: `omp/skills/architect/references/data-architecture-patterns.md:607-610`
- Modify: `omp/skills/architect/references/migration-modernization-guide.md:559-561`
- Modify: `omp/skills/architect/references/operational-playbook.md:104,~145-EOF`
- Modify: `omp/skills/architect/assets/planning/architecture-blueprint.md`

Line numbers are exact for the pinned copies. Keep every other line of every vendored body untouched — this is a link/contract adaptation, not an edit pass.

**Step 1: `api-gateway-service-mesh.md` related section (lines 594-597)** — replace the four bullets with:

```markdown
- [references/data-architecture-patterns.md](references/data-architecture-patterns.md) — Service-to-service data patterns
- Platform, deploy, and service implementation depth: OMP `stack-*` packs (load `~/.omp/agent/skills/stack-*/SKILL.md` on demand)
- Zero-trust / mTLS checklist: [references/operational-playbook.md](references/operational-playbook.md) security section
```

**Step 2: `data-architecture-patterns.md` related section (lines 607-610)** — replace with:

```markdown
- [references/scalability-reliability-guide.md](references/scalability-reliability-guide.md) — CAP theorem, database scaling, caching strategies
- Database/queue implementation specifics (PostgreSQL, Kafka, BullMQ…): OMP `stack-*` packs, or live `web_search`
- [assets/patterns/event-driven-template.md](assets/patterns/event-driven-template.md) — Event-driven architecture template with saga patterns
```

**Step 3: `migration-modernization-guide.md` related section (lines 559-561)** — replace with:

```markdown
- [references/api-gateway-service-mesh.md](references/api-gateway-service-mesh.md) — Service mesh and gateway patterns for microservices
- Service-level implementation and CI/CD depth: OMP `stack-*` packs
```

**Step 4: `operational-playbook.md`** — two edits:
1. Line 104: replace the sentence `**IMPORTANT:** For comprehensive security patterns, see [../software-security-appsec/SKILL.md](../../software-security-appsec/SKILL.md) which covers:` with `**IMPORTANT:** Cover these security patterns in any design (go deeper via live web_search or stack packs):` — the bullet list below it stays as the inline checklist.
2. Delete the trailing sources section: from its heading (the one introducing `See [data/sources.json](../data/sources.json) for 42 curated references`, around line 145-150) through end of that section. Current-trend lookups are live `web_search` in OMP.

**Step 5: `architecture-blueprint.md`** — insert after the intro line `Use this when drafting a new service or major redesign.`:

```markdown
> **OMP storage:** deliver this blueprint in session / bd notes by default. The only files written are ADRs under `docs/adr/` — and only after user confirmation.
```

**Step 6: Run the link-integrity subtest and fix every flag**

Run: `bun test omp/tests/architect-entry.test.ts -t "vendored tree"`
The link/guard sweep runs before completeness, so every remaining bad link surfaces now — including sibling-relative forms the preparatory greps didn't list (e.g. bare `[x](data-architecture-patterns.md)` links inside `references/` files; rewrite each to root-relative `references/...`). Iterate until the only failures left are the completeness asserts (missing `SKILL.md`).

**DoneWhen:** `rg -n '\.\./|sources\.json|architecture-trends|adr-template' omp/skills/architect/` returns only the `modern-patterns.md` TS-import line (`'../orders/api/OrdersModule'`); vendored-tree subtest fails only on SKILL.md completeness.

---

### Task 4: Write `omp/skills/architect/SKILL.md` (full rewrite)

**Files:**
- Create: `omp/skills/architect/SKILL.md`

Base: Kaan's `~/.agents/skills/architect/SKILL.md` (salvage), adjusted to Spec §8. Target ≤9KB (guideline, not test). Write exactly:

```markdown
---
name: architect
description: >
  System-level software architecture: candidate comparison, quality attributes,
  boundaries, data strategy, operations. Standalone via /architect (in-session
  consult) and embedded in /design (required on PDR/Arc42 writers). Load by
  path ~/.omp/agent/skills/architect/SKILL.md — never cold skill.
---

# Architect — OMP software architecture skill

System-level design: boundaries, patterns, data, ops. Not single-service
implementation detail (stack packs cover that), not code review
(`/code-review`), not the full gated design pipeline (`/design`).

## When to use / when not

| Use | Don't use — go here instead |
|-----|------------------------------|
| New system or major redesign | Single-service implementation details → `stack-*` packs |
| Monolith / microservices / serverless choice | Reviewing an existing diff → `/code-review` |
| Scale, resilience, data-consistency strategy | Reviewed PDR + Arc42 + ADR set → `/design` |
| Migration / modernization planning | Building the thing → `/harness` |

## OMP load contract

| | |
|--|--|
| **Path** | `~/.omp/agent/skills/architect/SKILL.md` (repo: `omp/skills/architect/`) |
| **Cold catalog** | Never cold-listed (cold is intent-router+beads only) |
| **Standalone** | `/architect <question>` runs the workflow below in-session |
| **Embedded** | `/design`: **required** on `pdr-writer` + `arc42-writer`; `adr-writer` stays architect-free |
| **References** | Read on demand under this directory; never paste bodies into agent prompts |
| **Ships via** | `omp/link.sh` `skills` symlink → `~/.omp/agent/skills/architect/` |

## OMP flow map

| Surface | This skill contributes |
|---------|------------------------|
| `/architect` | Steps 1–8 inline: consult → blueprint-form recommendation; ADRs only after user confirmation |
| `/design` PDR | Steps 1–2: problem framing, non-goals, constraints, quality attributes, scope limits |
| `/design` Arc42 | Steps 3–6: candidates + tradeoffs, boundaries, data strategy, operations |
| `/design` ADR | Steps 7–8 land as MADR-lite records via `adr-writer` (JSON only); drivers arrive through PDR/Arc42 content |

Augments Superpowers `brainstorming`; never replaces it. Never auto-starts
`/design` or `/harness`.

## ADR contract (OMP — MADR-lite)

Fields: `title`, `status` ∈ proposed|accepted|deprecated|superseded, `context`,
`decision`, `consequences`, optional `date`. Files live only at
`docs/adr/NNNN-slug.md`, written by the controller/session — agents emit JSON.
Few decisive ADRs over essay sprawl; skip ADRs for easily reversible choices.

## Quick reference

| Task | Pattern / tool | Dig deeper |
|------|----------------|------------|
| Architecture style | Layered, modular monolith, microservices, event-driven, serverless | `references/modern-patterns.md` |
| Scale | LB, cache, shard, read replicas | `references/scalability-reliability-guide.md` |
| Resilience | Circuit breaker, retry, bulkhead, degradation | `references/scalability-reliability-guide.md` |
| Service boundaries | DDD, bounded contexts | `assets/patterns/microservices-template.md` |
| Data consistency | ACID/BASE, CQRS, saga, event sourcing | `references/data-architecture-patterns.md` |
| Inter-service | API gateway, mesh, BFF | `references/api-gateway-service-mesh.md` |
| Migrate monolith | Strangler, DB split, shadow traffic | `references/migration-modernization-guide.md` |
| ADR (OMP) | MADR-lite; controller/session writes `docs/adr/NNNN-slug.md` | ADR contract above |
| Blueprint | Consult deliverable shape | `assets/planning/architecture-blueprint.md` |

## Decision tree (style)

```text
New system or major refactor
  ├─ Single team, evolving domain?
  │   ├─ Start simple → Modular monolith
  │   └─ Rapid iteration → Layered
  ├─ Multiple teams, clear bounded contexts?
  │   ├─ Independent deploy critical → Microservices
  │   └─ Shared data model → Modular monolith + modules
  ├─ Event-driven workflows?
  │   ├─ Async processing → EDA (Kafka/queues)
  │   └─ Complex sagas → Saga + event sourcing
  ├─ Variable load / pay-per-use → Serverless
  └─ Strong ACID → Monolith or modular monolith
```

**Defaults:** teams under 10 developers → modular monolith usually beats
microservices ops cost.

## Decision drivers & reversibility

Rank drivers per decision to make tradeoffs explicit (reorder freely):

| Priority | Driver | Measured by |
|---:|---|---|
| 1 | Reliability | SLO, error budget |
| 2 | Security | Threat model, control coverage |
| 3 | Cost | Unit cost, infra spend |
| 4 | Delivery speed | Lead time, deployment frequency |
| 5 | Operability | On-call load, MTTR |

Every candidate option carries **Reversibility: Easy / Medium / Hard**. Prefer
reversible; document the hard-to-reverse ones as ADRs.

## Workflow (system-level)

1. Clarify problem, non-goals, constraints, success metrics
2. Capture quality attributes (availability, latency, throughput, durability, consistency, security, cost)
3. Propose 2–3 candidates + tradeoffs (drivers table above)
4. Boundaries: contexts, ownership, APIs/events
5. Data strategy
6. Ops: SLOs, failure modes, observability, DR
7. Scope limits: what NOT to build, defer, buy vs build
8. Decisive ADRs only (MADR-lite; confirm before writing files)

Current-trend questions: live `web_search` — no vendored trend digests.

## Output discipline

- Absorb references; **do not** cite internal filenames in user-facing prose.
- Concrete technology picks (not only pattern names).
- Explicit **what NOT to build** / defer (YAGNI, ponytail).
- Team/ownership implications when relevant.
- Success metrics (deploy frequency, lead time, error rate, MTTR).
- Depth on 3–5 decisions that matter — not exhaustive essays.
- OMP ADR path: JSON from `adr-writer`; controller/session owns `docs/adr/NNNN-slug.md`.

## Navigation

Read **at most 2–3** references per question.

| Reference | When |
|-----------|------|
| `references/modern-patterns.md` | Pattern choice |
| `references/scalability-reliability-guide.md` | Scale / SRE |
| `references/data-architecture-patterns.md` | Cross-service data |
| `references/migration-modernization-guide.md` | Monolith split |
| `references/api-gateway-service-mesh.md` | Mesh / gateway |
| `references/operational-playbook.md` | Framing questions, security checklist |

Templates: `assets/planning/architecture-blueprint.md`,
`assets/patterns/microservices-template.md`,
`assets/patterns/event-driven-template.md`,
`assets/operations/scalability-checklist.md`.

## Related OMP surfaces

- `/design` — gated multi-agent pipeline (reviewed PDR + Arc42 + ADR)
- `stack-*` packs — language/platform implementation depth
- `/code-review` — review implementations against this architecture

<!-- provenance: vendored from https://github.com/vasilyu1983/AI-Agents-public
     frameworks/shared-skills/skills/software-architecture-design
     @ 6a223ba13c311c09b41c1dc09c14ab75e703894b (fetched 2026-08-01).
     Adapted for OMP: intentional fork, not a mirror. MADR-lite ADR contract,
     OMP flow map, root-relative links; dropped architecture-trends-2026,
     data/sources dump, upstream ADR form. Refresh manually if ever needed. -->
```

(The frontmatter description ends "never cold skill." without a `://architect` suffix, and the cold-catalog row says "Never cold-listed", deliberately — the vendored tree must not trip the repo-wide cold-needle guard.)

**Step 2: Run the two skill subtests**

Run: `bun test omp/tests/architect-entry.test.ts -t "architect"`
Expected: "carries name + OMP ADR contract" PASS; "vendored tree" PASS (11 files now). Command/embedding/manifest subtests still red.

**DoneWhen:** both skill-side subtests green; `wc -c omp/skills/architect/SKILL.md` ≈ ≤9000 (guideline — do not add a test for it).

---

### Task 5: Write `omp/commands/architect.md`

**Files:**
- Create: `omp/commands/architect.md`

Mirror of `design.md`'s shell shape (Spec §6). Write exactly:

```markdown
---
name: architect
description: Empty shell — in-session architecture consult. Loads architect skill on invoke. Never auto-starts /design or /harness.
---

# /architect

**Empty shell.** Expand `$ARGUMENTS` as bound architecture question (required; ask once if empty). Bound text is the only goal — never invent a second one.

**vs `/design`:** `/architect` = single-session consult (recommendation + optional ADRs). `/design` = gated multi-agent pipeline (reviewed PDR + Arc42 + ADR). Neither auto-starts the other.

## On invoke only

1. Load by **path** (cold catalog is only intent-router+beads — not `skill://` for these):
   - `~/.agents/skills/superpowers/using-superpowers/SKILL.md`
   - `~/.omp/agent/skills/architect/SKILL.md`
   - `~/.agents/skills/superpowers/brainstorming/SKILL.md`
2. Run the skill's 8-step workflow **in-session** — no subagents, no extension, no gates. Research via `web_search` / context7 as needed.
3. Deliverable: blueprint-form recommendation (see the skill's `assets/planning/architecture-blueprint.md`) in session; bd best-effort notes when an issue is available. **No files written by default.**
4. **ADRs (optional):** only decisive, hard-to-reverse choices **and** after user confirmation. MADR-lite body; session writes `docs/adr/NNNN-slug.md` — list `docs/adr/` immediately before writing and take the next free `NNNN`. Never under `docs/superpowers/` or `docs/plans/`.
5. **Stop.** Do **not** auto-start `/design` or `/harness`; handoff may suggest `nextStep` (`/design <goal>` for the full pipeline, `/harness <goal>` to build).
```

**Step 2: Run the command subtest**

Run: `bun test omp/tests/architect-entry.test.ts -t "commands/architect"`
Expected: PASS.

**DoneWhen:** command subtest green; only embedding + manifest subtests remain red.

---

### Task 6: Migrate wiring to Spec state (single batch — 9 files + old-test removal)

**Files:**
- Modify: `omp/skills/design-flow/SKILL.md:6,41-45`
- Modify: `omp/workflows/design-flow.ts:32`
- Modify: `omp/extensions/design-flow/workflow.ts:296-301,330-336,365-372`
- Modify: `omp/agents/pdr-writer.md:19`
- Modify: `omp/agents/arc42-writer.md:19`
- Modify: `omp/agents/adr-writer.md:18`
- Modify: `omp/agents/design-manifest.json` (adr-writer requiredSkills)
- Modify: `omp/commands/design.md:14-19`
- Modify: `omp/README.md:44-46`
- Modify: `omp/AGENTS.md` (~:25 not-cold list, ~:52 flows table)
- Delete: `omp/tests/design-architect-wiring.test.ts`

All are string edits; no control flow changes. Use `tokensave_str_replace` / `sd` per file.

**Step 1: `skills/design-flow/SKILL.md`**
- Frontmatter description tail: `Loads architect skill by path when installed.` → `Architect skill loads here.`
- Skills list block — replace lines 42-44 (`- \`~/.agents/skills/architect/SKILL.md\` on **writers** when present (PDR, Arc42, ADR)` plus its two sub-bullets) with one clean bullet (mangled-markdown nit 2 resolved by writing it fresh):

```markdown
- `~/.omp/agent/skills/architect/SKILL.md` (`architect`) — required on PDR/Arc42 writers; never cold-listed; never vendor its body into prompts
```

**Step 2: `workflows/design-flow.ts:32`** — replace the controllerPolicy line

```ts
      "Writers path-load ~/.agents/skills/architect/SKILL.md when present (fail-open if missing); do not vendor skill bodies.",
```
with (Spec §5 modulo the deviation register — acceptance §10.3 forbids the literal):
```ts
      "Architect skill: writers load ~/.omp/agent/skills/architect/SKILL.md by path (never cold skill://).",
```
Keep line 28's parent-skills path-load sentence exactly as it now is — that fix is good and spec-compatible.

**Step 3: `extensions/design-flow/workflow.ts`** — three prompt edits:
- PDR block (lines 296-301): replace the middle two strings so the array reads

```ts
    writerPrompt: [
      "Write a PDR for this design goal (design only, no code).",
      "Path-load ~/.agents/skills/superpowers/brainstorming/SKILL.md (never skill:// under cold catalog).",
      "Load architect skill by path ~/.omp/agent/skills/architect/SKILL.md (quality attributes, constraints).",
      "Produce strict PDR JSON.",
      `Goal:\n${boundGoal}`,
    ].join("\n"),
```
- Arc42 block (lines 330-336):

```ts
    writerPrompt: [
      "Write Arc42 architecture JSON + at least one mermaid/structurizr diagram.",
      "Design only. Align with accepted PDR.",
      "Path-load ~/.agents/skills/superpowers/brainstorming/SKILL.md (never skill:// under cold catalog).",
      "Load architect skill by path ~/.omp/agent/skills/architect/SKILL.md (candidates, boundaries, data, ops).",
      `Goal:\n${boundGoal}`,
      `PDR:\n${JSON.stringify(pdrGate.candidate)}`,
    ].join("\n"),
```
- ADR block (line 369): **revert** to the pre-e87d2a5b original (Spec §7: ADR phase unchanged):

```ts
        "Controller will write docs/adr/NNNN-slug.md only.",
```

**Step 4: `agents/pdr-writer.md:19` and `agents/arc42-writer.md:19`** — replace the fail-open bullet in each with:

```markdown
- `~/.omp/agent/skills/architect/SKILL.md` (`architect`) — required
```
Keep the `~/.agents/skills/ponytail/SKILL.md` bullets above them.

**Step 5: `agents/adr-writer.md:18`** — delete the architect bullet entirely (the line ending `when present — fail-open if missing`). Keep the ponytail path-form bullet — cosmetic consistency, not a contract change.

**Step 6: `agents/design-manifest.json`** — adr-writer entry only: `"requiredSkills": ["ponytail", "architect"]` → `"requiredSkills": ["ponytail"]`. pdr-writer/arc42-writer keep `["brainstorming", "ponytail", "architect"]` (already correct).

**Step 7: `commands/design.md`** — remove line 17 (`3. **Writers** path-load ~/.agents/skills/architect/SKILL.md …`) and renumber back to the original four steps (`3. ADRs only under docs/adr/…`, `4. **Stop.**…`). Spec §5 does not modify design.md; writer skill loading is documented in design-flow SKILL + agents.

**Step 8: `README.md:44-46`** — replace the three-line nix-setup note with:

```markdown
PDR/Arc42 writers path-load `~/.omp/agent/skills/architect/SKILL.md`
(required; vendored at `omp/skills/architect/`, shipped by the `link.sh`
`skills` symlink; upstream pin in the SKILL.md provenance footer).
```

**Step 9: `AGENTS.md`** — two edits:
- Not-cold-loaded list (~line 25): add `architect` → `- **Not cold-loaded:** Superpowers workflow skills, \`goal-harness\`, \`design-flow\`, \`architect\`, \`ponytail\`(+review/audit), \`stack-*\` routers, domain pack globs. Flows load them live when invoked.`
- Flows table (~line 52), new row directly under the `/design` row:

```markdown
| `/architect` | empty shell → `using-superpowers`, `architect`, `brainstorming` (by path) — in-session consult; ADRs optional under `docs/adr/`; never auto-starts `/design` or `/harness` |
```

**Step 10: remove the superseded test**

Run: `git rm omp/tests/design-architect-wiring.test.ts`
(Assertion coverage moved into `architect-entry.test.ts` per the Task 1 mapping.)

**Step 11: Run the full new test**

Run: `bun test omp/tests/architect-entry.test.ts`
Expected: **all 7 subtests PASS**.

**DoneWhen:** new test fully green; `rg -n 'agents/skills/architect|fail-open' omp/` → 0 matches; `rg -c 'architect' omp/extensions/design-flow/workflow.ts` → `2` (only the PDR + Arc42 load lines).

---

### Task 7: Repo-wide regression + guard sweep

**Files:** none (verification only)

**Step 1: Full suite**

Run: `bun test omp/tests/`
Expected: same pass count as the Task 0 baseline **plus** the new test's cases, **minus** the deleted file's 5; zero fails. Notably green: `design-entry.test.ts` (design.md revert restores its expected shape), `design-manifest.test.ts`, `design-ponytail-wiring.test.ts`, `lean-config.test.ts`, `skill-loading.test.ts`, parity tests.

**Step 2: Guard greps (each must print nothing)**

```bash
rg -n "skill://architect" omp/
rg -n "until then brainstorming only|architect.*exists later|Future architect" omp/skills omp/workflows omp/agents
rg -n "~/.agents/skills/architect" omp/
rg -n "architecture-trends-2026|sources\.json|adr-template\.md" omp/skills/architect/
```

**Step 3: Cold catalog untouched**

Run: `git diff HEAD --stat -- omp/config.yml`
Expected: no output (file untouched; `includeSkills` still exactly intent-router+beads — also enforced by `lean-config.test.ts`).

**DoneWhen:** all four greps empty; full suite green; config.yml untouched.

---

### Task 8: Linker smoke (zero link.sh changes)

**Files:** none (verification only — `link.sh` links the `skills` directory wholesale; a new subtree ships free)

**Step 1: Link, check runtime file, re-link for idempotence**

```bash
sh omp/link.sh
test -f ~/.omp/agent/skills/architect/SKILL.md && echo SKILL_LINKED
sh omp/link.sh && echo IDEMPOTENT
git diff --stat -- omp/link.sh
```
Expected: `SKILL_LINKED`, `IDEMPOTENT`, and an empty diff for `link.sh`.

**Step 2: Existing linker test still green**

Run: `sh omp/tests/link.test.sh`
Expected: passes as before.

**DoneWhen:** all three expectations met.

---

### Task 9: Commit + bd sync

**Step 1: Stage exactly the feature files** (never the unrelated dirty files from the reconciliation note)

```bash
git add omp/skills/architect omp/commands/architect.md omp/tests/architect-entry.test.ts \
  omp/skills/design-flow/SKILL.md omp/workflows/design-flow.ts omp/extensions/design-flow/workflow.ts \
  omp/agents/pdr-writer.md omp/agents/arc42-writer.md omp/agents/adr-writer.md omp/agents/design-manifest.json \
  omp/commands/design.md omp/README.md omp/AGENTS.md
git status --short   # verify: staged set above + deleted test (already staged by git rm); nothing else
```

**Step 2: Commit**

```bash
git commit -m "feat(omp): architect skill — /architect command + /design embedding

Vendor adapted software-architecture-design as omp/skills/architect
(upstream 6a223ba, MADR-lite ADR contract; trends/sources/adr-template
dropped). Add /architect empty-shell command. Require the skill on
pdr-writer/arc42-writer; adr-writer stays architect-free. Migrate the
interim ~/.agents/skills/architect fail-open wiring (e87d2a5b) to the
approved spec path + required load. Replace design-architect-wiring
test with architect-entry contract test."
```

**Step 3: bd bookkeeping**

```bash
bd close <implement-issue-id>
bd update dotfiles-8mu --comment "architect skill landed: omp/skills/architect + /architect + /design embedding; e87d2a5b migrated to spec state"
bd dolt push
```

**DoneWhen:** one feature commit; omp/ clean; bd synced.

---

### Task 10: Manual smoke + operator follow-ups (record in bd, not automated — Spec §10.6)

**Step 1: Scratch-session smoke** (record results as a bd comment on the epic):
- `/architect <question>` → loads the three paths, produces a candidate-compared recommendation with a what-NOT-to-build section, writes no files without confirmation, ends with a `nextStep` suggestion and does **not** start another flow.
- `/design <goal>` → runs end-to-end; PDR/Arc42 writers load the architect path; ADR phase behaves as before.

**Step 2: ASK KAAN (do not act unilaterally — out-of-repo property):** `~/.agents/skills/architect/` (and its claimed source `nix-setup/modules/agents/skills/architect`) is now a stale duplicate: unadapted upstream copy, contains the three dropped files, and its `name: architect` collides with the vendored skill in OMP's `customDirectories` resolve space. **Recommend removal/retirement** to avoid dual SoT; keeping it for cross-host use is the deferred Spec §11 item and should then live under a different plan. Record his decision in bd.

**Step 3: Optional docs commit** — `docs/plans/2026-08-01-omp-architect-skill.md` (this plan) may be committed separately (`docs:` prefix). bd stays the SoT; the feature commit from Task 9 stays pure of `docs/plans/**`.

**DoneWhen:** smoke recorded in bd; Kaan's disposition for the `~/.agents` copy recorded; epic updated.

---

## Spec §10 acceptance mapping (exact)

| Spec §10 criterion | Where satisfied | Verify |
|---|---|---|
| 10.1.1 command contract (`never auto`/`do **not**`, `/design`+`/harness`, skill path, `docs/adr`) | Task 5; subtest "commands/architect.md is a stop-clean in-session shell" | `bun test omp/tests/architect-entry.test.ts -t "commands/architect"` |
| 10.1.2 SKILL frontmatter `name: architect` + MADR-lite/`docs/adr` | Task 4; subtest "carries name + OMP ADR contract" | `bun test omp/tests/architect-entry.test.ts -t "carries name"` |
| 10.1.3 stubs gone in `omp/{skills,workflows,agents}` | Base e87d2a5b already removed them; Task 1 subtest "stub phrases are gone" guards regressions (incl. `Future architect`) | same test file |
| 10.1.4 link integrity; no `../software-`; no trends/sources/`adr-template.md` | Tasks 2-4; subtest "vendored tree is link-clean…" | `bun test omp/tests/architect-entry.test.ts -t "vendored tree"` |
| 10.1.5 embedding files match `skills/architect/SKILL.md` | Task 6 steps 1-4; subtest "design flow embeds architect" (asserts **both** `workflows/design-flow.ts` and `extensions/design-flow/workflow.ts`, exceeding the spec's either/or) | `bun test omp/tests/architect-entry.test.ts -t "embeds"` |
| 10.1.6 manifest: architect in pdr+arc42, not adr; agentCount 5; phases unchanged | Task 6 step 6; subtest "design-manifest wires architect by name" | `bun test omp/tests/architect-entry.test.ts -t "manifest"` |
| 10.2 full suite green | Task 7 step 1 | `bun test omp/tests/` |
| 10.3 cold catalog frozen; `skill://architect` → 0 | Task 7 steps 2-3 + subtest "cold catalog never resolves architect"; `lean-config.test.ts` enforces exact includeSkills; see deviation register for the controllerPolicy wording | greps in Task 7 |
| 10.4 link.sh works unmodified, idempotent | Task 8 | commands in Task 8 |
| 10.5 purity (no `docs/superpowers/**`, `docs/plans/**` in feature change, no goal-harness/ADR-schema/model-router edits) | Task 9 staging list is exhaustive; plan doc committed separately (Task 10.3) | `git show --stat HEAD` after Task 9 |
| 10.6 manual smoke recorded in bd | Task 10 step 1 | bd comment on dotfiles-8mu |

## bd task mapping (suggested — Main/implementer creates)

```bash
bd create --title="architect impl 1/4: failing architect-entry contract test" --type=task   # Tasks 0-1
bd create --title="architect impl 2/4: vendor + adapt skill tree, SKILL.md rewrite" --type=task   # Tasks 2-4
bd create --title="architect impl 3/4: /architect shell + spec wiring migration (e87d2a5b → spec)" --type=task   # Tasks 5-6
bd create --title="architect impl 4/4: regression, link smoke, commit, bd sync, operator follow-ups" --type=task   # Tasks 7-10
bd dep add <impl-2> <impl-1>; bd dep add <impl-3> <impl-2>; bd dep add <impl-4> <impl-3>
```

All four under epic dotfiles-8mu, after Plan issue dotfiles-8mu.2 closes. Tasks 2-6 must land in **one** commit (nit 6) — the issue split is for tracking, not commit boundaries.

## Rollback

Single-commit feature: `git revert <feature-sha>` restores e87d2a5b's interim state cleanly (including its test). The `~/.agents/skills/architect/` tree is untouched by this change either way.

## Out of scope (repeat of Spec §2/§11 — do not do these)

No intent-router route, no cross-host skill copy, no architect agent/model-router phase, no adr-writer enrichment, no goal-harness integration, no `config.yml`/`link.sh`/schema edits, no re-vendoring trends/sources, no `commands/harness.md`.
