import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const agentDir = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."))
let hostDir = dirname(realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim()))
while (!existsSync(join(hostDir, "package.json")) && hostDir !== dirname(hostDir)) hostDir = dirname(hostDir)
const host = await import(pathToFileURL(join(hostDir, "dist/index.js")))
const { createFauxCore, fauxAssistantMessage } = await import(pathToFileURL(
  join(hostDir, "node_modules/@earendil-works/pi-ai/dist/index.js")))
const config = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
host.initTheme("dark", false)
const scratch = mkdtempSync(join(tmpdir(), "pi-startup-probe-"))
const rows = []
try {
  for (const mode of ["on", "only"]) {
    const settingsManager = host.SettingsManager.inMemory({
      ...config, codemode: { ...config.codemode, mode },
    })
    const resourceLoader = new host.DefaultResourceLoader({
      cwd: scratch, agentDir, settingsManager,
      extensionFactories: [
        { name: "codemode", builtin: true, factory: host.createCodemodeExtension({
          mode, inlineBudget: config.codemode.inlineBudget,
        }) },
        { name: "tool-search", builtin: true, factory: host.createToolSearchExtension() },
      ],
    })
    await resourceLoader.reload()
    const errors = [...resourceLoader.getExtensions().errors]
    assert.equal(errors.length, 0, JSON.stringify(errors))
    const core = createFauxCore({ provider: "startup-probe", models: [
      { id: "offline", name: "Offline probe", contextWindow: 272000, maxTokens: 4096 },
    ] })
    let snapshot
    const runtime = await host.ModelRuntime.create({ authPath: join(scratch, "auth.json"), modelsPath: null })
    runtime.registerProvider("startup-probe", {
      name: "Offline probe", apiKey: "unused-faux-key", baseUrl: "http://127.0.0.1:9/unused",
      api: core.api, models: core.models.map(model => ({
        id: model.id, name: model.name, reasoning: false, input: ["text"],
        contextWindow: 272000, maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
      streamSimple: (...args) => { snapshot = args[1]; return core.streamSimple(...args) },
    })
    core.setResponses([fauxAssistantMessage("OK", { stopReason: "stop" })])
    const { session } = await host.createAgentSession({
      cwd: scratch, agentDir, settingsManager, resourceLoader, modelRuntime: runtime,
      model: runtime.getModel("startup-probe", "offline"),
      sessionManager: host.SessionManager.inMemory(scratch),
    })
    try {
      await session.bindExtensions({ onError: error => errors.push(error) })
      await session.prompt("Startup payload probe. Reply OK without tools.")
      assert.ok(snapshot, "offline provider never received a request")
      assert.equal(errors.length, 0, JSON.stringify(errors))
      const requestCharacters = JSON.stringify(snapshot).length
      const tools = new Map()
      for (const message of snapshot.messages) {
        for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool)
        for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name)
      }
      const toolCharacters = JSON.stringify([...tools.values()]).length
      rows.push({ mode, requestCharacters, estimatedTokens: Math.ceil(requestCharacters / 4),
        toolCharacters, declaredTools: [...tools.keys()],
        registeredTools: session.getAllTools().length })
    } finally {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
    }
  }
  assert.ok(rows[1].requestCharacters < rows[0].requestCharacters, "lean mode must reduce actual request bytes")
  console.log(JSON.stringify({ hostVersion: JSON.parse(readFileSync(join(hostDir, "package.json"), "utf8")).version,
    note: "Real resource loader and provider request; faux model, no paid calls or MCP connections. Tokens are characters/4 estimates, not tokenizer counts.",
    rows, reductionPercent: Math.round((1 - rows[1].requestCharacters / rows[0].requestCharacters) * 1000) / 10,
  }, null, 2))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
