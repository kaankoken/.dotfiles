// TypeSafe Jev tool — typed judgments, not a chat model.
// Key: /typesafe (auth.json) then TYPESAFE_API_KEY. Optional TYPESAFE_BASE_URL, TYPESAFE_DEFAULT_MODEL.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

const DEFAULT_BASE = "https://api.typesafe.ai"
const DEFAULT_MODEL = "jev-latest"
const TIMEOUT_MS = 20_000

export type JudgeQuestion = {
  id: string
  type: "choice" | "noul" | "score"
  instructions: string
  options?: Array<{ id: string; description?: string }>
  levels?: string[]
}

export function parseState(state: string): unknown {
  const t = state.trim()
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t)
    } catch {
      return state
    }
  }
  return state
}

export function toApiQuestions(
  questions: JudgeQuestion[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const q of questions) {
    if (out[q.id]) throw new Error(`duplicate question id: ${q.id}`)
    if (q.type === "choice") {
      if (!q.options?.length) throw new Error(`${q.id}: choice needs options`)
      const criteria: Record<string, string | null> = {}
      for (const o of q.options) criteria[o.id] = o.description ?? null
      out[q.id] = { type: "choice", instructions: q.instructions, criteria }
    } else if (q.type === "score") {
      if (!q.levels || q.levels.length < 2) {
        throw new Error(`${q.id}: score needs >=2 levels`)
      }
      out[q.id] = {
        type: "score",
        instructions: q.instructions,
        criteria: q.levels,
      }
    } else {
      out[q.id] = { type: "noul", instructions: q.instructions }
    }
  }
  return out
}

export const AUTH_PROVIDER = "typesafe"

export function typesafeCommand(args: string): "login" | "logout" {
  const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  if (sub === "logout") return "logout"
  return "login"
}

export function storedApiKey(
  cred: { type?: string; key?: string } | undefined,
): string | undefined {
  if (cred?.type !== "api_key") return undefined
  return cred.key?.trim() || undefined
}

export function resolveApiKey(
  envKey: string | undefined,
  storedKey: string | undefined,
): string | undefined {
  return storedKey?.trim() || envKey?.trim() || undefined
}

export function upsertTypesafeAuth(
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return { ...data, [AUTH_PROVIDER]: { type: "api_key", key } }
}

export function deleteTypesafeAuth(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data }
  delete next[AUTH_PROVIDER]
  return next
}

export default async function (pi: ExtensionAPI) {
  const { StringEnum, Type } = await import("@earendil-works/pi-ai")
  const { defineTool, getAgentDir, readStoredCredential } = await import(
    "@earendil-works/pi-coding-agent",
  )
  const { chmod, readFile, writeFile } = await import("node:fs/promises")
  const { join } = await import("node:path")

  const authPath = () => join(getAgentDir(), "auth.json")

  async function loadAuth(): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await readFile(authPath(), "utf8"))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("auth.json is not an object")
      }
      return parsed as Record<string, unknown>
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw e
    }
  }

  // ponytail: no auth.json lock; don't /typesafe during /login
  async function saveAuth(data: Record<string, unknown>) {
    const path = authPath()
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    await chmod(path, 0o600)
  }

  pi.registerTool(
    defineTool({
      name: "typesafe_judge",
      label: "TypeSafe",
      description:
        "Ask TypeSafe Jev for typed judgments (choice / noul / score). Not a chat model. Independent questions run in one call; you own control flow.",
      promptSnippet: "TypeSafe Jev typed judgments (choice, noul, score)",
      promptGuidelines: [
        "Use typesafe_judge for closed-set routing, yes/no (noul), or graded scores. Do not treat it as a chat LLM.",
        "Put independent TypeSafe questions in one typesafe_judge call. Code or the parent agent executes side effects.",
      ],
      parameters: Type.Object({
        state: Type.String({
          description: "Text to judge, or a JSON object/array string",
        }),
        questions: Type.Array(
          Type.Object({
            id: Type.String({ description: "Key for this answer" }),
            type: StringEnum(["choice", "noul", "score"] as const),
            instructions: Type.String({
              description: "The judgment; meaning lives here, not in id",
            }),
            options: Type.Optional(
              Type.Array(
                Type.Object({
                  id: Type.String(),
                  description: Type.Optional(Type.String()),
                }),
              ),
            ),
            levels: Type.Optional(
              Type.Array(Type.String(), {
                description: "Ordered score levels; required for score",
              }),
            ),
          }),
          { minItems: 1 },
        ),
        model: Type.Optional(
          Type.String({ description: "Default jev-latest" }),
        ),
      }),

      async execute(_toolCallId, params, signal) {
        const stored = readStoredCredential(AUTH_PROVIDER)
        const key = resolveApiKey(
          process.env.TYPESAFE_API_KEY,
          storedApiKey(stored),
        )
        if (!key) {
          throw new Error(
            "No TypeSafe key. Run /typesafe, or export TYPESAFE_API_KEY.",
          )
        }

        const base = (
          process.env.TYPESAFE_BASE_URL?.trim() || DEFAULT_BASE
        ).replace(/\/$/, "")
        const model =
          params.model?.trim() ||
          process.env.TYPESAFE_DEFAULT_MODEL?.trim() ||
          DEFAULT_MODEL

        const body = {
          state: parseState(params.state),
          model,
          questions: toApiQuestions(params.questions),
        }

        const timeout = AbortSignal.timeout(TIMEOUT_MS)
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

        const res = await fetch(`${base}/v1/systemone`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: combined,
        })

        const text = await res.text()
        if (!res.ok) {
          throw new Error(`TypeSafe ${res.status}: ${text.slice(0, 500)}`)
        }

        let parsed: { model?: string; answers?: unknown; usage?: unknown }
        try {
          parsed = JSON.parse(text) as typeof parsed
        } catch {
          throw new Error(`TypeSafe non-JSON: ${text.slice(0, 500)}`)
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  model: parsed.model,
                  answers: parsed.answers,
                  usage: parsed.usage,
                },
                null,
                2,
              ),
            },
          ],
          details: parsed,
        }
      },
    }),
  )

  pi.registerCommand("typesafe", {
    description: "Save TypeSafe API key to auth.json, or logout",
    getArgumentCompletions: (prefix) => {
      const items = [
        { value: "login", label: "login" },
        { value: "logout", label: "logout" },
      ]
      const filtered = items.filter((i) => i.value.startsWith(prefix))
      return filtered.length ? filtered : null
    },
    handler: async (args, ctx) => {
      if (typesafeCommand(args) === "logout") {
        const data = await loadAuth()
        if (!(AUTH_PROVIDER in data)) {
          ctx.ui.notify("No TypeSafe key stored", "info")
          return
        }
        await saveAuth(deleteTypesafeAuth(data))
        ctx.ui.notify("TypeSafe key removed", "info")
        return
      }
      const key = (await ctx.ui.input("TypeSafe API key", "ts_…"))?.trim()
      if (!key) {
        ctx.ui.notify("Cancelled", "info")
        return
      }
      await saveAuth(upsertTypesafeAuth(await loadAuth(), key))
      ctx.ui.notify("TypeSafe key saved", "info")
    },
  })
}
