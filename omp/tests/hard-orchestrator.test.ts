import { describe, expect, test } from "bun:test";
import {
  defaultHarnessModelCatalog,
  handleHarnessCommand,
  registerHarnessCommand,
  resolveHarnessModels,
  runHardHarness,
  createWorkflowzFromPi,
  loadAgentRolePrompt,
} from "../extensions/goal-harness/index";
import type { ActivePiApi } from "../extensions/goal-harness/lane-runner";
import type { SessionCreateOpts } from "../extensions/goal-harness/lane-runner";
import { join } from "node:path";

const agentsDir = join(import.meta.dir, "../agents");

function fakePi(
  capture: { sessions: SessionCreateOpts[] },
  outputs: unknown[],
): ActivePiApi {
  let i = 0;
  return {
    SessionManager: {
      inMemory() {
        return { kind: "mem" };
      },
    },
    async createAgentSession(opts) {
      capture.sessions.push(opts);
      const out = outputs[i++] ?? { ok: true, feedback: "", blocking: [] };
      return {
        async prompt() {
          return {};
        },
        async getOutput() {
          return out;
        },
      };
    },
  };
}

describe("hard orchestrator", () => {
  test("model-router assigns Fable writer and Opus reviewer (OpenAI last)", () => {
    const m = resolveHarnessModels(defaultHarnessModelCatalog());
    expect(m.spec).toBe("anthropic/claude-fable-5");
    expect(m.specReviewer).toBe("anthropic/claude-opus-5");
    expect(m.plan).toBe("anthropic/claude-fable-5");
    expect(m.planReviewer).toBe("anthropic/claude-opus-5");
    expect(m.research).toMatch(/grok/i);
    expect(m.spec).not.toMatch(/sol|terra/i);
    expect(m.specReviewer).not.toBe(m.spec);
  });

  test("loadAgentRolePrompt reads omp/agents/*.md", () => {
    const body = loadAgentRolePrompt("spec-writer", agentsDir);
    expect(body).toMatch(/spec-writer/i);
  });

  test("createWorkflowzFromPi passes explicit model to session (not parent)", async () => {
    const capture: { sessions: SessionCreateOpts[] } = { sessions: [] };
    const pi = fakePi(capture, [
      { title: "t", sections: { a: "b" }, sources: ["s"] },
    ]);
    const wz = createWorkflowzFromPi({
      cwd: "/tmp",
      pi,
      agentsDir,
    });
    const raw = await wz.agent("write spec", {
      agentName: "spec-writer",
      model: "anthropic/claude-fable-5",
      effort: "max",
      outputSchema: { type: "object" },
      schemaMode: "strict",
    });
    expect(raw).toMatchObject({ title: "t" });
    expect(capture.sessions[0]!.model).toBe("anthropic/claude-fable-5");
    expect(capture.sessions[0]!.thinkingLevel).toBe("max");
    expect(capture.sessions[0]!.outputSchemaMode).toBe("strict");
  });

  test("soft register path: no pi → mode soft + triggerTurn true", async () => {
    const messages: Array<{ mode?: string; triggerTurn?: boolean }> = [];
    let handler:
      | ((a: unknown, b?: unknown) => Promise<{ mode: string }>)
      | undefined;
    registerHarnessCommand({
      registerCommand(_n, opts) {
        handler = opts.handler as typeof handler;
      },
      sendMessage(text, opts) {
        const j = JSON.parse(text) as { mode?: string };
        messages.push({ mode: j.mode, triggerTurn: opts?.triggerTurn });
      },
    });
    const result = await handler!("ship it", {});
    expect(result.mode).toBe("soft");
    expect(messages).toEqual([{ mode: "soft", triggerTurn: true }]);
  });

  test("hard register path: pi present → mode hard + start without triggerTurn", async () => {
    const capture: { sessions: SessionCreateOpts[] } = { sessions: [] };
    // Research scouts need structured synthesis-shaped returns; provide enough
    // to get past first agent call then fail gracefully or complete.
    const researchOut = {
      text: "research",
      sources: ["https://example.com"],
      findings: [],
    };
    const pi = fakePi(capture, [
      researchOut,
      researchOut,
      researchOut,
      researchOut,
      researchOut,
      {
        title: "Spec",
        sections: { goal: "x" },
        sources: ["https://example.com"],
      },
      { ok: true, feedback: "nits only", blocking: [] },
    ]);

    const kinds: string[] = [];
    let handler:
      | ((
          a: unknown,
          b?: unknown,
        ) => Promise<{ mode: string; hardError?: string }>)
      | undefined;
    registerHarnessCommand({
      registerCommand(_n, opts) {
        handler = opts.handler as typeof handler;
      },
      cwd: "/tmp",
      pi,
      sendMessage(text, opts) {
        const j = JSON.parse(text) as { kind: string; mode?: string };
        kinds.push(`${j.kind}:${j.mode ?? ""}:${opts?.triggerTurn}`);
      },
    });

    const result = await handler!("hard goal", { skipHumanGate: true });
    expect(result.mode).toBe("hard");
    expect(kinds[0]).toBe("goal-harness-start:hard:false");
    // First sessions must not silently use a parent Grok default for Spec —
    // research is grok; after research, spec writer is fable when reached.
    const models = capture.sessions.map((s) => s.model);
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => /grok/i.test(m))).toBe(true);
    // If Spec producer ran, it must be fable/opus family not sol
    const nonResearch = models.filter((m) => !/grok/i.test(m));
    for (const m of nonResearch) {
      expect(m).not.toMatch(/gpt-5\.6-sol|terra/i);
    }
  });

  test("handleHarnessCommand default mode is soft", () => {
    expect(handleHarnessCommand("x").mode).toBe("soft");
  });

  test("runHardHarness refuses missing agent role", async () => {
    const capture: { sessions: SessionCreateOpts[] } = { sessions: [] };
    const pi = fakePi(capture, []);
    await expect(
      runHardHarness({
        boundGoal: "x",
        pi,
        cwd: "/tmp",
        skipHumanGate: true,
        modelAdapter: defaultHarnessModelCatalog(),
      }),
    ).rejects.toThrow();
  });
});
