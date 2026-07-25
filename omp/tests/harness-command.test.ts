import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_GOAL,
  bindGoal,
  HARNESS_COMMAND_NAME,
  handleHarnessCommand,
  registerHarnessCommand,
} from "../extensions/goal-harness/index";
import {
  runGoalHarness,
  WORKFLOW_SOURCE,
} from "../workflows/goal-harness";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";

describe("harness command binding", () => {
  test("bindGoal empty and non-empty", () => {
    expect(bindGoal("")).toBe(DEFAULT_GOAL);
    expect(bindGoal("Add offline mode")).toBe("Add offline mode");
    expect(bindGoal("  preserve spaces  ")).toBe("  preserve spaces  ");
  });

  test("DEFAULT_GOAL is exact seven lines", () => {
    const lines = DEFAULT_GOAL.split("\n");
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe("1. No errors, warnings, test failures");
    expect(lines[6]).toBe("7. Specs/plans always tracked in bd (SoT)");
    expect(DEFAULT_GOAL).not.toMatch(/heading|Default goal|quality bar/i);
    expect(lines.some((l) => l.startsWith("8."))).toBe(false);
  });

  test("registers only harness", () => {
    const registered: string[] = [];
    const api = {
      registerCommand(name: string) {
        registered.push(name);
      },
    };
    registerHarnessCommand(api);
    expect(registered).toEqual([HARNESS_COMMAND_NAME]);
    expect(registered).not.toContain("goal");
    expect(registered).not.toContain("guided-goal");
    expect(registered).not.toContain("init");
  });

  test("handler queues exactly one internal start message importing workflow", () => {
    const result = handleHarnessCommand("");
    expect(result.startMessages.length).toBe(1);
    expect(result.startMessages[0].workflowModule).toBe(
      "omp/workflows/goal-harness.ts",
    );
    expect(result.boundGoal).toBe(DEFAULT_GOAL);
    expect(result.controllerPolicy).toBeTruthy();
    expect(result.boundGoal).not.toContain(result.controllerPolicy);
    expect(result.controllerPolicy).not.toContain("1. No errors");
  });

  test("boundGoal is separate from controller policy", () => {
    const result = handleHarnessCommand("Ship offline mode");
    expect(result.boundGoal).toBe("Ship offline mode");
    expect(result.startMessages[0].boundGoal).toBe("Ship offline mode");
    expect(result.startMessages[0].controllerPolicy).not.toBe(
      result.boundGoal,
    );
  });

  test("sendMessage triggerTurn once after handler", async () => {
    const messages: Array<{ text: string; opts?: { triggerTurn?: boolean } }> =
      [];
    let handler: ((ctx: { args?: string }) => Promise<unknown>) | undefined;
    const api = {
      registerCommand(_name: string, opts: Record<string, unknown>) {
        handler = opts.handler as (ctx: { args?: string }) => Promise<unknown>;
      },
      sendMessage(text: string, opts?: { triggerTurn?: boolean }) {
        messages.push({ text, opts });
      },
    };
    registerHarnessCommand(api);
    expect(handler).toBeTruthy();
    await handler!({ args: "test goal" });
    expect(messages.length).toBe(1);
    expect(messages[0].opts?.triggerTurn).toBe(true);
    expect(messages[0].text).toContain("goal-harness-start");
    expect(messages[0].text).toContain("omp/workflows/goal-harness.ts");
  });

  test("workflow calls all four Workflowz primitives", async () => {
    const seen = new Set<string>();
    const fake: Workflowz = {
      phase(t) {
        seen.add("phase");
        seen.add(`phase:${t}`);
      },
      async agent(_p, options) {
        seen.add("agent");
        expect(options.schemaMode).toBe("strict");
        expect(options.agentName).toBeTruthy();
        expect(options.model).toBeTruthy();
        expect(options.outputSchema).toBeTruthy();
        if (options.agentName.includes("scout")) {
          return {
            scout: options.agentName,
            findings: ["ok"],
            sources: [`src://${options.agentName}`],
            structured: true,
          };
        }
        if (options.agentName.includes("reviewer")) {
          return { ok: true, feedback: "ok", blocking: [] };
        }
        if (options.agentName.includes("writer")) {
          return {
            title: "Spec",
            sections: { problem: "p" },
            sources: ["s1"],
          };
        }
        return { ok: true, feedback: "ok", blocking: [] };
      },
      async parallel(jobs) {
        seen.add("parallel");
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items, ...stages) {
        seen.add("pipeline");
        let cur = items;
        for (const st of stages) {
          cur = await Promise.all(cur.map((i) => st(i)));
        }
        return cur;
      },
    };
    await runGoalHarness({
      boundGoal: "test",
      workflowz: fake,
    });
    expect(seen.has("phase")).toBe(true);
    expect(seen.has("agent")).toBe(true);
    expect(seen.has("parallel")).toBe(true);
    expect(seen.has("pipeline")).toBe(true);
  });

  test("no source imports pi-dynamic-workflows", () => {
    const roots = [
      join(import.meta.dir, "../extensions/goal-harness/index.ts"),
      join(import.meta.dir, "../workflows/goal-harness.ts"),
      join(import.meta.dir, "../extensions/goal-harness/workflow-adapter.ts"),
      join(import.meta.dir, "../extensions/goal-harness/phase-machine.ts"),
    ];
    for (const f of roots) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/pi-dynamic-workflows/);
    }
    expect(WORKFLOW_SOURCE).toBe("omp/workflows/goal-harness.ts");
  });

  test("extension load performs no model call", async () => {
    let modelCalls = 0;
    const api = {
      registerCommand() {},
      // if someone wrongly calls models during load:
      models: {
        list() {
          modelCalls++;
          return [];
        },
      },
    };
    const mod = await import("../extensions/goal-harness/index");
    await mod.default(api as never);
    expect(modelCalls).toBe(0);
  });
});
