/**
 * Pi goal-harness controller (standalone — no ~/.omp path loads).
 *
 * Methodology: Bigpowers (npm:bigpowers) — Superpowers removed (ADR-0001).
 * Task SoT: bd primary; specs/ optional bridge (ADR-0002).
 *
 * Primary entry: /harness
 * Also: /design /architect /architect-layered /init
 * Exact /code-review is owned by dynamic-workflows (not registered here).
 * Exact /pr-reviewer is owned by extensions/pr-reviewer.ts (local freeze).
 *
 * Hard OMP createAgentSession gates are NOT ported. Structured soft process:
 *   - hashline-edit-pro (read/replace)
 *   - pi-background-tasks (bg_run / bg_delegate)
 *   - dynamic-workflows (parallel agents)
 *   - bd (SoT)
 *   - local skills/agents under ~/.pi/agent
 *   - Bigpowers skills under package install path
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

/** Installed via `pi install npm:bigpowers@…` */
const BIGPOWERS = "~/.pi/agent/npm/node_modules/bigpowers/skills"
const PI_SKILLS = "~/.pi/agent/skills"
const PI_ADAPTERS = "~/.pi/agent/skills/adapters"
const PI_AGENTS = "~/.pi/agent/agents"
const PI_SCHEMAS = "~/.pi/agent/schemas"
const PI_TEMPLATES = "~/.pi/agent/templates"
const PONYTAIL =
  "~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/skills/ponytail"
const PONYTAIL_REVIEW =
  "~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/skills/ponytail-review"
const GRAPHIFY = "~/.pi/agent/skills/graphify"
const CONTEXT_MODE =
  "~/.pi/agent/npm/node_modules/context-mode/skills/context-mode"

/** Empty-/harness default quality goal (8 lines). */
const DEFAULT_HARNESS_GOAL = [
  "1. No errors, no warnings, no test failures.",
  "2. No warning suppressions in production (test-only OK with reason).",
  "3. Everything wired — no stubs, TODO/TBD/FIXME, unfinished work.",
  "4. Mandated skills: using-bigpowers + stack packs + ponytail + caveman + tokensave + graphify + context-mode (path-load).",
  "5. Latest dependencies — verify on the web (not training data alone).",
  "6. Complete all bd-tracked spec/plan tasks (Bigpowers discipline; every bite has verify:).",
  "7. Specs, plans, goals, updates tracked in bd (SoT). Optional specs/ cockpit via bp-bd-bridge only.",
  "8. Do not add unnecessary docstrings or comments; explanatory comments only where needed.",
].join("\n")

const RESEARCH_MODEL_ROUTE = [
  { provider: "xai", modelId: "grok-4.5", effort: "high" },
  { provider: "xai-oauth", modelId: "grok-4.5", effort: "high" },
  { provider: "openai-codex", modelId: "gpt-5.6-sol", effort: "medium" },
] as const

type Notify = (m: string, k?: "info" | "warning" | "error") => void

function requireArgs(args: string, usage: string, notify: Notify): string | null {
  const t = args.trim()
  if (!t) {
    notify(usage, "warning")
    return null
  }
  return t
}

