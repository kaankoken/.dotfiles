import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseAgentDefinition } from "../npm/node_modules/@quintinshaw/pi-dynamic-workflows/src/agent-registry.ts"
import { expandHop, loadRouteDoc } from "../workflows/model-routes.ts"

const AGENTS_DIR = join(import.meta.dir, "../agents")
const KNOWN_TOOLS = new Set([
  "bash",
  "read",
  "write",
  "replace",
  "insert",
  "undo_last_change",
  "find",
  "ls",
  "web_search",
  "fetch_content",
  "source_check",
])
const FORBIDDEN_TOOLS = new Set(["search", "edit", "grep"])

const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).sort()

describe("agent registry", () => {
  const doc = loadRouteDoc(join(import.meta.dir, "../workflows"))
  const chains = doc.chains ?? {}

  test("every agent parses with a unique name", () => {
    const names = new Set<string>()
    for (const file of files) {
      const def = parseAgentDefinition(readFileSync(join(AGENTS_DIR, file), "utf8"), "user", file)
      expect(def).toBeTruthy()
      expect(def!.name).toBe(file.replace(/\.md$/, ""))
      expect(names.has(def!.name)).toBe(false)
      names.add(def!.name)
    }
    expect(names.size).toBe(files.length)
  })

  test("tools are real Pi/hashline names; no search/edit/grep", () => {
    for (const file of files) {
      const def = parseAgentDefinition(readFileSync(join(AGENTS_DIR, file), "utf8"), "user", file)!
      for (const tool of def.tools ?? []) {
        expect(FORBIDDEN_TOOLS.has(tool), `${file} tool ${tool}`).toBe(false)
        expect(KNOWN_TOOLS.has(tool), `${file} unknown tool ${tool}`).toBe(true)
      }
    }
  })

  test("implementer is worktree + hashline write tools", () => {
    const def = parseAgentDefinition(
      readFileSync(join(AGENTS_DIR, "implementer.md"), "utf8"),
      "user",
      "implementer.md",
    )!
    expect(def.isolation).toBe("worktree")
    expect(def.tools).toEqual(["bash", "read", "replace", "insert", "write"])
  })

  test("route matches model-routes.json first hop (pr-opus keeps xhigh)", () => {
    for (const file of files) {
      const raw = readFileSync(join(AGENTS_DIR, file), "utf8")
      const def = parseAgentDefinition(raw, "user", file)!
      const route = raw.match(/^route:\s*(\S+)/m)?.[1]
      expect(route, file).toBeTruthy()
      expect(chains[route!], file).toBeTruthy()
      const first = chains[route!]![0]!
      const pin = `${first.provider}/${first.modelId}:${first.effort}`
      if (def.name === "pr-opus-reviewer") {
        expect(def.model).toBe("anthropic/claude-opus-5:xhigh")
      } else {
        expect(def.model, file).toBe(pin)
      }
    }
  })

  test("anthropic fable hop failovers to cursor @1m", () => {
    const hops = expandHop(
      { provider: "anthropic", modelId: "claude-fable-5", effort: "max" },
      doc,
    )
    expect(hops.map((h) => `${h.provider}/${h.modelId}:${h.effort}`)).toEqual([
      "anthropic/claude-fable-5:max",
      "cursor/claude-fable-5@1m:max",
    ])
  })

  test("bodies do not point at dead ~/.agents/ponytail or context7 enable", () => {
    for (const file of files) {
      const raw = readFileSync(join(AGENTS_DIR, file), "utf8")
      expect(raw.includes("~/.agents/skills/ponytail"), file).toBe(false)
      expect(raw.includes("/mcp enable context7"), file).toBe(false)
    }
  })

  test("harness reviewers load Bigpowers review + REVIEW-POLICY", () => {
    const reviewers = [
      "code-reviewer.md",
      "spec-reviewer.md",
      "plan-reviewer.md",
      "bite-size-reviewer.md",
      "pdr-reviewer.md",
      "arc42-reviewer.md",
    ]
    for (const file of reviewers) {
      const raw = readFileSync(join(AGENTS_DIR, file), "utf8")
      expect(raw).toContain("~/.pi/agent/policy/REVIEW-POLICY.md")
      expect(raw).toContain("audit-code")
      expect(raw).toContain("request-review")
      expect(raw).toContain("bp-review-to-json")
    }
  })
})
