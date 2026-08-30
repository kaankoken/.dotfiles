import { describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import goalHarness from "../extensions/goal-harness.ts"
import prReviewer from "../extensions/pr-reviewer.ts"

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
  const notifications: Array<{ message: string; kind?: string }> = []
  const availableModels = options.models ?? [
    { provider: "xai", id: "grok-4.6" },
    { provider: "openai-codex", id: "gpt-5.6-sol" },
  ]
  const selectedModels: FakeModel[] = []
  const thinkingLevels: string[] = []

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
    sendUserMessage(content: string | unknown) {
      userMessages.push(typeof content === "string" ? content : JSON.stringify(content))
    },
    async setModel(model: FakeModel) {
      selectedModels.push(model)
      return true
    },
    setThinkingLevel(level: string) {
      thinkingLevels.push(level)
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
    notifications,
    selectedModels,
    thinkingLevels,
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
    expect(md).toContain("anthropic/claude-opus-5:xhigh")
    expect(md).toContain("freeze paths + worktree")
    const ext = await Bun.file(new URL("../extensions/pr-reviewer.ts", import.meta.url)).text()
    expect(ext).toContain("pr-opus-reviewer")
    expect(ext).toContain("opus-initial.json")
    expect(ext).toContain("own initial JSON plus the other two peer JSONs")
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
    expect(msg).toContain("Never load `~/.omp/agent/*`")
    expect(msg).toContain("The parent session is the research controller only")
    expect(msg).toContain("research-orchestrator.md")
    expect(msg).toContain("ctx_batch_execute")
    expect(msg).toContain("tokensave")
    expect(msg).toContain("graphify")
    expect(msg).toContain("caveman")
    expect(msg).toContain("context-mode")
    expect(msg).toContain("Max 3 review rounds")
    expect(msg).not.toMatch(/using-superpowers|requiredSuperpowers|~\/\.omp\/agent\/(?:skills|extensions)/)
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
})