function packageContractsBlock(): string[] {
  return [
    "### Package contracts (required)",
    "",
    "**Hashline** ([pi-hashline-edit-pro](https://pi.dev/packages/pi-hashline-edit-pro?name=read)):",
    "- Built-in `edit` is DISABLED. Only `read` → `replace`.",
    "- `read` lines: `HASH│content` (3-char). Optional offset/limit.",
    "- `replace`: `{ path, hash_bounds: [start,end], new_content }` inclusive; `\"\"` deletes.",
    "- `undo_last_replace` for last edit on that file. Stale anchors → re-`read`.",
    "- Never paste `HASH│` or diff-preview rows into `new_content`.",
    "",
    "**Background** ([pi-background-tasks](https://pi.dev/packages/pi-background-tasks?name=read)):",
    "- Long shell: `bg_run` `{ name, command, isAgent:false }` or `/bg` — wait notify, **do not poll**.",
    "- Inspect scout: `bg_delegate` capability=inspect → later `bg_result` (hash-verified).",
    "- Not sandboxed (host perms/network).",
    "",
    "**Parallel multi-step**: dynamic-workflows `/workflows run …` or keyword `workflow`.",
    "- `agent(prompt, { tier: 'small'|'medium'|'big', isolation: 'worktree' })`",
    "- Prefer registered `agentType` under `~/.pi/agent/agents/*.md`.",
    "- tiers: `~/.pi/workflows/model-tiers.json`",
    "",
    "**Fusion** (`fusion_*` / `/fusion`): multi-model opinion only — not a bd gate substitute.",
    "",
    "**Bigpowers**: methodology only. Do not run stock `orchestrate-project` as a second harness.",
    "",
    "**In use (required):** ponytail (minimal code), caveman (terse prose — npm:pi-caveman), tokensave (live symbols), graphify (architecture/corpus graph), context-mode (flood control).",
    "- tokensave = callers/impact/edits. graphify = structure Q&A when graphify-out/ exists or after `/graphify .`. Not substitutes.",
    "- File **edits** stay hashline `read`/`replace` (built-in `edit` disabled).",
    "- Large/unknown output → `ctx_execute`. File analysis (not edit) → `ctx_execute_file`. 3+ related commands → `ctx_batch_execute`.",
    "- Shell CLIs (git, rg, fd, bun test) → bash. Do not wrap those in ctx_execute.",
    "",
  ]
}

