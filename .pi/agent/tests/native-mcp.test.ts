import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"))

test("native MCP owns connections without adapter or eager server tools", () => {
  const settings = json(join(root, "settings.json"))
  const sources = settings.packages.map((entry: string | { source: string }) =>
    typeof entry === "string" ? entry : entry.source)
  expect(sources).not.toContain("npm:pi-mcp-adapter")
  expect(settings.extensions).not.toContain("-builtin:mcp")

  const global = json(join(root, "mcp.json")).mcpServers
  const project = json(join(root, "..", "mcp.json")).mcpServers
  expect(Object.keys(global).sort()).toEqual(["atlassian", "tokensave"])
  expect(Object.keys(project).sort()).toEqual(["chrome-devtools", "context7", "github", "parallel-search"])
  for (const server of Object.values({ ...global, ...project }) as Record<string, unknown>[]) {
    expect(server.exposure).toBe("codemode")
    expect(server.description).toBeTruthy()
    expect(server).not.toHaveProperty("directTools")
    expect(server).not.toHaveProperty("lifecycle")
    expect(server).not.toHaveProperty("bearerToken")
  }
  expect(project.github.headers.Authorization).toContain("gh auth token --hostname github.com")
  expect(project.github.headers.Authorization).toContain("Bearer %s")
})


test("Pi 1.0 keeps one goal owner and bounded codemode declarations", () => {
  const settings = json(join(root, "settings.json"))
  const sources = settings.packages.map((entry: string | { source: string }) =>
    typeof entry === "string" ? entry : entry.source)
  expect(sources).toContain("npm:pi-goal-x")
  expect(sources).not.toContain("npm:@narumitw/pi-goal")
  expect(settings.defaultTools).toContain("+codemode")
  expect(settings.defaultTools).toContain("+tool_search")
  expect(settings.defaultTools).toContain("-edit")
  expect(settings.codemode).toEqual({ mode: "only", inlineBudget: 1200 })
})

test("workflow children load background tools without recursive delegation", () => {
  const policy = json(join(root, "workflows/settings.json"))
  expect(policy.defaultConcurrency).toBe(8)
  expect(policy.providerMiddlewareExtensions).toContain("pi-background-tasks")
  for (const name of ["bg_delegate", "bg_run_pi_attested", "fusion_investigate",
    "fusion_reason", "fusion_research", "fusion_validate"]) {
    expect(policy.excludeSubagentTools).toContain(name)
  }
  for (const name of ["implementer", "verify-gate"]) {
    const role = readFileSync(join(root, `agents/${name}.md`), "utf8")
    for (const tool of ["bg_run", "bg_status", "bg_logs", "bg_kill"]) expect(role).toContain(tool)
    expect(role).toContain("isAgent:false")
  }
})
