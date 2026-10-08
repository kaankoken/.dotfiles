import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const agentDir = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."))
const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
const policy = JSON.parse(readFileSync(join(agentDir, "workflows/settings.json"), "utf8"))
const workflowRoot = settings.packages.find(entry => typeof entry === "string" && entry.endsWith("/pi-dynamic-workflows"))
let hostDir = dirname(realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim()))
while (!existsSync(join(hostDir, "package.json")) && hostDir !== dirname(hostDir)) hostDir = dirname(hostDir)
const host = await import(pathToFileURL(join(hostDir, "dist/index.js")))
const { createFauxCore, fauxAssistantMessage, fauxToolCall } = await import(pathToFileURL(
  join(hostDir, "node_modules/@earendil-works/pi-ai/dist/index.js")))
const { WorkflowAgent, installHostCreateAgentSession } = await import(pathToFileURL(join(workflowRoot, "dist/agent.js")))
installHostCreateAgentSession(host.createAgentSession, host)
const scratch = mkdtempSync(join(tmpdir(), "pi-bg-child-probe-"))
try {
  const core = createFauxCore({ provider: "bg-probe", models: [
    { id: "offline", name: "Offline probe", contextWindow: 272000, maxTokens: 4096 },
  ] })
  const runtime = await host.ModelRuntime.create({ authPath: join(scratch, "auth.json"), modelsPath: null })
  const requests = []
  runtime.registerProvider("bg-probe", {
    name: "Offline probe", apiKey: "unused-faux-key", baseUrl: "http://127.0.0.1:9/unused",
    api: core.api, models: core.models.map(model => ({
      id: model.id, name: model.name, reasoning: false, input: ["text"],
      contextWindow: 272000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    streamSimple: (...args) => { requests.push(args[1]); return core.streamSimple(...args) },
  })
  core.setResponses([
    fauxAssistantMessage(fauxToolCall("bg_status", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("OK", { stopReason: "stop" }),
  ])
  const tools = ["read", "bg_run", "bg_status", "bg_logs", "bg_kill"]
  const child = new WorkflowAgent({ cwd: scratch, modelRegistry: new host.ModelRegistry(runtime),
    providerMiddlewareExtensions: policy.providerMiddlewareExtensions, excludeTools: policy.excludeSubagentTools })
  assert.equal(await child.run("Check background task status, then reply OK.", {
    model: "bg-probe/offline", toolNames: tools,
  }), "OK")
  const declared = requests[0].messages.flatMap(message => message.toolsAdded ?? []).map(tool => tool.name)
  for (const tool of tools) assert.ok(declared.includes(tool), `child missing ${tool}`)
  for (const tool of ["workflow", "workflow_control", ...policy.excludeSubagentTools]) {
    assert.ok(!declared.includes(tool), `recursive child tool exposed: ${tool}`)
  }
  const status = requests.flatMap(request => request.messages).find(message =>
    message.role === "toolResult" && message.toolName === "bg_status")
  assert.ok(status && !status.isError, "real background tool did not execute successfully")
  console.log(JSON.stringify({ hostVersion: JSON.parse(readFileSync(join(hostDir, "package.json"), "utf8")).version,
    declaredTools: declared, backgroundToolExecuted: "bg_status", paidCalls: 0 }, null, 2))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
