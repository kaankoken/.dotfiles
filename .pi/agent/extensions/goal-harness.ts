/**
 * Pi goal-harness controller.
 *
 * Methodology: Bigpowers (npm:bigpowers) — Superpowers removed (ADR-0001).
 * Task SoT: bd primary; specs/ optional bridge (ADR-0002).
 *
 * Primary entry: /harness
 * Also: /design /architect /architect-layered /init
 * Exact /code-review is owned by dynamic-workflows (not registered here).
 * Exact /pr-reviewer is owned by extensions/pr-reviewer.ts (local freeze).
 *
 * Structured process:
 *   - hashline-edit-pro (read/replace)
 *   - pi-background-tasks (bg_run / bg_delegate)
 *   - dynamic-workflows (parallel agents)
 *   - bd (SoT)
 *   - local skills/agents under ~/.pi/agent
 *   - Bigpowers skills under package install path
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { loadChain, type ModelHop } from "../workflows/model-routes.ts"
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

const RESEARCH_MODEL_ROUTE: ModelHop[] = loadChain("harness-research")
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
    "**Parallel multi-step**: dynamic-workflows. `/harness` counts as `workflow` opt-in — call the tool; `background: false` for implementer + gates.",
    "- isolation optional: `agent(prompt, { agentType, isolation: 'worktree' })`. `isolation: false` opts out. Default keep worktree; tests may pass `keepWorktree: false` to delete.",
    "- Prefer registered `agentType` under `~/.pi/agent/agents/*.md`.",
    "- Agent `route:` names a chain in `~/.pi/agent/workflows/model-routes.json`. Pin = first hop. Failover = providerFailover + remaining hops (openai-codex→cursor, xai→xai-oauth→cursor). No native anthropic.",
    "- If `agentType` model is missing, retry the next hop. Never run that role on the parent model.",
    "- tiers: `~/.pi/workflows/model-tiers.json` (small=scout grok, medium=reviewer opus@1m max, big=writer sol)",
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
    "mode: structured-soft",
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
    "Do not invent a second goal. Do not claim Milestone PASS without evidence.",
    "The parent session is the research controller only. Delegate writer/reviewer/implementer work to routed agents; never execute those phases on the parent model.",
    "",
    "### After each bite (required — GREEN is not done)",
    "This `/harness` invocation IS user opt-in to the `workflow` tool. Call it. Do not wait for the keyword. Pass `background: false` for implementer + gates so this turn sees results.",
    "Implementer GREEN is a checkpoint, not completion. Immediately:",
    "1. Long checks (`bg_run` / tests).",
    "2. `verify-gate` (verify-work + validate-fix) with fresh command evidence; emit JSON {ok, feedback, blocking}.",
    "3. Review → JSON { ok, feedback, blocking } (code-reviewer; max 3; first ok:true ends).",
    "4. Record `verify:` evidence in bd; close the bite; claim the next bd task.",
    "5. Repeat until every bd bite is closed AND the bound goal (default: 8 quality lines) has evidence.",
    "Do not stop after GREEN. Do not skip verify-gate or review. Bound goal ≠ one task.",
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
    "   Emit JSON { ok, feedback, blocking }. Max 3 review rounds; first ok:true ends the gate. Do not run leftover rounds.",
    "8. **Milestone** — `verify-gate` then organizer; fresh command evidence in bd; path-load",
    `   - ${PI_AGENTS}/verify-gate.md (required; ${BIGPOWERS}/verify-work/SKILL.md + validate-fix)`,
    `   - ${PI_AGENTS}/milestone-organizer.md when closing a multi-task epic.`,
    "9. **PR** — only if user asked: path-load",
    `   - ${BIGPOWERS}/commit-message/SKILL.md`,
    `   - ${BIGPOWERS}/release-branch/SKILL.md`,
    `   - ${PI_AGENTS}/pr-opener.md` + " (`gh`).",
    "   GitHub PR review on Pi: exact `/pr-review` (local freeze, Grok+Sol+Opus+Terra).",
    "   Local/diff multi-angle (not GitHub dual): exact `/code-review` (dynamic-workflows).",
    "",
    "### Bug lane (when goal is a bug)",
    `Path-load ${BIGPOWERS}/investigate-bug/SKILL.md → ${BIGPOWERS}/diagnose-root/SKILL.md → ${BIGPOWERS}/fix-bug/SKILL.md or develop-tdd.`,
    "",
    "### Hard boundaries",
    "- Prefer bd over markdown TODOs. Never dual unlinked specs/ epic + bd epic.",
    "- Never use codebase-memory MCP.",
    "- Never load agent trees outside `~/.pi/agent/*`.",
    "- Never path-load `~/.agents/skills/superpowers/**`.",
    "- Browser automation is opt-in CLI only — not required.",
    "- Stop only when the bound goal has evidence (default: all 8 quality lines + all bd bites closed). Implementer GREEN is not that. Then summarize remaining manual steps honestly.",
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

type RunKind = "harness" | "design" | "architect" | "architect-layered"

type ActiveRun = {
  kind: RunKind
  goal: string
  phase: string
  attempts: number
  injects: number
}

const INITIAL_PHASE: Record<RunKind, string> = {
  harness: "research",
  design: "intake",
  architect: "consult",
  "architect-layered": "consult",
}

const NEXT_ROLE: Record<RunKind, string> = {
  harness: "research-orchestrator",
  design: "pdr-writer",
  architect: "research-orchestrator",
  "architect-layered": "research-orchestrator",
}

const HARNESS_RESTRICTED = ["implementer", "pr-opener", "milestone-organizer", "verify-gate"] as const

const PHASE_NEXT_ROLE: Record<string, string> = {
  research: "research-orchestrator",
  spec: "spec-reviewer",
  plan: "plan-reviewer",
  bitesize: "bite-size-reviewer",
  implement: "implementer",
  verify: "verify-gate",
  milestone: "milestone-organizer",
  pr: "pr-opener",
  intake: "pdr-writer",
  pdr: "pdr-reviewer",
  arc42: "arc42-reviewer",
  adr: "adr-writer",
  handoff: "pdr-writer",
  consult: "research-orchestrator",
}

const REVIEW_NEXT: Record<string, { role: string; next: string; max: number }> = {
  spec: { role: "spec-reviewer", next: "plan", max: 3 },
  plan: { role: "plan-reviewer", next: "bitesize", max: 3 },
  bitesize: { role: "bite-size-reviewer", next: "implement", max: 2 },
  pdr: { role: "pdr-reviewer", next: "arc42", max: 2 },
  arc42: { role: "arc42-reviewer", next: "adr", max: 2 },
}

let activeRun: ActiveRun | null = null

export function getActiveRun(): ActiveRun | null {
  return activeRun
}

function startRun(kind: RunKind, goal: string): void {
  activeRun = {
    kind,
    goal,
    phase: INITIAL_PHASE[kind],
    attempts: 0,
    injects: 0,
  }
}

function allowedNext(run: ActiveRun): string {
  return PHASE_NEXT_ROLE[run.phase] ?? NEXT_ROLE[run.kind]
}

function gatedRoles(run: ActiveRun): readonly string[] {
  if (run.kind === "design" || run.kind === "architect" || run.kind === "architect-layered") {
    return ["implementer", "pr-opener", "kickoff-branch"]
  }
  const allowed = PHASE_NEXT_ROLE[run.phase]
  return HARNESS_RESTRICTED.filter((role) => role !== allowed)
}

function firstGatedRole(
  input: Record<string, unknown>,
  blocked: readonly string[],
): string | undefined {
  if (typeof input.name === "string" && blocked.includes(input.name)) return input.name
  if (typeof input.script !== "string") return
  for (const m of input.script.matchAll(
    /\bagentType\s*:\s*(?:["']([A-Za-z0-9_-]+)["']|([A-Za-z0-9_-]+))/g,
  )) {
    if (m[2]) return m[2]
    if (m[1] && blocked.includes(m[1])) return m[1]
  }
}

function setPhase(run: ActiveRun, phase: string): void {
  run.phase = phase
  run.attempts = 0
  run.injects = 0
}

function extractJsonObjects(text: string): unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] !== "}") continue
      try {
        out.push(JSON.parse(text.slice(i, j + 1)))
        i = j
        break
      } catch { /* grow */ }
    }
  }
  return out
}

