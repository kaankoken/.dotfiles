import { describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import goalHarness, { needsAfterBiteGate, buildAfterBiteContinue, getActiveRun } from "../extensions/goal-harness.ts"
import prReviewer, { buildPrReviewWorkflowScript } from "../extensions/pr-reviewer.ts"

type RegisteredCommand = {
  name: string
  description?: string
  handler: (args: string, ctx: FakeCommandContext) => Promise<void> | void
}

type FakeModel = { provider: string; id: string }

type FakePiOptions = {
  models?: FakeModel[]
}

type FakeCommandContext = {
  cwd: string
  isIdle: () => boolean
  modelRegistry: {
    find: (provider: string, modelId: string) => FakeModel | undefined
  }
  ui: {
    notify: (message: string, kind?: "info" | "warning" | "error") => void
    setStatus?: (key: string, text: string | undefined) => void
  }
}

function createFakePi(options: FakePiOptions = {}) {
  const commands = new Map<string, RegisteredCommand>()
  const userMessages: string[] = []
  const userMessageOptions: unknown[] = []
  const notifications: Array<{ message: string; kind?: string }> = []
  const availableModels = options.models ?? [
    { provider: "xai", id: "grok-4.6" },
    { provider: "openai-codex", id: "gpt-5.6-sol" },
  ]
  const selectedModels: FakeModel[] = []
  const thinkingLevels: string[] = []
  const listeners: Array<{ event: string; handler: (event: unknown) => unknown }> = []

  const pi = {
    registerCommand(
      name: string,
      options: { description?: string; handler: RegisteredCommand["handler"] },
    ) {
      if (commands.has(name)) {
        throw new Error(`duplicate registerCommand: ${name}`)
      }
      commands.set(name, {
        name,
        description: options.description,
        handler: options.handler,
      })
    },
    sendUserMessage(content: string | unknown, options?: unknown) {
      userMessages.push(typeof content === "string" ? content : JSON.stringify(content))
      userMessageOptions.push(options)
    },
    async setModel(model: FakeModel) {
      selectedModels.push(model)
      return true
    },
    setThinkingLevel(level: string) {
      thinkingLevels.push(level)
    },
    on(_event: string, handler: (event: unknown) => unknown) {
      listeners.push({ event: _event, handler })
    },
  } as unknown as ExtensionAPI

  const ctx: FakeCommandContext = {
    cwd: process.cwd(),
    isIdle: () => true,
    modelRegistry: {
      find(provider, modelId) {
        return availableModels.find(
          (model) => model.provider === provider && model.id === modelId,
        )
      },
    },
    ui: {
      notify(message, kind) {
        notifications.push({ message, kind })
      },
      setStatus() {},
    },
  }

  return {
    pi,
    commands,
    userMessages,
    userMessageOptions,
    notifications,
    selectedModels,
    thinkingLevels,
    listeners,
    ctx,
  }
}

const GOAL_COMMANDS = [
  "harness",
  "goal-harness",
  "design",
  "architect",
  "architect-layered",
  "init",
] as const

describe("local extension slash command registration", () => {
  test("goal-harness owns exact flow commands and nothing else", () => {
    const { pi, commands } = createFakePi()
    goalHarness(pi)

    expect([...commands.keys()].sort()).toEqual([...GOAL_COMMANDS].sort())
    expect(commands.has("code-review")).toBe(false)
    expect(commands.has("pr-reviewer")).toBe(false)
    for (const name of GOAL_COMMANDS) {
      expect(commands.get(name)?.handler).toBeTypeOf("function")
      expect(commands.get(name)?.description?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test("pr-reviewer extension is the sole owner of /pr-review and /pr-reviewer", () => {
    const goal = createFakePi()
    const pr = createFakePi()
    goalHarness(goal.pi)
    prReviewer(pr.pi)

    expect(goal.commands.has("pr-review")).toBe(false)
    expect(goal.commands.has("pr-reviewer")).toBe(false)
    expect(pr.commands.has("pr-review")).toBe(true)
    expect(pr.commands.has("pr-reviewer")).toBe(true)
    expect(pr.commands.get("pr-review")?.description ?? "").toMatch(/Grok\+Sol\+Opus\+Terra/)
    expect(pr.commands.get("pr-reviewer")?.handler).toBe(pr.commands.get("pr-review")?.handler)
  })

  test("opus reviewer is wired into freeze schemas and agent file", async () => {
    const { pi, commands } = createFakePi()
    prReviewer(pi)
    expect(commands.get("pr-review")?.description ?? "").toMatch(/Opus/)
    const initial = (await Bun.file(
      new URL("../schemas/pr-review-initial.schema.json", import.meta.url),
    ).json()) as { properties: { reviewer: { enum: string[] } } }
    expect(initial.properties.reviewer.enum).toEqual(["grok", "sol", "opus"])
    const rebuttal = (await Bun.file(
      new URL("../schemas/pr-review-rebuttal.schema.json", import.meta.url),
    ).json()) as { properties: { responses: { maxItems: number } } }
    const judge = (await Bun.file(
      new URL("../schemas/pr-review-judge.schema.json", import.meta.url),
    ).json()) as { properties: { adjudications: { maxItems: number } } }
    expect(rebuttal.properties.responses.maxItems).toBe(200)
    expect(judge.properties.adjudications.maxItems).toBe(300)
    expect(JSON.stringify(rebuttal)).toContain("grok|sol|opus")
    expect(JSON.stringify(judge)).toContain("grok|sol|opus")
    const md = await Bun.file(new URL("../agents/pr-opus-reviewer.md", import.meta.url)).text()
    expect(md).toMatch(/^name: pr-opus-reviewer$/m)
    expect(md).toContain("cursor/claude-opus-5@1m")
    expect(md).toContain("freeze paths + worktree")
    const ext = await Bun.file(new URL("../extensions/pr-reviewer.ts", import.meta.url)).text()
    expect(ext).toContain("pr-opus-reviewer")
    expect(ext).toContain("opus-initial.json")
    expect(ext).toContain("loadChain(\"judge\")")
    expect(ext).toContain("buildPrReviewWorkflowScript")
  })

  test("combined local extensions never register duplicate slash names", () => {
    const { pi, commands } = createFakePi()
    goalHarness(pi)
    prReviewer(pi)
    expect([...commands.keys()].sort()).toEqual(
      [...GOAL_COMMANDS, "pr-review", "pr-reviewer"].sort(),
    )
  })
})

describe("goal-harness handler start messages", () => {
  test("/harness empty args emits default quality start with Bigpowers contract", async () => {
    const {
      pi,
      commands,
      userMessages,
      notifications,
      selectedModels,
      thinkingLevels,
      ctx,
    } = createFakePi()
    ctx.cwd = "/tmp/interview"
    goalHarness(pi)
    await commands.get("harness")!.handler("", ctx)

    expect(notifications.some((n) => /default 8 quality/i.test(n.message))).toBe(true)
    expect(selectedModels).toEqual([{ provider: "xai", id: "grok-4.6" }])
    expect(thinkingLevels).toEqual(["xhigh"])
    expect(
      notifications.some((notification) =>
        notification.message.includes("Harness research route: xai/grok-4.6:xhigh"),
      ),
    ).toBe(true)
    expect(userMessages).toHaveLength(1)
    const msg = userMessages[0]!
    expect(msg).toContain("kind: goal-harness-start")
    expect(msg).toContain("host: pi")
    expect(msg).toContain("repository root (authoritative): /tmp/interview")
    expect(msg).toContain("methodology: bigpowers")
    expect(msg).toContain("Bound goal: DEFAULT quality requirements")
    expect(msg).toContain("bigpowers")
    expect(msg).toContain("Never path-load `~/.agents/skills/superpowers/**`")
    expect(msg).toContain("Never load agent trees outside `~/.pi/agent/*`")
    expect(msg).toContain("The parent session is the research controller only")
    expect(msg).toContain("research-orchestrator.md")
    expect(msg).toContain("ctx_batch_execute")
    expect(msg).toContain("tokensave")
    expect(msg).toContain("graphify")
    expect(msg).toContain("caveman")
    expect(msg).toContain("context-mode")
    expect(msg).toContain("Max 3 review rounds")
    expect(msg).toContain("GREEN is not done")
    expect(msg).toContain("emit JSON {ok, feedback, blocking}")
    expect(msg).toContain("IS user opt-in to the `workflow` tool")
    expect(msg).toContain("background: false")
    expect(msg).toContain("Do not stop after GREEN")
    expect(msg).toContain("Stop only when the bound goal has evidence")
    expect(msg).not.toMatch(/using-superpowers|requiredSuperpowers/)
    const defaultGoal = msg
      .match(
        /Bound goal: DEFAULT quality requirements \(empty \/harness args\):\n([\s\S]*?)\n\n## Controller instructions/,
      )?.[1]
      .split("\n")
    expect(defaultGoal).toEqual([
      "1. No errors, no warnings, no test failures.",
      "2. No warning suppressions in production (test-only OK with reason).",
      "3. Everything wired — no stubs, TODO/TBD/FIXME, unfinished work.",
      "4. Mandated skills: using-bigpowers + stack packs + ponytail + caveman + tokensave + graphify + context-mode (path-load).",
      "5. Latest dependencies — verify on the web (not training data alone).",
      "6. Complete all bd-tracked spec/plan tasks (Bigpowers discipline; every bite has verify:).",
      "7. Specs, plans, goals, updates tracked in bd (SoT). Optional specs/ cockpit via bp-bd-bridge only.",
      "8. Do not add unnecessary docstrings or comments; explanatory comments only where needed.",
    ])
  })

  test("/harness with args binds verbatim goal", async () => {
    const { pi, commands, userMessages, ctx } = createFakePi()
    goalHarness(pi)
    await commands.get("harness")!.handler("ship pi cutover tests", ctx)
    expect(userMessages[0]).toContain("Bound goal (verbatim — only goal):")
    expect(userMessages[0]).toContain("ship pi cutover tests")
  })

  test("/harness falls back to Terra max when Grok is unavailable", async () => {
    const {
      pi,
      commands,
      userMessages,
      notifications,
      selectedModels,
      thinkingLevels,
      ctx,
    } = createFakePi({
      models: [{ provider: "openai-codex", id: "gpt-5.6-terra" }],
    })
    goalHarness(pi)

    await commands.get("harness")!.handler("research fallback", ctx)

    expect(selectedModels).toEqual([
      { provider: "openai-codex", id: "gpt-5.6-terra" },
    ])
    expect(thinkingLevels).toEqual(["max"])
    expect(notifications).toContainEqual({
      message: "Harness research route: openai-codex/gpt-5.6-terra:max",
      kind: "warning",
    })
    expect(userMessages).toHaveLength(1)
  })

  test("/harness falls back to Cursor Terra @1m when native Codex is unavailable", async () => {
    const {
      pi,
      commands,
      userMessages,
      notifications,
      selectedModels,
      thinkingLevels,
      ctx,
    } = createFakePi({
      models: [{ provider: "cursor", id: "gpt-5.6-terra@1m" }],
    })
    goalHarness(pi)

    await commands.get("harness")!.handler("cursor fallback", ctx)

    expect(selectedModels).toEqual([{ provider: "cursor", id: "gpt-5.6-terra@1m" }])
    expect(thinkingLevels).toEqual(["max"])
    expect(notifications).toContainEqual({
      message: "Harness research route: cursor/gpt-5.6-terra@1m:max",
      kind: "info",
    })
    expect(userMessages).toHaveLength(1)
  })

  test("/harness stops when no authenticated research route exists", async () => {
    const { pi, commands, userMessages, notifications, ctx } = createFakePi({
      models: [],
    })
    goalHarness(pi)

    await commands.get("harness")!.handler("unroutable", ctx)

    expect(userMessages).toHaveLength(0)
    expect(notifications).toContainEqual({
      message: "Harness stopped: no authenticated research model (Grok 4.6 xhigh → Terra max).",
      kind: "error",
    })
  })

  test("/design requires args and emits design-flow-start", async () => {
    const missing = createFakePi()
    goalHarness(missing.pi)
    await missing.commands.get("design")!.handler("  ", missing.ctx)
    expect(missing.userMessages).toEqual([])
    expect(missing.notifications.some((n) => /Usage: \/design/.test(n.message))).toBe(true)

    const ok = createFakePi()
    goalHarness(ok.pi)
    await ok.commands.get("design")!.handler("auth gateway", ok.ctx)
    expect(ok.userMessages).toHaveLength(1)
    expect(ok.userMessages[0]).toContain("kind: design-flow-start")
    expect(ok.userMessages[0]).toContain("Bound design goal:")
    expect(ok.userMessages[0]).toContain("auth gateway")
    expect(ok.userMessages[0]).toContain("no Superpowers")
  })

  test("/architect and /architect-layered emit consult variants", async () => {
    const plain = createFakePi()
    goalHarness(plain.pi)
    await plain.commands.get("architect")!.handler("boundary for tokensave?", plain.ctx)
    expect(plain.userMessages[0]).toContain("kind: architect-consult")
    expect(plain.userMessages[0]).toContain("variant: general")
    expect(plain.userMessages[0]).toContain("boundary for tokensave?")

    const layered = createFakePi()
    goalHarness(layered.pi)
    await layered.commands.get("architect-layered")!.handler("hex vs modular?", layered.ctx)
    expect(layered.userMessages[0]).toContain("kind: architect-consult")
    expect(layered.userMessages[0]).toContain("variant: layered/clean-architecture doctrine allowed")
    expect(layered.userMessages[0]).toContain("hex vs modular?")
  })

  test("/init emits project-init scaffold start", async () => {
    const { pi, commands, userMessages, ctx } = createFakePi()
    ctx.cwd = "/tmp/interview"
    goalHarness(pi)
    await commands.get("init")!.handler("apps/api", ctx)
    expect(userMessages[0]).toContain("kind: project-init")
    expect(userMessages[0]).toContain("Scope: apps/api")
    expect(userMessages[0]).toContain("project-init.md")
    expect(userMessages[0]).toContain("No Spec/Plan/Implement/PR")
    expect(userMessages[0]).toContain("Repository root (authoritative): /tmp/interview")
  })

  test("busy session does not send start messages", async () => {
    const { pi, commands, userMessages, notifications, ctx } = createFakePi()
    goalHarness(pi)
    ctx.isIdle = () => false
    await commands.get("harness")!.handler("should not fire", ctx)
    expect(userMessages).toEqual([])
    expect(notifications.some((n) => /busy/i.test(n.message))).toBe(true)
  })
})

describe("pr-reviewer command surface", () => {
  test("invalid args notify without sending controller message", async () => {
    const { pi, commands, userMessages, notifications, ctx } = createFakePi()
    prReviewer(pi)
    await commands.get("pr-reviewer")!.handler("", ctx)
    expect(userMessages).toEqual([])
    expect(notifications.some((n) => n.kind === "error" && /target required|Usage:/.test(n.message))).toBe(
      true,
    )
  })

  test("freeze workflow failovers opus/judge to cursor opus @1m", () => {
    const script = buildPrReviewWorkflowScript({
      bundlePath: "/tmp/BUNDLE.md",
      diffPath: "/tmp/diff.patch",
      worktreePath: "/tmp/wt",
      runNonce: "r".repeat(32),
      freezeNonce: "f".repeat(32),
      headSha: "a".repeat(40),
      diffDigest: "b".repeat(64),
      call: {
        grok: "1".repeat(32),
        sol: "2".repeat(32),
        opus: "3".repeat(32),
        grokR: "4".repeat(32),
        solR: "5".repeat(32),
        opusR: "6".repeat(32),
        judge: "7".repeat(32),
      },
    })
    expect(script).toContain("pr-grok-reviewer")
    expect(script).toContain("pr-sol-reviewer")
    expect(script).toContain("pr-opus-reviewer")
    expect(script).toContain("pr-terra-judge")
    expect(script).toContain("cursor/claude-opus-5@1m")
    expect(script).toContain("OPUS_MODELS")
    expect(script).not.toContain("Math.random")
    expect(script).not.toContain("Date.now")
  })
})


describe("harness after-bite hard gate", () => {
  test("needsAfterBiteGate catches skipped verify-gate", () => {
    expect(needsAfterBiteGate("Stopped after implementer GREEN — skipped verify-gate, review")).toBe(true)
    expect(needsAfterBiteGate("Implementer GREEN. verify-gate ran. {\"ok\": true}")).toBe(false)
    expect(needsAfterBiteGate("researching the API")).toBe(false)
    expect(needsAfterBiteGate(buildAfterBiteContinue("x"))).toBe(false)
    expect(buildAfterBiteContinue("x")).toContain("emit JSON {ok, feedback, blocking}")
  })

  test("verify-gate.md output is review JSON", async () => {
    const md = await Bun.file(new URL("../agents/verify-gate.md", import.meta.url)).text()
    expect(md).toContain("Emit JSON {ok, feedback, blocking}")
  })

  test("/harness turn_end follow-up when GREEN skipped gates", async () => {
    const { pi, commands, ctx, listeners, userMessages, userMessageOptions } = createFakePi()
    goalHarness(pi)
    await commands.get("harness")!.handler("", ctx)
    const turnEnd = listeners.find((l) => l.event === "turn_end")
    expect(turnEnd).toBeTruthy()
    turnEnd!.handler({
      message: { content: "Stopped after implementer GREEN — skipped verify-gate" },
    })
    expect(userMessages.some((m) => m.includes("kind: harness-after-bite-gate"))).toBe(true)
    expect(userMessageOptions.at(-1)).toEqual({ deliverAs: "followUp" })
  })


  test("/harness pins workflow background:false", async () => {
    const { pi, commands, ctx, listeners } = createFakePi()
    goalHarness(pi)
    await commands.get("harness")!.handler("", ctx)
    const toolCall = listeners.find((l) => l.event === "tool_call")
    expect(toolCall).toBeTruthy()
    const event = { toolName: "workflow", input: { script: "export const meta = { name: 'x', description: 'x' }", background: true } }
    toolCall!.handler(event)
    expect(event.input.background).toBe(false)
  })

  test("workflow pin skips resumeFromRunId and idle sessions", async () => {
    const { pi, commands, ctx, listeners } = createFakePi()
    goalHarness(pi)
    listeners.find((l) => l.event === "session_shutdown")!.handler({})
    const toolCall = listeners.find((l) => l.event === "tool_call")!
    const idle = { toolName: "workflow", input: { background: true } }
    toolCall.handler(idle)
    expect(idle.input.background).toBe(true)
    await commands.get("harness")!.handler("", ctx)
    const resume = { toolName: "workflow", input: { resumeFromRunId: "abc", background: true } }
    toolCall.handler(resume)
    expect(resume.input.background).toBe(true)
    const already = { toolName: "workflow", input: { background: false } }
    toolCall.handler(already)
    expect(already.input.background).toBe(false)
    const bash = { toolName: "bash", input: { command: "true", background: true } }
    toolCall.handler(bash)
    expect(bash.input.background).toBe(true)
  })
})

describe("exclusive activeRun and workflow role gates", () => {
  function setup() {
    const fake = createFakePi()
    goalHarness(fake.pi)
    fake.listeners.find((l) => l.event === "session_shutdown")!.handler({})
    return fake
  }

  function workflow(
    fake: ReturnType<typeof setup>,
    input: Record<string, unknown>,
  ) {
    return fake.listeners.find((l) => l.event === "tool_call")!.handler({
      toolName: "workflow",
      input,
    }) as { block?: boolean; reason?: string } | undefined
  }

  test("/harness starts phase research", async () => {
    const { commands, ctx } = setup()
    await commands.get("harness")!.handler("bound", ctx)
    expect(getActiveRun()).toMatchObject({
      kind: "harness",
      goal: "bound",
      phase: "research",
      attempts: 0,
      injects: 0,
    })
  })

  test("four commands replace active kind", async () => {
    const { commands, ctx } = setup()
    await commands.get("harness")!.handler("h", ctx)
    expect(getActiveRun()?.kind).toBe("harness")
    await commands.get("design")!.handler("d", ctx)
    expect(getActiveRun()).toMatchObject({ kind: "design", phase: "intake", goal: "d" })
    await commands.get("architect")!.handler("a", ctx)
    expect(getActiveRun()).toMatchObject({ kind: "architect", phase: "consult", goal: "a" })
    await commands.get("architect-layered")!.handler("al", ctx)
    expect(getActiveRun()).toMatchObject({
      kind: "architect-layered",
      phase: "consult",
      goal: "al",
    })
    await commands.get("harness")!.handler("h2", ctx)
    expect(getActiveRun()).toMatchObject({ kind: "harness", phase: "research", goal: "h2" })
  })

  test("fireUserMessage does not clear the run", async () => {
    const { commands, ctx } = setup()
    await commands.get("harness")!.handler("stay", ctx)
    const run = getActiveRun()
    expect(run).not.toBeNull()
    await commands.get("init")!.handler("apps/api", ctx)
    expect(getActiveRun()).toBe(run)
  })

  test("/init neither joins nor clears the machine", async () => {
    const { commands, ctx, userMessages } = setup()
    expect(getActiveRun()).toBeNull()
    await commands.get("init")!.handler("apps/api", ctx)
    expect(getActiveRun()).toBeNull()
    expect(userMessages.some((m) => m.includes("kind: project-init"))).toBe(true)
    await commands.get("harness")!.handler("stay", ctx)
    const run = getActiveRun()
    await commands.get("init")!.handler("", ctx)
    expect(getActiveRun()).toBe(run)
    expect(getActiveRun()?.kind).toBe("harness")
  })

  test("session_shutdown clears", async () => {
    const fake = setup()
    await fake.commands.get("harness")!.handler("x", fake.ctx)
    expect(getActiveRun()).not.toBeNull()
    fake.listeners.find((l) => l.event === "session_shutdown")!.handler({})
    expect(getActiveRun()).toBeNull()
  })

  test("extract exact agentType from script and name (no free substring)", async () => {
    const fake = setup()
    await fake.commands.get("harness")!.handler("g", fake.ctx)

    expect(workflow(fake, { script: `agent("do it", { agentType: "implementer" })` })?.block).toBe(true)
    expect(workflow(fake, { script: `agent("do it", { agentType: 'pr-opener' })` })?.block).toBe(true)
    expect(workflow(fake, { script: `agent("do it", { agentType: milestone-organizer })` })?.block).toBe(true)
    expect(workflow(fake, { script: `agent("do it", { agentType: "spec-writer" })` })?.block).toBe(true)
    expect(workflow(fake, { name: "implementer" })?.block).toBe(true)
    expect(workflow(fake, { name: "spec-writer" })?.block).toBe(true)

    expect(workflow(fake, { script: `agentType: "not-implementer"` })?.block).toBeFalsy()
    expect(workflow(fake, { script: `agentType: "implementer-helper"` })?.block).toBeFalsy()
    expect(workflow(fake, { script: `const note = "implementer"` })?.block).toBeFalsy()
    expect(workflow(fake, { name: "implementer-helper" })?.block).toBeFalsy()
    expect(workflow(fake, { name: "pre-implementer" })?.block).toBeFalsy()
    expect(workflow(fake, { name: "deep-research" })?.block).toBeFalsy()
  })

  test("unquoted agentType identifier is fail-closed", async () => {
    const fake = setup()
    await fake.commands.get("harness")!.handler("g", fake.ctx)
    const result = workflow(fake, {
      script: `const role = "milestone-organizer"; await agent("review", { agentType: role })`,
    })
    expect(result?.block).toBe(true)
    expect(workflow(fake, {
      script: `await agent("review", { agentType: "research-orchestrator" })`,
    })?.block).toBeFalsy()
    expect(workflow(fake, {
      script: `await agent("review", { agentType: research-orchestrator })`,
    })?.block).toBeFalsy()
  })

  test("harness-only background:false pin; skip resumeFromRunId", async () => {
    const fake = setup()
    await fake.commands.get("design")!.handler("d", fake.ctx)
    const designEvent = { toolName: "workflow", input: { background: true } }
    fake.listeners.find((l) => l.event === "tool_call")!.handler(designEvent)
    expect(designEvent.input.background).toBe(true)

    await fake.commands.get("harness")!.handler("h", fake.ctx)
    const pinEvent = { toolName: "workflow", input: { background: true } }
    fake.listeners.find((l) => l.event === "tool_call")!.handler(pinEvent)
    expect(pinEvent.input.background).toBe(false)

    const resume = {
      toolName: "workflow",
      input: { resumeFromRunId: "abc", background: true },
    }
    fake.listeners.find((l) => l.event === "tool_call")!.handler(resume)
    expect(resume.input.background).toBe(true)
  })

  test("design and architect block implementer, pr-opener, kickoff-branch", async () => {
    const fake = setup()
    const cases = [
      ["design", "d", "intake"],
      ["architect", "a", "consult"],
      ["architect-layered", "al", "consult"],
    ] as const
    const roles = ["implementer", "pr-opener", "kickoff-branch"] as const
    for (const [cmd, args, phase] of cases) {
      await fake.commands.get(cmd)!.handler(args, fake.ctx)
      for (const role of roles) {
        const result = workflow(fake, {
          script: `agent("x", { agentType: "${role}" })`,
        })
        expect(result?.block).toBe(true)
        expect(result?.reason).toContain(phase)
        expect(result?.reason).toMatch(/pdr-writer|research-orchestrator/)
      }
    }
  })

  test("harness research blocks implementer, pr-opener, milestone-organizer", async () => {
    const fake = setup()
    await fake.commands.get("harness")!.handler("g", fake.ctx)
    for (const role of ["implementer", "pr-opener", "milestone-organizer"] as const) {
      const viaScript = workflow(fake, {
        script: `agent("x", { agentType: "${role}" })`,
      })
      expect(viaScript?.block).toBe(true)
      expect(viaScript?.reason).toContain("research")
      expect(viaScript?.reason).toContain("research-orchestrator")

      const viaName = workflow(fake, { name: role })
      expect(viaName?.block).toBe(true)
      expect(viaName?.reason).toContain("research")
      expect(viaName?.reason).toContain("research-orchestrator")
    }
  })
})

describe("phase evidence, attempts, and bounded follow-ups", () => {
  const OK = JSON.stringify({ ok: true, feedback: "pass", blocking: [] })
  const FAIL = JSON.stringify({ ok: false, feedback: "nope", blocking: ["fix it"] })
  const MADR = JSON.stringify({
    adrs: [{
      title: "Use X",
      status: "accepted",
      context: "c",
      decision: "d",
      consequences: "q",
    }],
  })
  const GREEN_SKIP = "Stopped after implementer GREEN — skipped verify-gate"
  const ARCHITECT_DONE = [
    "step-0: repo",
    "step-1: problem",
    "step-2: qa",
    "step-3: candidates",
    "step-4: boundaries",
    "step-5: data",
    "step-6: ops",
    "step-7: limits",
    "step-8: adrs",
    "architecture-handoff",
    "Goal: ship it",
  ].join("\n")
  const DESIGN_HANDOFF = [
    "PDR: session/pdr.json",
    "Arc42: session/arc42.md",
    "ADR: docs/adr/0001-x.md",
    "nextStep: user may run /harness",
  ].join("\n")

  function setup() {
    const fake = createFakePi()
    goalHarness(fake.pi)
    fake.listeners.find((l) => l.event === "session_shutdown")!.handler({})
    return fake
  }

  function workflow(
    fake: ReturnType<typeof setup>,
    input: Record<string, unknown>,
  ) {
    return fake.listeners.find((l) => l.event === "tool_call")!.handler({
      toolName: "workflow",
      input,
    }) as { block?: boolean; reason?: string } | undefined
  }

  function fire(
    fake: ReturnType<typeof setup>,
    role: string,
    text: string,
    extra?: { isError?: boolean; via?: "name" | "script"; toolName?: string },
  ) {
    const via = extra?.via ?? "name"
    const input = via === "name"
      ? { name: role }
      : { script: `agent("x", { agentType: "${role}" })` }
    const handler = fake.listeners.find((l) => l.event === "tool_result")
    expect(handler).toBeTruthy()
    handler!.handler({
      toolName: extra?.toolName ?? "workflow",
      isError: extra?.isError ?? false,
      input,
      content: [{ type: "text", text }],
    })
  }

  function turn(fake: ReturnType<typeof setup>, text: string) {
    fake.listeners.find((l) => l.event === "turn_end")!.handler({
      message: { content: text },
    })
  }

  function evidence(issueId: string, exitCode: number) {
    return JSON.stringify({ issueId, green: { exitCode } })
  }

  const harnessPath: Array<{ from: string; role: string; text: string }> = [
    { from: "research", role: "research-orchestrator", text: '{"researchComplete":true}' },
    { from: "spec", role: "spec-reviewer", text: `noise\n${OK}\nkind: harness-after-bite-gate` },
    { from: "plan", role: "plan-reviewer", text: OK },
    { from: "bitesize", role: "bite-size-reviewer", text: OK },
    { from: "implement", role: "implementer", text: `prose GREEN\n${evidence("dotfiles-x", 0)}` },
    { from: "verify", role: "verify-gate", text: OK },
    {
      from: "milestone",
      role: "milestone-organizer",
      text: `${OK}\n${JSON.stringify({ goalComplete: true })}`,
    },
  ]

  async function startHarness(fake: ReturnType<typeof setup>, goal = "g") {
    await fake.commands.get("harness")!.handler(goal, fake.ctx)
  }

  function advanceHarnessTo(fake: ReturnType<typeof setup>, target: string) {
    for (const step of harnessPath) {
      if (getActiveRun()?.phase === target) return
      if (getActiveRun()?.phase !== step.from) continue
      fire(fake, step.role, step.text, { via: step.from === "spec" ? "script" : "name" })
    }
    expect(getActiveRun()?.phase).toBe(target)
  }

  function noAutoCommands(fake: ReturnType<typeof setup>) {
    expect(fake.userMessages.filter((m) => /^\/(harness|design)\b/.test(m.trim()))).toEqual([])
  }

  test("harness walks research→pr from mixed tool_result JSON; kind: headers are not evidence", async () => {
    const fake = setup()
    await startHarness(fake)
    expect(getActiveRun()?.phase).toBe("research")
    turn(fake, "kind: goal-harness-start\nkind: harness-after-bite-gate")
    expect(getActiveRun()?.phase).toBe("research")
    fire(fake, "spec-reviewer", OK)
    expect(getActiveRun()?.phase).toBe("research")
    fire(fake, "research-orchestrator", "kind: goal-harness-start", { toolName: "bash" })
    expect(getActiveRun()?.phase).toBe("research")
    fire(fake, "research-orchestrator", "research done", { isError: true })
    expect(getActiveRun()?.phase).toBe("research")
    fire(fake, "research-orchestrator", "kind: ignored\nresearch done", { via: "name" })
    expect(getActiveRun()?.phase).toBe("research")

    fire(fake, "research-orchestrator", '{"researchComplete":true}', { via: "name" })
    expect(getActiveRun()).toMatchObject({ phase: "spec", attempts: 0, injects: 0 })
    fire(fake, "spec-reviewer", `preamble\n${OK}\ntrailer`, { via: "script" })
    expect(getActiveRun()?.phase).toBe("plan")
    fire(fake, "plan-reviewer", OK, { via: "name" })
    expect(getActiveRun()?.phase).toBe("bitesize")
    fire(fake, "bite-size-reviewer", OK, { via: "script" })
    expect(getActiveRun()?.phase).toBe("implement")
    fire(fake, "implementer", evidence("dotfiles-x", 0))
    expect(getActiveRun()?.phase).toBe("verify")
    fire(fake, "verify-gate", OK)
    expect(getActiveRun()?.phase).toBe("milestone")
    fire(
      fake,
      "milestone-organizer",
      `${OK}\n${JSON.stringify({ goalComplete: true })}`,
    )
    expect(getActiveRun()?.phase).toBe("pr")
    fire(fake, "pr-opener", "Opened https://github.com/acme/dotfiles/pull/42")
    expect(getActiveRun()).toBeNull()
  })

  test("gatedRoles match phase after each predecessor gate", async () => {
    const fake = setup()
    await startHarness(fake)
    const table: Array<{ phase: string; allow: string[]; block: string[] }> = [
      {
        phase: "research",
        allow: ["research-orchestrator"],
        block: ["implementer", "pr-opener", "milestone-organizer", "verify-gate", "spec-writer", "plan-writer"],
      },
      {
        phase: "spec",
        allow: ["spec-writer", "spec-reviewer"],
        block: ["implementer", "pr-opener", "milestone-organizer", "verify-gate", "plan-writer"],
      },
      {
        phase: "plan",
        allow: ["plan-writer", "plan-reviewer"],
        block: ["implementer", "pr-opener", "milestone-organizer", "verify-gate", "spec-writer", "bite-size-writer"],
      },
      {
        phase: "bitesize",
        allow: ["bite-size-writer", "bite-size-reviewer"],
        block: ["implementer", "pr-opener", "milestone-organizer", "verify-gate", "plan-writer"],
      },
      {
        phase: "implement",
        allow: ["implementer", "kickoff-branch"],
        block: ["pr-opener", "milestone-organizer", "verify-gate", "spec-writer"],
      },
      {
        phase: "verify",
        allow: ["verify-gate"],
        block: ["implementer", "pr-opener", "milestone-organizer"],
      },
      {
        phase: "milestone",
        allow: ["milestone-organizer"],
        block: ["implementer", "pr-opener", "verify-gate"],
      },
      {
        phase: "pr",
        allow: ["pr-opener"],
        block: ["implementer", "milestone-organizer", "verify-gate"],
      },
    ]
    for (const row of table) {
      advanceHarnessTo(fake, row.phase)
      expect(getActiveRun()?.phase).toBe(row.phase)
      for (const role of row.allow) {
        expect(workflow(fake, { name: role })?.block).toBeFalsy()
      }
      for (const role of row.block) {
        const result = workflow(fake, { name: role })
        expect(result?.block).toBe(true)
        expect(result?.reason).toContain(row.phase)
        expect(result?.reason).toContain(row.allow[0])
      }
    }
  })

  test("design walks intake→handoff; architect consult→handoff", async () => {
    const design = setup()
    await design.commands.get("design")!.handler("auth", design.ctx)
    expect(getActiveRun()?.phase).toBe("intake")
    fire(design, "pdr-writer", "PDR: session/pdr.json")
    expect(getActiveRun()?.phase).toBe("pdr")
    fire(design, "pdr-reviewer", OK)
    expect(getActiveRun()?.phase).toBe("arc42")
    fire(design, "arc42-reviewer", OK)
    expect(getActiveRun()?.phase).toBe("adr")
    fire(design, "adr-writer", MADR)
    expect(getActiveRun()?.phase).toBe("handoff")
    turn(design, DESIGN_HANDOFF)
    expect(getActiveRun()?.phase).toBe("handoff")
    noAutoCommands(design)

    const architect = setup()
    await architect.commands.get("architect")!.handler("boundaries?", architect.ctx)
    expect(getActiveRun()?.phase).toBe("consult")
    turn(architect, ARCHITECT_DONE)
    expect(getActiveRun()?.phase).toBe("handoff")
    turn(architect, ARCHITECT_DONE)
    expect(getActiveRun()).toBeNull()
    noAutoCommands(architect)
  })

  test("only implementer-evidence with issueId and green.exitCode 0 advances; prose GREEN only follow-ups", async () => {
    const fake = setup()
    await startHarness(fake)
    advanceHarnessTo(fake, "implement")
    const before = getActiveRun()
    fire(fake, "implementer", evidence("", 0))
    expect(getActiveRun()?.phase).toBe("implement")
    fire(fake, "implementer", evidence("dotfiles-x", 1))
    expect(getActiveRun()?.phase).toBe("implement")
    fire(fake, "implementer", JSON.stringify({ issueId: "dotfiles-x" }))
    expect(getActiveRun()?.phase).toBe("implement")
    fire(fake, "implementer", GREEN_SKIP)
    expect(getActiveRun()?.phase).toBe("implement")
    expect(getActiveRun()?.attempts).toBe(0)
    const followUpsBefore = fake.userMessages.filter((m) =>
      m.includes("kind: harness-after-bite-gate"),
    ).length
    turn(fake, GREEN_SKIP)
    expect(getActiveRun()?.phase).toBe("implement")
    expect(getActiveRun()).toBe(before)
    expect(
      fake.userMessages.filter((m) => m.includes("kind: harness-after-bite-gate")).length,
    ).toBe(followUpsBefore + 1)
    expect(fake.userMessageOptions.at(-1)).toEqual({ deliverAs: "followUp" })
    fire(fake, "implementer", `Implementer GREEN\n${evidence("dotfiles-x", 0)}`)
    expect(getActiveRun()?.phase).toBe("verify")
  })

  test("verify-gate review ok:false stays in verify", async () => {
    const fake = setup()
    await startHarness(fake)
    advanceHarnessTo(fake, "verify")
    fire(fake, "verify-gate", JSON.stringify({ ok: false, feedback: "nope", blocking: ["x"] }))
    expect(getActiveRun()).toMatchObject({ phase: "verify", attempts: 0 })
  })

  test("verify mixed reviews: ok:true then ok:false stays in verify", async () => {
    const fake = setup()
    await startHarness(fake)
    advanceHarnessTo(fake, "verify")
    fake.listeners.find((l) => l.event === "tool_result")!.handler({
      toolName: "workflow",
      isError: false,
      input: {
        script: `agent("v", { agentType: "verify-gate" }); agent("c", { agentType: "code-reviewer" })`,
      },
      content: [{ type: "text", text: `${OK}\n${FAIL}` }],
    })
    expect(getActiveRun()?.phase).toBe("verify")
  })

  test("verify-gate prose without review JSON stays in verify", async () => {
    const fake = setup()
    await startHarness(fake)
    advanceHarnessTo(fake, "verify")
    fire(fake, "verify-gate", "")
    expect(getActiveRun()?.phase).toBe("verify")
    fire(fake, "verify-gate", "{}")
    expect(getActiveRun()?.phase).toBe("verify")
    fire(fake, "verify-gate", "verified")
    expect(getActiveRun()?.phase).toBe("verify")
    fire(fake, "verify-gate", "ok")
    expect(getActiveRun()?.phase).toBe("verify")
    fire(fake, "verify-gate", "verification failed: terminal command exited 1", { isError: false })
    expect(getActiveRun()?.phase).toBe("verify")
  })

  test("goalComplete is a sibling object; review ok:false stays and caps attempts", async () => {
    const fake = setup()
    await startHarness(fake)
    advanceHarnessTo(fake, "spec")
    fire(fake, "spec-reviewer", "{}")
    fire(fake, "spec-reviewer", JSON.stringify({ ok: true }))
    fire(fake, "spec-reviewer", JSON.stringify({ ok: "true", feedback: "x", blocking: [] }))
    expect(getActiveRun()).toMatchObject({ phase: "spec", attempts: 0 })
    fire(fake, "spec-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "spec", attempts: 1 })
    fire(fake, "spec-reviewer", FAIL)
    fire(fake, "spec-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "spec", attempts: 3 })
    fire(fake, "spec-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "spec", attempts: 3 })
    fire(fake, "spec-reviewer", OK)
    expect(getActiveRun()).toMatchObject({ phase: "plan", attempts: 0, injects: 0 })

    advanceHarnessTo(fake, "bitesize")
    fire(fake, "bite-size-reviewer", FAIL)
    fire(fake, "bite-size-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "bitesize", attempts: 2 })
    fire(fake, "bite-size-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "bitesize", attempts: 2 })
    fire(fake, "bite-size-reviewer", OK)
    expect(getActiveRun()?.phase).toBe("implement")

    advanceHarnessTo(fake, "milestone")
    fire(
      fake,
      "milestone-organizer",
      JSON.stringify({ ok: true, feedback: "p", blocking: [], goalComplete: true }),
    )
    expect(getActiveRun()?.phase).toBe("pr")
    await startHarness(fake)
    advanceHarnessTo(fake, "milestone")
    fire(fake, "milestone-organizer", OK)
    expect(getActiveRun()?.phase).toBe("pr")
    await startHarness(fake)
    advanceHarnessTo(fake, "milestone")
    fire(fake, "milestone-organizer", `${OK}\n${JSON.stringify({ goalComplete: false })}`)
    expect(getActiveRun()).toMatchObject({ phase: "bitesize", attempts: 0 })
    advanceHarnessTo(fake, "milestone")
    fire(
      fake,
      "milestone-organizer",
      JSON.stringify({ ok: true, feedback: "p", blocking: [], goalComplete: false }),
    )
    expect(getActiveRun()).toMatchObject({ phase: "bitesize", attempts: 0 })
  })

  test("injects cap at 3 per phase and reset on phase change; design/architect cannot inject forever", async () => {
    const harness = setup()
    await startHarness(harness, "bound")
    for (let i = 0; i < 4; i++) turn(harness, GREEN_SKIP)
    expect(getActiveRun()?.injects).toBe(3)
    expect(
      harness.userMessages.filter((m) => m.includes("kind: harness-after-bite-gate")),
    ).toHaveLength(3)
    fire(harness, "research-orchestrator", '{"researchComplete":true}')
    expect(getActiveRun()).toMatchObject({ phase: "spec", injects: 0, attempts: 0 })
    turn(harness, GREEN_SKIP)
    expect(getActiveRun()?.injects).toBe(1)

    const design = setup()
    await design.commands.get("design")!.handler("auth", design.ctx)
    fire(design, "research-orchestrator", "intake done")
    expect(getActiveRun()?.phase).toBe("intake")
    fire(design, "pdr-writer", "PDR: session/pdr.json")
    fire(design, "pdr-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "pdr", attempts: 1 })
    fire(design, "pdr-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "pdr", attempts: 2 })
    fire(design, "pdr-reviewer", FAIL)
    expect(getActiveRun()).toMatchObject({ phase: "pdr", attempts: 2 })
    fire(design, "pdr-reviewer", OK)
    fire(design, "arc42-reviewer", OK)
    fire(design, "adr-writer", MADR)
    expect(getActiveRun()?.phase).toBe("handoff")
    for (let i = 0; i < 4; i++) turn(design, "still designing")
    expect(getActiveRun()?.injects).toBe(3)
    expect(getActiveRun()?.phase).toBe("handoff")
    const designFollows = design.userMessages.filter((m) =>
      m.includes("kind: design-handoff-gate"),
    )
    expect(designFollows).toHaveLength(3)
    expect(designFollows.every((m) => m.includes("PDR") && m.includes("nextStep"))).toBe(true)
    noAutoCommands(design)
    turn(design, DESIGN_HANDOFF)
    expect(getActiveRun()?.phase).toBe("handoff")
    noAutoCommands(design)

    const architect = setup()
    await architect.commands.get("architect-layered")!.handler("hex?", architect.ctx)
    for (let i = 0; i < 4; i++) turn(architect, "kind: architect-consult\nstill thinking")
    expect(getActiveRun()).toMatchObject({ phase: "consult", injects: 0 })
    for (let i = 0; i < 4; i++) turn(architect, "that's all")
    expect(getActiveRun()).toMatchObject({ phase: "consult", injects: 3 })
    const stepFollows = architect.userMessages.filter((m) => m.includes("step-0:"))
    expect(stepFollows).toHaveLength(3)
    for (const msg of stepFollows) {
      for (let n = 0; n <= 8; n++) expect(msg).toContain(`step-${n}:`)
      expect(msg).not.toMatch(/^\/(harness|design)\b/m)
    }
    noAutoCommands(architect)
    turn(architect, ARCHITECT_DONE)
    expect(getActiveRun()?.phase).toBe("handoff")
    expect(getActiveRun()?.injects).toBe(0)
    noAutoCommands(architect)
  })

  test("pr-opener without PR URL or with error does not clear; empty MADR does not leave adr", async () => {
    const fake = setup()
    await startHarness(fake)
    advanceHarnessTo(fake, "pr")
    fire(fake, "pr-opener", "opened a PR", { isError: false })
    expect(getActiveRun()?.phase).toBe("pr")
    fire(fake, "pr-opener", "https://github.com/acme/dotfiles/pull/9", { isError: true })
    expect(getActiveRun()?.phase).toBe("pr")
    fire(fake, "pr-opener", "https://github.com/acme/dotfiles/pull/9")
    expect(getActiveRun()).toBeNull()

    const design = setup()
    await design.commands.get("design")!.handler("x", design.ctx)
    fire(design, "pdr-writer", "PDR: session/pdr.json")
    fire(design, "pdr-reviewer", OK)
    fire(design, "arc42-reviewer", OK)
    fire(design, "adr-writer", JSON.stringify({ adrs: [] }))
    expect(getActiveRun()?.phase).toBe("adr")
    fire(design, "adr-writer", MADR)
    expect(getActiveRun()?.phase).toBe("handoff")
  })


  test("research stall without GREEN injects phase-gate; chatter does not", async () => {
    const fake = setup()
    await startHarness(fake)
    turn(fake, "still researching")
    expect(getActiveRun()?.injects).toBe(0)
    turn(fake, "that's all")
    expect(getActiveRun()?.injects).toBe(1)
    expect(
      fake.userMessages.some((m) => m.includes("kind: harness-phase-gate") && m.includes("phase: research")),
    ).toBe(true)
  })
})
