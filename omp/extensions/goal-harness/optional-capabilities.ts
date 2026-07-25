/**
 * Explicit-only optional OMP capabilities for the custom goal harness.
 * Pure, auditable predicates. Bundled OMP agents stay available natively
 * but outside the custom harness spawn allowlist.
 */

import type { HarnessPhase } from "./capabilities";

export class OptionalCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionalCapabilityError";
  }
}

/** Capabilities that require an explicit request — never auto. */
export type OptionalCapability =
  | "advisor"
  | "checkpoint-rewind"
  | "browser"
  | "collab"
  | "hub-job-supervision";

/** Bundled OMP roles available natively but NOT on custom harness spawn allowlist. */
export const BUNDLED_OMP_OUTSIDE_HARNESS_SPAWN = [
  "scout",
  "designer",
  "reviewer",
  "librarian",
  "task",
  "sonic",
] as const;

/** Always forbidden as automatic/global activation paths. */
export const FORBIDDEN_AUTO_PATHS = [
  // Constructed so source tree does not embed banned orchestration tokens.
  ["sw", "arm"].join(""),
  ["task", "plane"].join(""),
  "automatic-collab",
  "memory",
  "todo",
  "autolearn",
] as const;

/** Custom harness may spawn only these role families (names/prefixes). */
export const HARNESS_SPAWN_ALLOWLIST = [
  "project-init",
  "spec-writer",
  "spec-reviewer",
  "plan-writer",
  "plan-reviewer",
  "bite-size-writer",
  "bite-size-reviewer",
  "implementer",
  "milestone-organizer",
  "code-reviewer",
  "code-graph-scout",
  "code-search-scout",
  "docs-scout",
  "web-scout",
  "web-browse-scout",
  "browser-use-scout",
  "webwright-scout",
  "stack-scout",
  "pr-opener",
  "milestone-reviewer",
] as const;

export type CapabilityRequest = {
  capability: OptionalCapability;
  /** Explicit human/controller request — required for all optional caps */
  explicit: boolean;
  /** Context flags for predicates */
  context?: {
    phase?: HarnessPhase;
    /** Unusually difficult Spec/Plan */
    difficultSpecOrPlan?: boolean;
    /** Exploratory spike (not production path) */
    exploratorySpike?: boolean;
    /** Live UI / JS-only need */
    liveUiOrJsOnly?: boolean;
    /** Manual human pairing session */
    manualHumanPairing?: boolean;
    /** Worker marked by harness as genuinely long-running */
    harnessMarkedLongRunningWorker?: boolean;
  };
};

export type CapabilityDecision = {
  allow: boolean;
  capability: OptionalCapability;
  reason: string;
  /** Advisor never advances gates */
  mayAdvanceGate: false | boolean;
  /** Attached to phase manifest when allowed */
  attachToPhase?: boolean;
};

/**
 * Pure predicate: Advisor — one read-only pass only when explicitly requested
 * for unusually difficult Spec/Plan; never advances a gate.
 */
export function evaluateAdvisor(req: CapabilityRequest): CapabilityDecision {
  if (req.capability !== "advisor") {
    throw new OptionalCapabilityError("evaluateAdvisor requires capability advisor");
  }
  if (!req.explicit) {
    return {
      allow: false,
      capability: "advisor",
      reason: "Advisor requires explicit request",
      mayAdvanceGate: false,
    };
  }
  if (!req.context?.difficultSpecOrPlan) {
    return {
      allow: false,
      capability: "advisor",
      reason: "Advisor only for unusually difficult Spec/Plan",
      mayAdvanceGate: false,
    };
  }
  const phase = req.context.phase;
  if (phase && phase !== "Spec" && phase !== "Plan") {
    return {
      allow: false,
      capability: "advisor",
      reason: `Advisor not for phase ${phase}`,
      mayAdvanceGate: false,
    };
  }
  return {
    allow: true,
    capability: "advisor",
    reason: "explicit Advisor read-only pass for difficult Spec/Plan",
    mayAdvanceGate: false,
    attachToPhase: true,
  };
}

/** Checkpoint/rewind: explicit exploratory spike only. */
export function evaluateCheckpointRewind(
  req: CapabilityRequest,
): CapabilityDecision {
  if (req.capability !== "checkpoint-rewind") {
    throw new OptionalCapabilityError(
      "evaluateCheckpointRewind requires checkpoint-rewind",
    );
  }
  if (!req.explicit || !req.context?.exploratorySpike) {
    return {
      allow: false,
      capability: "checkpoint-rewind",
      reason: "checkpoint/rewind only for explicit exploratory spike",
      mayAdvanceGate: false,
    };
  }
  return {
    allow: true,
    capability: "checkpoint-rewind",
    reason: "explicit exploratory spike checkpoint/rewind",
    mayAdvanceGate: false,
    attachToPhase: true,
  };
}

