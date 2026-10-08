import { mock } from "bun:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const settings = JSON.parse(readFileSync(join(import.meta.dir, "../settings.json"), "utf8"))
export const workflowRoot = settings.packages.find((entry: unknown) =>
  typeof entry === "string" && entry.endsWith("/pi-dynamic-workflows")) as string
const peerRequire = createRequire(join(workflowRoot, "package.json"))

// Alias the installed real validator, not a fake Check implementation.
const validator = { ...await import(peerRequire.resolve("typebox/value")) }
mock.module("typebox/value", () => validator)