function buildHarnessStart(goal: string, usedDefault: boolean, cwd: string): string {
  return [
    "kind: goal-harness-start",
    "host: pi",
    "mode: structured-soft (hard OMP SessionManager gates NOT ported)",
    "methodology: bigpowers (ADR-0001); bd primary SoT (ADR-0002); review adapter (ADR-0003)",
    `repository root (authoritative): ${cwd}`,
    "",
    usedDefault
      ? "Bound goal: DEFAULT quality requirements (empty /harness args):"
      : "Bound goal (verbatim — only goal):",
    goal,
    "",
    "## Controller instructions",
    "",
    "You are the **Pi harness controller**. Drive the bound goal end-to-end using Pi packages + bd + Bigpowers skills.",
    "Do not invent a second goal. Do not claim OMP-hard dual-review Milestone PASS without evidence.",
    "The parent session is the research controller only. Delegate writer/reviewer/implementer work to routed agents; never execute those phases on the parent model.",
    "",
    "### Setup (do first)",
    "1. Run `bd -C <repository-root> where`. STOP unless path is `<repository-root>/.beads` and prefix matches repository basename.",
    "2. Path-load adapters + methodology (absolute `read`):",
    `   - ${PI_ADAPTERS}/bp-bd-bridge/SKILL.md`,
    `   - ${BIGPOWERS}/using-bigpowers/SKILL.md (once per session/project onboarding — then stop re-reading every turn)`,
    `   - ${BIGPOWERS}/survey-context/SKILL.md (resume / next-step if specs/ or prior bd epic exists)`,
    `   - ${PONYTAIL}/SKILL.md`,
    "   - caveman: already loaded as npm:pi-caveman (terse prose; not a SKILL.md)",
    `   - ${GRAPHIFY}/SKILL.md`,
    `   - ${CONTEXT_MODE}/SKILL.md`,
    `   - ${PI_SKILLS}/goal-harness/SKILL.md`,
    "3. Stack packs on demand (Cargo/Xcode/Android/GCP markers):",
    `   - ${PI_SKILLS}/stack-rust/SKILL.md | stack-ios | stack-android | stack-gcp`,
    "",
    ...packageContractsBlock(),
    "### Process (ordered)",
    "1. **Research** — DW `tier: 'small'` then path-load",
    `   - ${PI_AGENTS}/research-orchestrator.md (required; commissions scouts)`,
    `   - ${BIGPOWERS}/research-first/SKILL.md`,
    `   - ${BIGPOWERS}/map-codebase/SKILL.md`,
    "   - tokensave MCP for live symbols; graphify for architecture/corpus",
    `   path-load ${PI_AGENTS}/code-graph-scout.md / code-search-scout / docs-scout / web-scout (then web-browse → webwright → browser-use).`,
    "2. **Architect → design** (if the bound goal needs design):",
    `   - ${PI_AGENTS}/assumption-griller.md (required gate; ${BIGPOWERS}/grill-me/SKILL.md)`,
    `   - then /design or ${PI_SKILLS}/design-flow/SKILL.md — consume architecture-handoff`,
    "3. **Spec** — short design/spec in session + bd. Path-load",
    `   - ${BIGPOWERS}/elaborate-spec/SKILL.md`,
    `   - ${PI_AGENTS}/spec-writer.md when using DW agentType`,
    "   Consume design-handoff. Human confirm before large implementation.",
    "4. **Plan** — ordered bite-sized **bd** tasks; every task body includes `verify: <cmd>`. Path-load",
    `   - ${PI_AGENTS}/impact-assessor.md (required when touching existing modules; ${BIGPOWERS}/assess-impact/SKILL.md)`,
    `   - ${BIGPOWERS}/scope-work/SKILL.md → ${BIGPOWERS}/slice-tasks/SKILL.md → ${BIGPOWERS}/plan-work/SKILL.md`,
    `   - ${PI_ADAPTERS}/bp-plan-to-bd/SKILL.md (bd output contract)`,
    "5. **Implement** — one task at a time; TDD evidence; hashline `read`/`replace` only. Path-load",
    `   - ${BIGPOWERS}/kickoff-branch/SKILL.md (worktree/branch; harness still owns assignment policy)`,
    `   - ${BIGPOWERS}/develop-tdd/SKILL.md`,
    `   - ${PI_ADAPTERS}/dispatch-via-dw/SKILL.md when parallel/delegate`,
    `   - ${BIGPOWERS}/delegate-task/SKILL.md and/or ${BIGPOWERS}/dispatch-agents/SKILL.md (policy only — execute via DW)`,
    `   - Implementer role: ${PI_AGENTS}/implementer.md`,
    `   - Evidence shape: ${PI_SCHEMAS}/implementer-evidence.schema.json`,
    "6. **Long checks** — `bg_run` / `/bg` (typecheck, tests, servers).",
    "7. **Review** (quality:normal default — ADR-0003) — path-load:",
    `   - ${BIGPOWERS}/audit-code/SKILL.md`,
    `   - ${PI_ADAPTERS}/bp-review-to-json/SKILL.md`,
    `   - ${BIGPOWERS}/request-review/SKILL.md (guidance; full Santa only if quality:strict)`,
    `   - ${PI_AGENTS}/code-reviewer.md`,
    "   - ~/.pi/agent/policy/REVIEW-POLICY.md",
    `   - ${PONYTAIL_REVIEW}/SKILL.md`,
    "   Emit JSON { ok, feedback, blocking }. Optional DW `/code-review` or fusion_validate (advisory).",
    "8. **Milestone** — `verify-gate` then organizer; fresh command evidence in bd; path-load",
    `   - ${PI_AGENTS}/verify-gate.md (required; ${BIGPOWERS}/verify-work/SKILL.md + validate-fix)`,
    `   - ${PI_AGENTS}/milestone-organizer.md when closing a multi-task epic.`,
    "9. **PR** — only if user asked: path-load",
    `   - ${BIGPOWERS}/commit-message/SKILL.md`,
    `   - ${BIGPOWERS}/release-branch/SKILL.md`,
    `   - ${PI_AGENTS}/pr-opener.md` + " (`gh`).",
    "   Dual GitHub PR review on Pi: exact `/pr-reviewer` (local freeze, Grok+Sol+Terra).",
    "   Local/diff multi-angle (not GitHub dual): exact `/code-review` (dynamic-workflows).",
    "",
    "### Bug lane (when goal is a bug)",
    `Path-load ${BIGPOWERS}/investigate-bug/SKILL.md → ${BIGPOWERS}/diagnose-root/SKILL.md → ${BIGPOWERS}/fix-bug/SKILL.md or develop-tdd.`,
    "",
    "### Hard boundaries",
    "- Prefer bd over markdown TODOs. Never dual unlinked specs/ epic + bd epic.",
    "- Never use codebase-memory MCP.",
    "- Never load `~/.omp/agent/*` — assets live under `~/.pi/agent/*`.",
    "- Never path-load `~/.agents/skills/superpowers/**`.",
    "- Browser automation is opt-in CLI only — not required.",
    "- Stop when the bound goal is done; summarize remaining manual steps honestly (hard OMP SessionManager gates are not on Pi).",
    "",
    "Start now: confirm beads, load bp-bd-bridge + using-bigpowers + survey-context, produce Spec outline for the bound goal.",
  ].join("\n")
}

