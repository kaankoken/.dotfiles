import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export type ModelHop = { provider: string; modelId: string; effort: Parameters<ExtensionAPI["setThinkingLevel"]>[0] }

export type RouteDoc = {
  providerFailover?: Record<string, string[]>
  cursorModelIds?: Record<string, string>
  composerThen?: ModelHop
  chains?: Record<string, ModelHop[]>
}

export function loadRouteDoc(fromDir = import.meta.dir): RouteDoc {
  const raw = readFileSync(join(fromDir, "model-routes.json"), "utf8")
  return JSON.parse(raw) as RouteDoc
}

export function formatHop(hop: ModelHop): string {
  return `${hop.provider}/${hop.modelId}:${hop.effort}`
}

export function remapModelId(provider: string, modelId: string, doc: RouteDoc): string {
  if (provider !== "cursor") return modelId
  return doc.cursorModelIds?.[modelId] ?? modelId
}

export function expandHop(hop: ModelHop, doc: RouteDoc): ModelHop[] {
  const map = doc.providerFailover ?? {}
  const providers = map[hop.provider] ?? [hop.provider]
  const out: ModelHop[] = providers.map((provider) => ({
    ...hop,
    provider,
    modelId: remapModelId(provider, hop.modelId, doc),
  }))
  if (hop.modelId.includes("composer") && doc.composerThen) {
    const thenProviders = map[doc.composerThen.provider] ?? [doc.composerThen.provider]
    for (const provider of thenProviders) {
      out.push({
        ...doc.composerThen,
        provider,
        modelId: remapModelId(provider, doc.composerThen.modelId, doc),
      })
    }
  }
  return out
}

const FALLBACK_RESEARCH: ModelHop[] = [
  { provider: "openai-codex", modelId: "gpt-6-astra", effort: "xhigh" },
  { provider: "xai", modelId: "grok-4.6", effort: "xhigh" },
  { provider: "xai-oauth", modelId: "grok-4.6", effort: "xhigh" },
  { provider: "openai-codex", modelId: "gpt-5.6-terra", effort: "max" },
  { provider: "cursor", modelId: "gpt-5.6-terra@1m", effort: "max" },
]

export function loadChain(name: string, doc?: RouteDoc): ModelHop[] {
  try {
    const resolved = doc ?? loadRouteDoc()
    const hops = resolved.chains?.[name] ?? []
    return hops.flatMap((hop) => expandHop(hop, resolved))
  } catch {
    return name === "harness-research" ? FALLBACK_RESEARCH : []
  }
}

export function pickFirstAvailable(
  hops: ModelHop[],
  find: (provider: string, modelId: string) => unknown,
): ModelHop | undefined {
  return hops.find((hop) => Boolean(find(hop.provider, hop.modelId)))
}
