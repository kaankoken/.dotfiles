import { describe, expect, test } from "bun:test";
import {
  DESIGN_GATE_BUDGETS,
  applyDesignTransition,
  createInitialDesignSnapshot,
} from "../extensions/design-flow/phase-machine";

function snapThroughPdrBegin() {
  let s = createInitialDesignSnapshot("phase-1", "goal");
  s = applyDesignTransition(s, { type: "begin", phase: "Intake" });
  s = applyDesignTransition(s, { type: "complete", phase: "Intake" });
  s = applyDesignTransition(s, { type: "begin", phase: "Pdr" });
  return s;
}

describe("design-flow phase machine", () => {
  test("single Pdr gate_fail stays awaiting_review under budget", () => {
    let s = snapThroughPdrBegin();
    s = applyDesignTransition(s, {
      type: "gate_fail",
      gate: "Pdr",
      feedback: "needs work",
    });
    expect(s.status).toBe("awaiting_review");
    expect(s.gateAttempts.Pdr).toBe(1);
    expect(s.lastError).toBe("needs work");
  });

  test("Pdr gate_fail × budget → failed with attempts=budget", () => {
    let s = snapThroughPdrBegin();
    for (let i = 0; i < DESIGN_GATE_BUDGETS.Pdr; i++) {
      s = applyDesignTransition(s, {
        type: "gate_fail",
        gate: "Pdr",
        feedback: `fail ${i + 1}`,
      });
    }
    expect(s.status).toBe("failed");
    expect(s.gateAttempts.Pdr).toBe(DESIGN_GATE_BUDGETS.Pdr);
    expect(s.lastError).toMatch(/Pdr failed after 2/);
  });
});
