import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GOAL,
  bindGoal,
  HARNESS_COMMAND_NAME,
  registerHarnessCommand,
} from "../extensions/goal-harness/index";

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
});