function buildDesignStart(goal: string): string {
  return [
    "kind: design-flow-start",
    "host: pi",
    "methodology: bigpowers + design-flow (no Superpowers)",
    "",
    "Bound design goal:",
    goal,
    "",
    "Path-load then run design-only flow:",
    `- ${BIGPOWERS}/using-bigpowers/SKILL.md`,
    `- ${PI_SKILLS}/design-flow/SKILL.md`,
    `- ${BIGPOWERS}/elaborate-spec/SKILL.md`,
    `- optional ${BIGPOWERS}/grill-me/SKILL.md`,
    `- ${PI_SKILLS}/architect/SKILL.md`,
    `- ${PONYTAIL}/SKILL.md`,
    `- ${PI_AGENTS}/pdr-writer.md` + " / pdr-reviewer / arc42-writer / arc42-reviewer / adr-writer",
    `- ~/.pi/agent/policy/REVIEW-POLICY.md`,
    `- schemas under ${PI_SCHEMAS}/`,
    "",
    ...packageContractsBlock(),
    "PDR → Arc42 → ADRs under docs/adr/ only (ADR-0004). REVIEW-POLICY default PASS.",
    "Do NOT start /harness, implement, or open feature PRs.",
    "Optional: dynamic-workflows for parallel design angles.",
    "Handoff may suggest `/harness <goal>` for the user to invoke.",
  ].join("\n")
}

function buildArchitectStart(question: string, layered: boolean): string {
  return [
    "kind: architect-consult",
    layered ? "variant: layered/clean-architecture doctrine allowed" : "variant: general",
    "",
    "Bound question:",
    question,
    "",
    "Path-load:",
    `- ${BIGPOWERS}/using-bigpowers/SKILL.md`,
    `- ${PI_SKILLS}/architect/SKILL.md`,
    `- ${BIGPOWERS}/elaborate-spec/SKILL.md`,
    `- optional ${BIGPOWERS}/deepen-architecture/SKILL.md / ${BIGPOWERS}/model-domain/SKILL.md`,
    layered
      ? "- User asked clean/onion/hex/layered — you MAY use those doctrines; still compare alternatives."
      : "- Do not push Clean Architecture unless the user asked.",
    "",
    "Run architect 8-step workflow in-session. Blueprint recommendation in session.",
    "ADRs only if decisive + user confirms (docs/adr/). No auto /design or /harness.",
  ].join("\n")
}

