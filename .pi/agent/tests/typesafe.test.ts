import { expect, test } from "bun:test"
import {
  deleteTypesafeAuth,
  parseState,
  resolveApiKey,
  storedApiKey,
  toApiQuestions,
  typesafeCommand,
  upsertTypesafeAuth,
} from "../extensions/typesafe.ts"

test("parseState keeps plain text and parses JSON", () => {
  expect(parseState("hello")).toBe("hello")
  expect(parseState('{"a":1}')).toEqual({ a: 1 })
  expect(parseState("{nope")).toBe("{nope")
})

test("toApiQuestions maps choice/noul/score", () => {
  expect(
    toApiQuestions([
      {
        id: "route",
        type: "choice",
        instructions: "What is this?",
        options: [{ id: "billing" }, { id: "tech", description: "bugs" }],
      },
      { id: "urgent", type: "noul", instructions: "Urgent?" },
      {
        id: "heat",
        type: "score",
        instructions: "Anger",
        levels: ["calm", "mad"],
      },
    ]),
  ).toEqual({
    route: {
      type: "choice",
      instructions: "What is this?",
      criteria: { billing: null, tech: "bugs" },
    },
    urgent: { type: "noul", instructions: "Urgent?" },
    heat: { type: "score", instructions: "Anger", criteria: ["calm", "mad"] },
  })
})

test("toApiQuestions rejects dupes and incomplete shapes", () => {
  expect(() =>
    toApiQuestions([
      { id: "a", type: "noul", instructions: "x" },
      { id: "a", type: "noul", instructions: "y" },
    ]),
  ).toThrow("duplicate")
  expect(() =>
    toApiQuestions([{ id: "c", type: "choice", instructions: "x" }]),
  ).toThrow("options")
  expect(() =>
    toApiQuestions([
      { id: "s", type: "score", instructions: "x", levels: ["only"] },
    ]),
  ).toThrow("levels")
})


test("typesafeCommand login vs logout", () => {
  expect(typesafeCommand("")).toBe("login")
  expect(typesafeCommand("login")).toBe("login")
  expect(typesafeCommand("logout")).toBe("logout")
})

test("resolveApiKey prefers auth.json over env", () => {
  expect(resolveApiKey("env", "stored")).toBe("stored")
  expect(resolveApiKey("env", undefined)).toBe("env")
  expect(resolveApiKey(undefined, undefined)).toBeUndefined()
  expect(storedApiKey({ type: "api_key", key: " k " })).toBe("k")
  expect(storedApiKey({ type: "oauth" })).toBeUndefined()
})

test("upsert/delete typesafe auth entry", () => {
  const data = { anthropic: { type: "api_key", key: "x" } }
  const saved = upsertTypesafeAuth(data, "ts_1")
  expect(saved.typesafe).toEqual({ type: "api_key", key: "ts_1" })
  expect(saved.anthropic).toEqual({ type: "api_key", key: "x" })
  expect(deleteTypesafeAuth(saved).typesafe).toBeUndefined()
  expect(deleteTypesafeAuth(saved).anthropic).toEqual({ type: "api_key", key: "x" })
})