function asReview(obj: unknown): { ok: boolean; feedback: string; blocking: string[] } | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return
  const o = obj as Record<string, unknown>
  if (typeof o.ok !== "boolean" || typeof o.feedback !== "string" || !Array.isArray(o.blocking)) return
  if (o.blocking.some((item) => typeof item !== "string")) return
  return { ok: o.ok, feedback: o.feedback, blocking: o.blocking as string[] }
}

function isImplementerEvidence(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false
  const o = obj as Record<string, unknown>
  if (typeof o.issueId !== "string" || o.issueId.length === 0) return false
  const green = o.green
  if (!green || typeof green !== "object" || Array.isArray(green)) return false
  return (green as { exitCode?: unknown }).exitCode === 0
}

function isMadrLite(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false
  const adrs = (obj as { adrs?: unknown }).adrs
  if (!Array.isArray(adrs) || adrs.length === 0) return false
  return adrs.every((adr) => {
    if (!adr || typeof adr !== "object") return false
    const title = (adr as { title?: unknown }).title
    return typeof title === "string" && title.length > 0
  })
}

function findGoalComplete(objs: unknown[]): boolean | undefined {
  for (const obj of objs) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue
    if (!("goalComplete" in obj)) continue
    const value = (obj as { goalComplete: unknown }).goalComplete
    if (typeof value === "boolean") return value
  }
}