function buildInitStart(scope: string, cwd: string): string {
  return [
    "kind: project-init",
    "",
    `Scope: ${scope || "(default project root)"}`,
    `Repository root (authoritative): ${cwd}`,
    "",
    `Path-load and follow: ${PI_AGENTS}/project-init.md`,
    `Templates: ${PI_TEMPLATES}/project/`,
    `Optional later: ${BIGPOWERS}/seed-conventions/SKILL.md only if greenfield and will not clobber existing AGENTS files — bd-safe init first.`,
    "Scaffold AGENTS/CLAUDE; safe bd init only if .beads missing.",
    "No Spec/Plan/Implement/PR. No /harness. Stop when done.",
  ].join("\n")
}

async function fireUserMessage(
  pi: ExtensionAPI,
  ctx: { isIdle: () => boolean; ui: { notify: Notify } },
  text: string,
): Promise<void> {
  if (!ctx.isIdle()) {
    ctx.ui.notify("Agent busy — try again when idle.", "warning")
    return
  }
  await pi.sendUserMessage(text)
}

export default function (pi: ExtensionAPI) {
  const harnessCommand = {
    description:
      "Pi harness — empty args = default quality goal; else bind args. bd + Bigpowers + hashline + bg + DW",
    handler: async (args: string, ctx: Parameters<typeof fireUserMessage>[1] & {
      cwd: string
      modelRegistry: {
        find: (provider: string, modelId: string) => unknown
      }
    }) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent busy — try again when idle.", "warning")
        return
      }
      const trimmed = args.trim()
      const usedDefault = !trimmed
      const goal = trimmed || DEFAULT_HARNESS_GOAL
      if (usedDefault) {
        ctx.ui.notify("Empty /harness → default 8 quality requirements", "info")
      }

      let selectedRoute: (typeof RESEARCH_MODEL_ROUTE)[number] | undefined
      for (const candidate of RESEARCH_MODEL_ROUTE) {
        const model = ctx.modelRegistry.find(candidate.provider, candidate.modelId)
        if (model && await pi.setModel(model)) {
          selectedRoute = candidate
          break
        }
      }
      if (!selectedRoute) {
        ctx.ui.notify(
          "Harness stopped: no authenticated research model (Grok high → Sol medium).",
          "error",
        )
        return
      }

      pi.setThinkingLevel(selectedRoute.effort)
      ctx.ui.notify(
        `Harness research route: ${selectedRoute.provider}/${selectedRoute.modelId}:${selectedRoute.effort}`,
        selectedRoute.provider === "openai-codex" ? "warning" : "info",
      )
      await pi.sendUserMessage(buildHarnessStart(goal, usedDefault, ctx.cwd))
    },
  }
  pi.registerCommand("harness", harnessCommand)
  pi.registerCommand("goal-harness", {
    ...harnessCommand,
    description: "Alias of /harness",
  })

  pi.registerCommand("design", {
    description: "Design-only PDR/Arc42/ADR (no build)",
    handler: async (args, ctx) => {
      const goal = requireArgs(args, "Usage: /design <system goal>", ctx.ui.notify.bind(ctx.ui))
      if (!goal) return
      await fireUserMessage(pi, ctx, buildDesignStart(goal))
    },
  })

  pi.registerCommand("architect", {
    description: "In-session architecture consult",
    handler: async (args, ctx) => {
      const q = requireArgs(args, "Usage: /architect <question>", ctx.ui.notify.bind(ctx.ui))
      if (!q) return
      await fireUserMessage(pi, ctx, buildArchitectStart(q, false))
    },
  })

  pi.registerCommand("architect-layered", {
    description: "Architect consult with layered/clean/hex doctrine allowed",
    handler: async (args, ctx) => {
      const q = requireArgs(args, "Usage: /architect-layered <question>", ctx.ui.notify.bind(ctx.ui))
      if (!q) return
      await fireUserMessage(pi, ctx, buildArchitectStart(q, true))
    },
  })

  pi.registerCommand("init", {
    description: "Project scaffold only (AGENTS/bd)",
    handler: async (args, ctx) => {
      await fireUserMessage(pi, ctx, buildInitStart(args.trim(), ctx.cwd))
    },
  })

}
