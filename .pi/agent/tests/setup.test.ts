import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const settings = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"))


test("default parent and harness controller use Astra xhigh", () => {
  expect(settings.defaultProvider).toBe("openai-codex")
  expect(settings.defaultModel).toBe("gpt-6-astra")
  expect(settings.defaultThinkingLevel).toBe("xhigh")
  const routes = JSON.parse(readFileSync(join(root, "workflows/model-routes.json"), "utf8"))
  expect(routes.chains["harness-research"][0]).toEqual({
    provider: "openai-codex", modelId: "gpt-6-astra", effort: "xhigh",
  })
})
test("default test discovery stays inside owned tests, not installed packages", () => {
  const config = Bun.TOML.parse(readFileSync(join(root, "bunfig.toml"), "utf8"))
  expect(config.test?.root).toBe("tests")
})

test("explicit local extensions exist and Bigpowers stays path-load-only", () => {
  for (const path of settings.extensions) expect(existsSync(join(root, path)), path).toBe(true)
  const bp = settings.packages.find((entry: { source?: string }) => entry.source?.startsWith("npm:bigpowers"))
  expect(bp?.skills).toEqual([])
  expect(bp?.prompts).toEqual([])
})

test("harness and design docs point to installed skill files", () => {
  for (const file of ["skills/goal-harness/SKILL.md", "skills/design-flow/SKILL.md"]) {
    const doc = readFileSync(join(root, file), "utf8")
    for (const [path] of doc.matchAll(/~\/[^\s`|]+\/SKILL\.md/g)) {
      if (/[<>*…]/.test(path)) continue
      expect(path.startsWith("~/.pi/agent/"), `${file}: ${path}`).toBe(true)
      expect(existsSync(join(root, path.slice("~/.pi/agent/".length))), path).toBe(true)
    }
    expect(doc).not.toMatch(/hash_bounds|new_content/)
  }
})