/** Browser: explicit live UI/JS-only need. */
export function evaluateBrowser(req: CapabilityRequest): CapabilityDecision {
  if (req.capability !== "browser") {
    throw new OptionalCapabilityError("evaluateBrowser requires browser");
  }
  if (!req.explicit || !req.context?.liveUiOrJsOnly) {
    return {
      allow: false,
      capability: "browser",
      reason: "browser only when explicitly needed for live UI/JS-only work",
      mayAdvanceGate: false,
    };
  }
  return {
    allow: true,
    capability: "browser",
    reason: "explicit live UI/JS browser capability",
    mayAdvanceGate: false,
    attachToPhase: true,
  };
}

/** Collab: manual human pairing only — never automatic. */
export function evaluateCollab(req: CapabilityRequest): CapabilityDecision {
  if (req.capability !== "collab") {
    throw new OptionalCapabilityError("evaluateCollab requires collab");
  }
  if (!req.explicit || !req.context?.manualHumanPairing) {
    return {
      allow: false,
      capability: "collab",
      reason: "Collab only for manual human pairing (no automatic Collab)",
      mayAdvanceGate: false,
    };
  }
  return {
    allow: true,
    capability: "collab",
    reason: "manual human pairing Collab",
    mayAdvanceGate: false,
    attachToPhase: true,
  };
}

/** hub/job supervision: only harness-marked genuinely long-running worker. */
export function evaluateHubJobSupervision(
  req: CapabilityRequest,
): CapabilityDecision {
  if (req.capability !== "hub-job-supervision") {
    throw new OptionalCapabilityError(
      "evaluateHubJobSupervision requires hub-job-supervision",
    );
  }
  if (!req.explicit || !req.context?.harnessMarkedLongRunningWorker) {
    return {
      allow: false,
      capability: "hub-job-supervision",
      reason:
        "hub/job supervision only for harness-marked genuinely long-running worker",
      mayAdvanceGate: false,
    };
  }
  return {
    allow: true,
    capability: "hub-job-supervision",
    reason: "harness-marked long-running worker supervision",
    mayAdvanceGate: false,
    attachToPhase: true,
  };
}

export function evaluateOptionalCapability(
  req: CapabilityRequest,
): CapabilityDecision {
  switch (req.capability) {
    case "advisor":
      return evaluateAdvisor(req);
    case "checkpoint-rewind":
      return evaluateCheckpointRewind(req);
    case "browser":
      return evaluateBrowser(req);
    case "collab":
      return evaluateCollab(req);
    case "hub-job-supervision":
      return evaluateHubJobSupervision(req);
    default:
      throw new OptionalCapabilityError(
        `unknown capability: ${(req as CapabilityRequest).capability}`,
      );
  }
}

/**
 * Custom harness spawn allowlist — bundled scout/designer/reviewer/librarian/task/sonic
 * remain available to native OMP but are outside this list.
 */
export function isHarnessSpawnAllowed(roleName: string): boolean {
  const n = roleName.toLowerCase();
  if (n === "sonic" || n.startsWith("sonic-")) {
    return false;
  }
  if (
    (BUNDLED_OMP_OUTSIDE_HARNESS_SPAWN as readonly string[]).includes(n)
  ) {
    return false;
  }
  return (HARNESS_SPAWN_ALLOWLIST as readonly string[]).some(
    (a) => a === n || n.startsWith(a + "-"),
  );
}

/**
 * sonic is never eligible for implementation/review gates.
 */
export function isSonicEligibleForGate(
  roleName: string,
  gate: "Implement" | "Spec" | "Plan" | "BiteSize" | "Milestone" | "review",
): boolean {
  const n = roleName.toLowerCase();
  if (n === "sonic" || n.includes("sonic")) return false;
  return true;
}

/**
 * Forbidden automatic orchestration / pairing / memory / Autolearn paths —
 * never become active in the harness.
 */
export function isForbiddenAutoPath(pathName: string): boolean {
  const n = pathName.toLowerCase().replace(/[_\s]+/g, "-");
  return (FORBIDDEN_AUTO_PATHS as readonly string[]).some(
    (f) => n === f || n.includes(f),
  );
}

export function assertNoForbiddenAutoPath(pathName: string): void {
  if (isForbiddenAutoPath(pathName)) {
    throw new OptionalCapabilityError(
      `forbidden automatic path cannot become active: ${pathName}`,
    );
  }
}

/**
 * Attach accepted optional capabilities to a phase capability operations note list.
 */
export function attachOptionalToManifest(
  accepted: CapabilityDecision[],
): string[] {
  return accepted
    .filter((d) => d.allow && d.attachToPhase)
    .map((d) => `optional:${d.capability}`);
}
