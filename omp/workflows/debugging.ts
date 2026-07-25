/**
 * Systematic debugging workflow for unexpected test/build/runtime failures.
 * Path selected from observed failure class — never model preference.
 * Skills (live read): systematic-debugging, test-driven-development, receiving-code-review.
 * After 3 failed hypotheses → stop and ask architectural question.
 */

export class DebuggingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebuggingError";
  }
}

/** Failure classes that enter the debugging path (observed, not preferred). */
export type FailureClass =
  | "test"
  | "build"
  | "runtime"
  | "typecheck"
  | "lint"
  | "unknown";

export type DebugStep =
  | "reproduce"
  | "gather_evidence"
  | "trace_root_cause"
  | "compare_working_patterns"
  | "state_hypothesis"
  | "test_minimally"
  | "add_failing_regression"
  | "implement_one_fix"
  | "verify"
  | "escalate_human";

/** Exact ordered sequence from plan Task 28 / systematic-debugging. */
export const DEBUG_STEP_ORDER: readonly DebugStep[] = [
  "reproduce",
  "gather_evidence",
  "trace_root_cause",
  "compare_working_patterns",
  "state_hypothesis",
  "test_minimally",
  "add_failing_regression",
  "implement_one_fix",
  "verify",
] as const;

export const MAX_HYPOTHESES = 3;

/** Skills the bug agent must load live (names only — never vendored bodies). */
export const DEBUGGING_REQUIRED_SKILLS = [
  "systematic-debugging",
  "test-driven-development",
  "receiving-code-review",
] as const;

export type HypothesisRecord = {
  id: number;
  statement: string;
  tested: boolean;
  passed: boolean;
  notes?: string;
};

export type DebugSession = {
  failureClass: FailureClass;
  /** Original failure signal that selected this path */
  failureSignal: string;
  stepIndex: number;
  completedSteps: DebugStep[];
  hypotheses: HypothesisRecord[];
  status:
    | "active"
    | "verified"
    | "escalated"
    | "blocked";
  architecturalQuestion?: string;
  requiredSkills: readonly string[];
};

export type FailureObservation = {
  /** Raw signal: test runner output, compiler error, crash, etc. */
  signal: string;
  exitCode?: number;
  command?: string;
  /** Optional explicit class; if omitted, classify from signal */
  classHint?: FailureClass;
};

/**
 * Select debugging path from observed failure class — never model preference.
 */
export function classifyFailure(obs: FailureObservation): FailureClass {
  if (obs.classHint && obs.classHint !== "unknown") {
    return obs.classHint;
  }
  const s = `${obs.signal} ${obs.command ?? ""}`.toLowerCase();
  if (
    /\b(jest|vitest|pytest|cargo test|bun test|xc?test|failing test|assert)\b/.test(
      s,
    ) ||
    (obs.command && /test/.test(obs.command.toLowerCase()))
  ) {
    return "test";
  }
  if (
    /\b(cargo build|compile|linker|undefined reference|build failed|xcodebuild)\b/.test(
      s,
    ) ||
    (obs.command && /build/.test(obs.command.toLowerCase()))
  ) {
    return "build";
  }
  if (
    /\b(tsc|type error|cannot find name|is not assignable)\b/.test(s) ||
    (obs.command && /tsc|typecheck/.test(obs.command.toLowerCase()))
  ) {
    return "typecheck";
  }
  if (/\b(eslint|clippy|lint|warning treated as error)\b/.test(s)) {
    return "lint";
  }
  if (
    /\b(panic|segfault|sigabrt|uncaught|exception|crash|econnrefused|timeout)\b/.test(
      s,
    ) ||
    (obs.exitCode != null && obs.exitCode !== 0 && !/test|build/.test(s))
  ) {
    return "runtime";
  }
  return "unknown";
}

/**
 * Open a debug session from an unexpected failure observation.
 */
export function startDebugging(obs: FailureObservation): DebugSession {
  if (!obs.signal || !obs.signal.trim()) {
    throw new DebuggingError("failure signal required to start debugging");
  }
  const failureClass = classifyFailure(obs);
  return {
    failureClass,
    failureSignal: obs.signal,
    stepIndex: 0,
    completedSteps: [],
    hypotheses: [],
    status: "active",
    requiredSkills: DEBUGGING_REQUIRED_SKILLS,
  };
}

