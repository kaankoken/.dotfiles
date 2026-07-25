import { describe, expect, test } from "bun:test";
import {
  type AgentOptions,
  type Workflowz,
  createStrictAgentCall,
  runWithAdapter,
} from "../extensions/goal-harness/workflow-adapter";

describe("Workflowz adapter", () => {
  test("advancing producer/reviewer calls carry agent, model, strict schema", async () => {
    const calls: Array<{ prompt: string; options: AgentOptions }> = [];
    const fake: Workflowz = {
      phase(title) {
        calls.push({ prompt: `PHASE:${title}`, options: {} as AgentOptions });
      },
      async agent(prompt, options) {
        calls.push({ prompt, options });
        return { ok: true, feedback: "x", blocking: [] };
      },
      async parallel(jobs) {
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items, ...stages) {
        let cur = items;
        for (const stage of stages) {
          cur = await Promise.all(cur.map((i) => stage(i)));
        }
        return cur;
      },
    };

    const call = createStrictAgentCall({
      agentName: "spec-writer",
      model: "openai-codex/gpt-5.6-sol",
      effort: "ultra",
      schema: {
        type: "object",
        required: ["ok", "feedback", "blocking"],
        additionalProperties: false,
      },
      schemaMode: "strict",
    });

    await runWithAdapter(fake, async (wz) => {
      wz.phase("Spec");
      await call(wz, "write the spec");
    });

    const agentCalls = calls.filter((c) => !c.prompt.startsWith("PHASE:"));
    expect(agentCalls.length).toBe(1);
    const opts = agentCalls[0].options;
    expect(opts.agentName).toBe("spec-writer");
    expect(opts.model).toBe("openai-codex/gpt-5.6-sol");
    expect(opts.schemaMode).toBe("strict");
    expect(opts.outputSchema).toBeTruthy();
    expect(opts.effort).toBe("ultra");
  });

  test("malformed output never falls back to prose", async () => {
    const fake: Workflowz = {
      phase() {},
      async agent() {
        return "here is prose not JSON";
      },
      async parallel(jobs) {
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items) {
        return items;
      },
    };
    const call = createStrictAgentCall({
      agentName: "spec-reviewer",
      model: "anthropic/claude-fable-5",
      effort: "max",
      schema: { type: "object", required: ["ok"], additionalProperties: false },
      schemaMode: "strict",
    });
    await expect(call(fake, "review")).rejects.toThrow(
      /strict|schema|malformed|prose/i,
    );
  });

  test("missing schemaMode strict is rejected at call construction", () => {
    expect(() =>
      createStrictAgentCall({
        agentName: "x",
        model: "y",
        effort: "high",
        schema: { type: "object" },
        schemaMode: "loose" as "strict",
      }),
    ).toThrow(/strict/i);
  });

  test("parallel and pipeline primitives are invoked", async () => {
    const seen: string[] = [];
    const fake: Workflowz = {
      phase(t) {
        seen.push(`phase:${t}`);
      },
      async agent(p) {
        seen.push(`agent:${p}`);
        return { ok: true, feedback: "", blocking: [] };
      },
      async parallel(jobs) {
        seen.push(`parallel:${jobs.length}`);
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items, ...stages) {
        seen.push(`pipeline:${items.length}:${stages.length}`);
        return items;
      },
    };
    await runWithAdapter(fake, async (wz) => {
      wz.phase("Research");
      await wz.parallel([
        async () => "a",
        async () => "b",
      ]);
      await wz.pipeline([1, 2], async (x) => x);
    });
    expect(seen).toContain("phase:Research");
    expect(seen).toContain("parallel:2");
    expect(seen).toContain("pipeline:2:1");
  });
});
