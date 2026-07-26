import { describe, expect, test } from "bun:test";
import {
  DEBUGGING_REQUIRED_SKILLS,
  DEBUG_STEP_ORDER,
  MAX_HYPOTHESES,
  classifyFailure,
  completeStep,
  currentStep,
  failedHypothesisCount,
  mayImplementFix,
  routeFailureToDebugging,
  startDebugging,
  DebuggingError,
} from "../workflows/debugging";

describe("failure classification", () => {
  test("selects path from observed class not model preference", () => {
    expect(
      classifyFailure({ signal: "bun test failed: expect(received)" }),
    ).toBe("test");
    expect(
      classifyFailure({ signal: "error[E0308]", command: "cargo build" }),
    ).toBe("build");
    expect(
      classifyFailure({
        signal: "Type 'string' is not assignable",
        command: "tsc",
      }),
    ).toBe("typecheck");
    expect(classifyFailure({ signal: "panic at src/main.rs:10" })).toBe(
      "runtime",
    );
    expect(
      classifyFailure({
        signal: "anything",
        classHint: "lint",
      }),
    ).toBe("lint");
  });
});

describe("systematic debugging sequence", () => {
  test("enforces ordered steps reproduce → … → verify", () => {
    expect([...DEBUG_STEP_ORDER]).toEqual([
      "reproduce",
      "gather_evidence",
      "trace_root_cause",
      "compare_working_patterns",
      "state_hypothesis",
      "test_minimally",
      "add_failing_regression",
      "implement_one_fix",
      "verify",
    ]);
    let s = startDebugging({ signal: "test failed: assert eq" });
    expect(s.requiredSkills).toEqual([...DEBUGGING_REQUIRED_SKILLS]);
    expect(currentStep(s)).toBe("reproduce");
    s = completeStep(s, "reproduce");
    s = completeStep(s, "gather_evidence");
    s = completeStep(s, "trace_root_cause");
    s = completeStep(s, "compare_working_patterns");
    expect(currentStep(s)).toBe("state_hypothesis");
    expect(() => completeStep(s, "implement_one_fix")).toThrow(/out-of-order/);
  });

  test("bug agent requires live systematic-debugging TDD receiving-code-review skills", () => {
    const s = routeFailureToDebugging({ signal: "runtime crash" });
    expect(s.requiredSkills).toContain("systematic-debugging");
    expect(s.requiredSkills).toContain("test-driven-development");
    expect(s.requiredSkills).toContain("receiving-code-review");
  });

  test("happy path: one hypothesis, minimal test pass, regression, fix, verify", () => {
    let s = startDebugging({ signal: "bun test fail", classHint: "test" });
    for (const step of [
      "reproduce",
      "gather_evidence",
      "trace_root_cause",
      "compare_working_patterns",
    ] as const) {
      s = completeStep(s, step);
    }
    s = completeStep(s, "state_hypothesis", {
      hypothesis: "off-by-one in parser",
    });
    s = completeStep(s, "test_minimally", { hypothesisPassed: true });
    expect(mayImplementFix(s)).toBe(false);
    s = completeStep(s, "add_failing_regression");
    expect(mayImplementFix(s)).toBe(true);
    s = completeStep(s, "implement_one_fix");
    s = completeStep(s, "verify");
    expect(s.status).toBe("verified");
  });

  test("after three failed hypotheses stop and ask architectural question", () => {
    let s = startDebugging({ signal: "build failed" });
    for (const step of [
      "reproduce",
      "gather_evidence",
      "trace_root_cause",
      "compare_working_patterns",
    ] as const) {
      s = completeStep(s, step);
    }
    for (let i = 1; i <= MAX_HYPOTHESES; i++) {
      s = completeStep(s, "state_hypothesis", {
        hypothesis: `hypothesis ${i}`,
      });
      s = completeStep(s, "test_minimally", { hypothesisPassed: false });
      if (s.status === "escalated") break;
    }
    expect(s.status).toBe("escalated");
    expect(s.architecturalQuestion).toMatch(/architectur/i);
    expect(failedHypothesisCount(s)).toBe(MAX_HYPOTHESES);
    expect(() => completeStep(s, "add_failing_regression")).toThrow(
      /escalated|cannot complete/,
    );
  });

  test("empty signal rejected", () => {
    expect(() => startDebugging({ signal: "  " })).toThrow(DebuggingError);
  });
});