function evidenceRoles(input: Record<string, unknown>): string[] {
  const roles: string[] = []
  if (typeof input.name === "string" && input.name) roles.push(input.name)
  if (typeof input.script !== "string") return roles
  for (const m of input.script.matchAll(
    /\bagentType\s*:\s*(?:["']([A-Za-z0-9_-]+)["']|([A-Za-z0-9_-]+))/g,
  )) {
    const token = m[1] ?? m[2]
    if (token) roles.push(token)
  }
  return roles
}

function applyReviewGate(run: ActiveRun, roles: string[], objs: unknown[]): boolean {
  const gate = REVIEW_NEXT[run.phase]
  if (!gate || !roles.includes(gate.role)) return false
  const review = objs.map(asReview).find(Boolean)
  if (!review) return true
  if (review.ok && review.blocking.length === 0) {
    setPhase(run, gate.next)
    return true
  }
  if (!review.ok && review.blocking.length > 0 && run.attempts < gate.max) {
    run.attempts += 1
  }
  return true
}

function applyWorkflowResult(
  run: ActiveRun,
  roles: string[],
  text: string,
  isError: boolean,
): void {
  const objs = extractJsonObjects(text)
  if (run.kind === "harness") {
    if (run.phase === "research" && roles.includes("research-orchestrator") && !isError) {
      setPhase(run, "spec")
      return
    }
    if (applyReviewGate(run, roles, objs)) return
    if (run.phase === "implement" && roles.includes("implementer") && objs.some(isImplementerEvidence)) {
      setPhase(run, "verify")
      return
    }
    if (run.phase === "verify" && roles.includes("verify-gate") && !isError) {
      const reviews = objs.map(asReview).filter(Boolean)
      if (reviews.length > 0 && reviews.every((r) => r!.ok && r!.blocking.length === 0)) setPhase(run, "milestone")
      return
    }
    if (run.phase === "milestone" && roles.includes("milestone-organizer")) {
      const review = objs.map(asReview).find(Boolean)
      if (!review) return
      if (review.ok && review.blocking.length === 0) {
        setPhase(run, findGoalComplete(objs) === false ? "bitesize" : "pr")
        return
      }
      if (!review.ok && review.blocking.length > 0 && run.attempts < 3) run.attempts += 1
      return
    }
    if (run.phase === "pr" && roles.includes("pr-opener") && !isError && /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(text)) {
      activeRun = null
    }
    return
  }
  if (run.kind !== "design") return
  if (
    run.phase === "intake" &&
    !isError &&
    (roles.includes("pdr-writer") || roles.includes("research-orchestrator"))
  ) {
    setPhase(run, "pdr")
    return
  }
  if (applyReviewGate(run, roles, objs)) return
  if (run.phase === "adr" && roles.includes("adr-writer") && objs.some(isMadrLite)) {
    setPhase(run, "handoff")
  }
}

function isKindInjection(text: string): boolean {
  return /^\s*kind:\s+\S+/m.test(text)
}

function hasArchitectSteps(text: string): boolean {
  for (let i = 0; i <= 8; i++) {
    if (!text.includes(`step-${i}:`)) return false
  }
  return true
}

function architectComplete(text: string): boolean {
  return !isKindInjection(text) && hasArchitectSteps(text) && /architecture-handoff/i.test(text)
}

function hasDesignHandoffFields(text: string): boolean {
  return (
    !isKindInjection(text) &&
    /PDR\s*:\s+\S+/i.test(text) &&
    /Arc42\s*:\s+\S+/i.test(text) &&
    /ADR\s*:\s+\S+/i.test(text) &&
    /nextStep\s*:\s+\S+/i.test(text)
  )
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

export function needsAfterBiteGate(text: string): boolean {
  if (/skipped verify-gate|stopped after implementer/i.test(text)) return true
  if (!/implementer GREEN/i.test(text)) return false
  if (/GREEN is not done/i.test(text) && !/skipped verify-gate/i.test(text)) return false
  return !(/verify-gate/i.test(text) && /"ok"\s*:/.test(text))
}

export function buildAfterBiteContinue(goal: string): string {
  return [
    "kind: harness-after-bite-gate",
    "Implementer GREEN is not done. Bound goal still open:",
    goal,
    "",
    "Call the `workflow` tool now with `background: false`:",
    "1. Long checks (tests).",
    "2. verify-gate (verify-work + validate-fix) + fresh command evidence; emit JSON {ok, feedback, blocking}.",
    "3. Review JSON { ok, feedback, blocking }.",
    "4. bd verify: evidence; close bite; next bite.",
    "Do not stop. Do not skip verify-gate or review.",
  ].join("\n")
}

function buildDesignHandoffContinue(goal: string): string {
  return [
    "kind: design-handoff-gate",
    "Bound design goal:",
    goal,
    "",
    "Emit handoff with PDR, Arc42, ADR paths, and nextStep.",
    "Do not auto-start /harness.",
  ].join("\n")
}

function buildArchitectContinue(question: string): string {
  return [
    "kind: architect-follow-up",
    "Bound question:",
    question,
    "",
    "step-0: Repo-fit probe",
    "step-1: Problem, non-goals, constraints, success metrics",
    "step-2: Quality attributes",
    "step-3: Candidates + tradeoffs",
    "step-4: Boundaries",
    "step-5: Data strategy",
    "step-6: Ops / failure / observability",
    "step-7: Scope limits",
    "step-8: Decisive ADRs",
    "",
    "Fill architecture-handoff fields in session.",
    "Do not auto-start /design or /harness.",
  ].join("\n")
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === "string" ? text : ""
      }
      return ""
    })
    .join("\n")
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

      let selectedRoute: ModelHop | undefined
      for (const candidate of RESEARCH_MODEL_ROUTE) {
        const model = ctx.modelRegistry.find(candidate.provider, candidate.modelId)
        if (model && await pi.setModel(model)) {
          selectedRoute = candidate
          break
        }
      }
      if (!selectedRoute) {
        ctx.ui.notify(
          "Harness stopped: no authenticated research model (Grok 4.6 xhigh → Terra max).",
          "error",
        )
        return
      }

      pi.setThinkingLevel(selectedRoute.effort)
      ctx.ui.notify(
        `Harness research route: ${selectedRoute.provider}/${selectedRoute.modelId}:${selectedRoute.effort}`,
        selectedRoute.provider === "openai-codex" ? "warning" : "info",
      )
      startRun("harness", goal)
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
      startRun("design", goal)
      await fireUserMessage(pi, ctx, buildDesignStart(goal))
    },
  })

  pi.registerCommand("architect", {
    description: "In-session architecture consult",
    handler: async (args, ctx) => {
      const q = requireArgs(args, "Usage: /architect <question>", ctx.ui.notify.bind(ctx.ui))
      if (!q) return
      startRun("architect", q)
      await fireUserMessage(pi, ctx, buildArchitectStart(q, false))
    },
  })

  pi.registerCommand("architect-layered", {
    description: "Architect consult with layered/clean/hex doctrine allowed",
    handler: async (args, ctx) => {
      const q = requireArgs(args, "Usage: /architect-layered <question>", ctx.ui.notify.bind(ctx.ui))
      if (!q) return
      startRun("architect-layered", q)
      await fireUserMessage(pi, ctx, buildArchitectStart(q, true))
    },
  })

  pi.registerCommand("init", {
    description: "Project scaffold only (AGENTS/bd)",
    handler: async (args, ctx) => {
      await fireUserMessage(pi, ctx, buildInitStart(args.trim(), ctx.cwd))
    },
  })

  pi.on("session_shutdown", () => {
    activeRun = null
  })
  pi.on("turn_end", (event) => {
    const run = activeRun
    if (!run) return
    const message = (event as { message?: unknown }).message
    const text = assistantText(message)
    if (run.kind === "harness") {
      if (run.injects >= 3 || !needsAfterBiteGate(text)) return
      run.injects += 1
      pi.sendUserMessage(buildAfterBiteContinue(run.goal), { deliverAs: "followUp" })
      return
    }
    if (run.kind === "design" && run.phase === "handoff") {
      if (hasDesignHandoffFields(text) || run.injects >= 3) return
      run.injects += 1
      pi.sendUserMessage(buildDesignHandoffContinue(run.goal), { deliverAs: "followUp" })
      return
    }
    if (run.kind !== "architect" && run.kind !== "architect-layered") return
    if (run.phase === "handoff") {
      activeRun = null
      return
    }
    if (run.phase !== "consult") return
    if (architectComplete(text)) {
      setPhase(run, "handoff")
      return
    }
    if (run.injects >= 3) return
    run.injects += 1
    pi.sendUserMessage(buildArchitectContinue(run.goal), { deliverAs: "followUp" })
  })
  pi.on("tool_result", (event) => {
    const run = activeRun
    if (!run) return
    const e = event as {
      toolName?: string
      isError?: boolean
      input?: Record<string, unknown>
      content?: unknown
    }
    if (e.toolName !== "workflow") return
    applyWorkflowResult(run, evidenceRoles(e.input ?? {}), assistantText({ content: e.content }), e.isError === true)
  })
  pi.on("tool_call", (event) => {
    const run = activeRun
    if (!run) return
    if (event.toolName !== "workflow") return
    const input = event.input as Record<string, unknown>
    const role = firstGatedRole(input, gatedRoles(run))
    if (role) {
      return { block: true, reason: `Blocked ${role} during ${run.phase}; allowed next: ${allowedNext(run)}` }
    }
    if (run.kind !== "harness") return
    if (input.resumeFromRunId) return
    if (input.background === false) return
    input.background = false
  })
}
