import { describe, expect, test } from "bun:test";
import {
  BUNDLED_OMP_OUTSIDE_HARNESS_SPAWN,
  FORBIDDEN_AUTO_PATHS,
  HARNESS_SPAWN_ALLOWLIST,
  assertNoForbiddenAutoPath,
  attachOptionalToManifest,
  evaluateAdvisor,
  evaluateBrowser,
  evaluateCheckpointRewind,
  evaluateCollab,
  evaluateHubJobSupervision,
  evaluateOptionalCapability,
  isForbiddenAutoPath,
  isHarnessSpawnAllowed,
  isSonicEligibleForGate,
  OptionalCapabilityError,
} from "../extensions/goal-harness/optional-capabilities";

describe("Advisor", () => {
  test("one read-only pass only when explicitly requested for difficult Spec/Plan", () => {
    expect(
      evaluateAdvisor({
        capability: "advisor",
        explicit: false,
        context: { difficultSpecOrPlan: true, phase: "Spec" },
      }).allow,
    ).toBe(false);
    expect(
      evaluateAdvisor({
        capability: "advisor",
        explicit: true,
        context: { difficultSpecOrPlan: false, phase: "Spec" },
      }).allow,
    ).toBe(false);
    const ok = evaluateAdvisor({
      capability: "advisor",
      explicit: true,
      context: { difficultSpecOrPlan: true, phase: "Plan" },
    });
    expect(ok.allow).toBe(true);
    expect(ok.mayAdvanceGate).toBe(false);
  });

  test("Advisor never advances a gate", () => {
    const d = evaluateOptionalCapability({
      capability: "advisor",
      explicit: true,
      context: { difficultSpecOrPlan: true, phase: "Spec" },
    });
    expect(d.mayAdvanceGate).toBe(false);
  });
});

describe("checkpoint/rewind browser collab hub", () => {
  test("checkpoint/rewind: explicit exploratory spike only", () => {
    expect(
      evaluateCheckpointRewind({
        capability: "checkpoint-rewind",
        explicit: true,
        context: { exploratorySpike: false },
      }).allow,
    ).toBe(false);
    expect(
      evaluateCheckpointRewind({
        capability: "checkpoint-rewind",
        explicit: true,
        context: { exploratorySpike: true },
      }).allow,
    ).toBe(true);
  });

  test("browser: explicit live UI/JS-only need", () => {
    expect(
      evaluateBrowser({
        capability: "browser",
        explicit: true,
        context: { liveUiOrJsOnly: false },
      }).allow,
    ).toBe(false);
    expect(
      evaluateBrowser({
        capability: "browser",
        explicit: true,
        context: { liveUiOrJsOnly: true },
      }).allow,
    ).toBe(true);
  });

  test("Collab: manual human pairing only", () => {
    expect(
      evaluateCollab({
        capability: "collab",
        explicit: true,
        context: { manualHumanPairing: false },
      }).allow,
    ).toBe(false);
    expect(
      evaluateCollab({
        capability: "collab",
        explicit: true,
        context: { manualHumanPairing: true },
      }).allow,
    ).toBe(true);
  });

  test("hub/job supervision only harness-marked long-running worker", () => {
    expect(
      evaluateHubJobSupervision({
        capability: "hub-job-supervision",
        explicit: true,
        context: { harnessMarkedLongRunningWorker: false },
      }).allow,
    ).toBe(false);
    expect(
      evaluateHubJobSupervision({
        capability: "hub-job-supervision",
        explicit: true,
        context: { harnessMarkedLongRunningWorker: true },
      }).allow,
    ).toBe(true);
  });
});

describe("spawn allowlist and forbidden autos", () => {
  test("bundled scout designer reviewer librarian task sonic outside harness spawn", () => {
    for (const role of BUNDLED_OMP_OUTSIDE_HARNESS_SPAWN) {
      expect(isHarnessSpawnAllowed(role)).toBe(false);
    }
    expect(isHarnessSpawnAllowed("implementer")).toBe(true);
    expect(isHarnessSpawnAllowed("spec-writer")).toBe(true);
    expect(HARNESS_SPAWN_ALLOWLIST).toContain("implementer");
  });

  test("sonic is never eligible for implementation/review gates", () => {
    expect(isSonicEligibleForGate("sonic", "Implement")).toBe(false);
    expect(isSonicEligibleForGate("sonic", "review")).toBe(false);
    expect(isSonicEligibleForGate("implementer", "Implement")).toBe(true);
  });

  test("no Swarm Taskplane automatic Collab memory TODO Autolearn can become active", () => {
    for (const p of FORBIDDEN_AUTO_PATHS) {
      expect(isForbiddenAutoPath(p)).toBe(true);
      expect(() => assertNoForbiddenAutoPath(p)).toThrow(
        OptionalCapabilityError,
      );
    }
    expect(isForbiddenAutoPath("tokensave")).toBe(false);
    expect(() => assertNoForbiddenAutoPath("tokensave")).not.toThrow();
  });

  test("attach accepted optional caps to phase manifest notes", () => {
    const accepted = [
      evaluateAdvisor({
        capability: "advisor",
        explicit: true,
        context: { difficultSpecOrPlan: true, phase: "Spec" },
      }),
      evaluateBrowser({
        capability: "browser",
        explicit: false,
      }),
    ];
    const notes = attachOptionalToManifest(accepted);
    expect(notes).toContain("optional:advisor");
    expect(notes).not.toContain("optional:browser");
  });
});