export function currentStep(session: DebugSession): DebugStep | null {
  if (session.status !== "active") return null;
  if (session.stepIndex >= DEBUG_STEP_ORDER.length) return null;
  return DEBUG_STEP_ORDER[session.stepIndex] ?? null;
}

/**
 * Advance only in order. Cannot skip steps.
 */
export function completeStep(
  session: DebugSession,
  step: DebugStep,
  detail?: { hypothesis?: string; hypothesisPassed?: boolean },
): DebugSession {
  if (session.status !== "active") {
    throw new DebuggingError(`session is ${session.status}; cannot complete steps`);
  }
  const expected = currentStep(session);
  if (expected !== step) {
    throw new DebuggingError(
      `out-of-order step: expected ${expected}, got ${step}`,
    );
  }

  let next: DebugSession = {
    ...session,
    completedSteps: [...session.completedSteps, step],
    stepIndex: session.stepIndex + 1,
    hypotheses: [...session.hypotheses],
  };

  if (step === "state_hypothesis") {
    if (!detail?.hypothesis?.trim()) {
      throw new DebuggingError("state_hypothesis requires a hypothesis statement");
    }
    if (next.hypotheses.length >= MAX_HYPOTHESES) {
      return escalateToHuman(
        next,
        "Three hypotheses already recorded; architectural question required",
      );
    }
    next.hypotheses.push({
      id: next.hypotheses.length + 1,
      statement: detail.hypothesis.trim(),
      tested: false,
      passed: false,
    });
  }

  if (step === "test_minimally") {
    const last = next.hypotheses[next.hypotheses.length - 1];
    if (!last) {
      throw new DebuggingError("test_minimally requires a prior hypothesis");
    }
    const passed = Boolean(detail?.hypothesisPassed);
    last.tested = true;
    last.passed = passed;
    if (!passed) {
      // Failed hypothesis: if 3 failed, escalate before continuing to fix
      const failedCount = next.hypotheses.filter(
        (h) => h.tested && !h.passed,
      ).length;
      if (failedCount >= MAX_HYPOTHESES) {
        return escalateToHuman(
          next,
          "Three hypotheses failed; what architectural constraint or design choice should we revisit?",
        );
      }
      // Loop back to state_hypothesis for another attempt (do not advance to regression yet)
      // Remove the remaining steps progress — rewind to after compare_working_patterns
      const rewindTo = DEBUG_STEP_ORDER.indexOf("state_hypothesis");
      next = {
        ...next,
        stepIndex: rewindTo,
        completedSteps: DEBUG_STEP_ORDER.slice(0, rewindTo) as DebugStep[],
        // keep compare_working_patterns completed if we had them
        status: "active",
      };
      // Actually keep earlier steps: reproduce through compare
      const keepThrough = DEBUG_STEP_ORDER.indexOf("compare_working_patterns");
      next.completedSteps = DEBUG_STEP_ORDER.slice(
        0,
        keepThrough + 1,
      ) as DebugStep[];
      next.stepIndex = keepThrough + 1; // state_hypothesis again
      return next;
    }
  }

  if (step === "verify") {
    next = { ...next, status: "verified" };
  }

  return next;
}

export function escalateToHuman(
  session: DebugSession,
  question: string,
): DebugSession {
  return {
    ...session,
    status: "escalated",
    architecturalQuestion: question,
  };
}

export function failedHypothesisCount(session: DebugSession): number {
  return session.hypotheses.filter((h) => h.tested && !h.passed).length;
}

/**
 * Whether harness may apply a production fix: must be at implement_one_fix
 * with a passing minimal test on current hypothesis and a failing regression planned/added.
 */
export function mayImplementFix(session: DebugSession): boolean {
  if (session.status !== "active") return false;
  const step = currentStep(session);
  if (step !== "implement_one_fix") return false;
  const last = session.hypotheses[session.hypotheses.length - 1];
  return Boolean(last?.tested && last.passed);
}

/**
 * Route unexpected failure into debugging — entry point for goal-harness.
 */
export function routeFailureToDebugging(obs: FailureObservation): DebugSession {
  return startDebugging(obs);
}
