import { describe, expect, test } from "bun:test";
import {
  GATE_BUDGETS,
  PHASE_ORDER,
  type DurableSnapshot,
  type GateName,
  applyTransition,
  canBeginPhase,
  createInitialSnapshot,
  restoreFromSnapshot,
} from "../extensions/goal-harness/phase-machine";

describe("durable harness phase machine", () => {
  test("exact forward order", () => {
    expect([...PHASE_ORDER]).toEqual([
      "Init",
      "Research",
      "Spec",
      "Plan",
      "BiteSize",
      "Implement",
      "Integration",
      "Milestone",
      "PR",
    ]);
  });

  test("exact gate budgets 3/3/2/3", () => {
    expect(GATE_BUDGETS.Spec).toBe(3);
    expect(GATE_BUDGETS.Plan).toBe(3);
    expect(GATE_BUDGETS.BiteSize).toBe(2);
    expect(GATE_BUDGETS.Milestone).toBe(3);
  });

  test("no phase begins before Beads predecessor transition", () => {
    const snap = createInitialSnapshot("run-1", "goal text");
    expect(canBeginPhase(snap, "Init")).toBe(true);
    expect(canBeginPhase(snap, "Research")).toBe(false);
    let s = applyTransition(snap, { type: "complete", phase: "Init" });
    expect(canBeginPhase(s, "Research")).toBe(true);
    expect(canBeginPhase(s, "Spec")).toBe(false);
    s = applyTransition(s, { type: "complete", phase: "Research" });
    expect(canBeginPhase(s, "Spec")).toBe(true);
  });

  test("arbitrary skipping/reordering is rejected", () => {
    const snap = createInitialSnapshot("run-1", "g");
    expect(() =>
      applyTransition(snap, { type: "complete", phase: "Plan" }),
    ).toThrow(/order|predecessor|cannot/i);
    expect(() =>
      applyTransition(snap, { type: "begin", phase: "Implement" }),
    ).toThrow(/order|predecessor|cannot/i);
  });

  test("failed gate returns to producer while budget remains", () => {
    let s = createInitialSnapshot("run-1", "g");
    s = applyTransition(s, { type: "complete", phase: "Init" });
    s = applyTransition(s, { type: "complete", phase: "Research" });
    s = applyTransition(s, { type: "begin", phase: "Spec" });
    s = applyTransition(s, {
      type: "gate_fail",
      gate: "Spec",
      feedback: "fix scope",
    });
    expect(s.phase).toBe("Spec");
    expect(s.gateAttempts.Spec).toBe(1);
    expect(s.status).toBe("awaiting_producer");
    expect(s.lastFeedback).toBe("fix scope");
  });

  test("exhausted budget becomes blocked and requires user input", () => {
    let s = createInitialSnapshot("run-1", "g");
    s = applyTransition(s, { type: "complete", phase: "Init" });
    s = applyTransition(s, { type: "complete", phase: "Research" });
    s = applyTransition(s, { type: "begin", phase: "Spec" });
    for (let i = 0; i < 3; i++) {
      s = applyTransition(s, {
        type: "gate_fail",
        gate: "Spec",
        feedback: `fail ${i}`,
      });
    }
    expect(s.gateAttempts.Spec).toBe(3);
    expect(s.status).toBe("blocked");
    expect(s.requiresUserInput).toBe(true);
    // further gate_fail rejected
    expect(() =>
      applyTransition(s, { type: "gate_fail", gate: "Spec", feedback: "x" }),
    ).toThrow(/blocked|budget|user/i);
  });

  test("BiteSize budget is 2", () => {
    let s = createInitialSnapshot("run-1", "g");
    s = applyTransition(s, { type: "complete", phase: "Init" });
    s = applyTransition(s, { type: "complete", phase: "Research" });
    s = applyTransition(s, { type: "begin", phase: "Spec" });
    s = applyTransition(s, { type: "gate_pass", gate: "Spec" });
    s = applyTransition(s, { type: "begin", phase: "Plan" });
    s = applyTransition(s, { type: "gate_pass", gate: "Plan" });
    s = applyTransition(s, { type: "begin", phase: "BiteSize" });
    s = applyTransition(s, {
      type: "gate_fail",
      gate: "BiteSize",
      feedback: "too big",
    });
    expect(s.status).toBe("awaiting_producer");
    s = applyTransition(s, {
      type: "gate_fail",
      gate: "BiteSize",
      feedback: "still big",
    });
    expect(s.status).toBe("blocked");
    expect(s.requiresUserInput).toBe(true);
  });

  test("gate pass advances to next phase", () => {
    let s = createInitialSnapshot("run-1", "g");
    s = applyTransition(s, { type: "complete", phase: "Init" });
    s = applyTransition(s, { type: "complete", phase: "Research" });
    s = applyTransition(s, { type: "begin", phase: "Spec" });
    s = applyTransition(s, { type: "gate_pass", gate: "Spec" });
    expect(s.phase).toBe("Plan");
    expect(s.completed).toContain("Spec");
    expect(s.status).toBe("ready");
  });

  test("restart input is durable-state snapshot never chat text", () => {
    let s = createInitialSnapshot("run-1", "goal");
    s = applyTransition(s, { type: "complete", phase: "Init" });
    s = applyTransition(s, { type: "complete", phase: "Research" });
    const json = JSON.stringify(s);
    const restored = restoreFromSnapshot(JSON.parse(json) as DurableSnapshot);
    expect(restored.runId).toBe("run-1");
    expect(restored.boundGoal).toBe("goal");
    expect(restored.completed).toEqual(["Init", "Research"]);
    expect(canBeginPhase(restored, "Spec")).toBe(true);
    // chat/compaction blobs rejected
    expect(() =>
      restoreFromSnapshot({
        kind: "chat",
        text: "please continue from plan",
      } as unknown as DurableSnapshot),
    ).toThrow(/snapshot|durable/i);
  });
});
