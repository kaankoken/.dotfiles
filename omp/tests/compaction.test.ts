import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ALLOWED_COMPACT_MODES,
  CompactionPolicyError,
  FORBIDDEN_ONE_OFF_MODES,
  GLOBAL_STRATEGY,
  assertGlobalShakeConfig,
  contextFullRecovery,
  evaluateSnapcompactEligibility,
  parseCompactionConfig,
  phaseBoundaryCompact,
  planGlobalShake,
  planSnapcompact,
  runGlobalShake,
  runSelectiveSnapcompact,
  validateCompactModeArg,
  validateResumeSource,
} from "../extensions/goal-harness/compaction";
import {
  assertCompactionContract,
  getHarnessCompactionConfig,
} from "../extensions/goal-harness/index";

const OMP = join(import.meta.dir, "..");

describe("global shake configuration", () => {
  test("global configured strategy is always shake", () => {
    const path = join(OMP, "config.yml");
    expect(existsSync(path)).toBe(true);
    const config = parseYaml(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const cc = parseCompactionConfig(config);
    expect(cc.strategy).toBe("shake");
    expect(cc.strategy).toBe(GLOBAL_STRATEGY);
    assertGlobalShakeConfig(cc);
    // never global snapcompact
    expect(cc.strategy).not.toBe("snapcompact");
  });

  test("assertGlobalShakeConfig rejects non-shake global strategy", () => {
    expect(() =>
      assertGlobalShakeConfig({ enabled: true, strategy: "snapcompact" }),
    ).toThrow(/must be shake/);
    expect(() =>
      assertGlobalShakeConfig({ enabled: false, strategy: "shake" }),
    ).toThrow(/enabled/);
  });

  test("shake can run without a model-selected cut point", async () => {
    const calls: unknown[] = [];
    const ctx = {
      compact: (opts?: { mode?: string }) => {
        calls.push(opts ?? null);
        return { ok: true };
      },
    };
    const plan = planGlobalShake();
    expect(plan).toEqual({ kind: "global-shake" });
    const result = await runGlobalShake(ctx);
    expect(result.ok).toBe(true);
    expect(result.invoked).toBe("ctx.compact()");
    // no mode argument — configured strategy applies
    expect(calls).toEqual([null]);
  });
});

describe("selective snapcompact policy", () => {
  const durableOk = {
    runId: "run-1",
    phase: "Implement",
    evidenceWritten: true,
    nextActionWritten: true,
    beadsSynced: true,
    beadsRereadOk: true,
  };

  test("snapcompact only for long-running coordinator", () => {
    const elig = evaluateSnapcompactEligibility({
      actor: "lane-implementer",
      model: { id: "m", vision: true },
      durable: durableOk,
    });
    expect(elig.ok).toBe(false);
    if (!elig.ok) expect(elig.reason).toMatch(/long-running-coordinator/);
  });

  test("active model must be vision-capable; text-only stays rejection", () => {
    const elig = evaluateSnapcompactEligibility({
      actor: "long-running-coordinator",
      model: { id: "text-only", vision: false },
      durable: durableOk,
    });
    expect(elig.ok).toBe(false);
    if (!elig.ok) expect(elig.reason).toMatch(/vision|text-only/i);

    // no silent reinterpretation as shake
    expect(() =>
      planSnapcompact({
        actor: "long-running-coordinator",
        model: { id: "text-only", vision: false },
        durable: durableOk,
      }),
    ).toThrow(CompactionPolicyError);
  });

  test("requires phase evidence and next action written and re-read from Beads", () => {
    expect(
      evaluateSnapcompactEligibility({
        actor: "long-running-coordinator",
        model: { id: "v", vision: true },
        durable: { ...durableOk, evidenceWritten: false },
      }).ok,
    ).toBe(false);
    expect(
      evaluateSnapcompactEligibility({
        actor: "long-running-coordinator",
        model: { id: "v", vision: true },
        durable: { ...durableOk, nextActionWritten: false },
      }).ok,
    ).toBe(false);
    expect(
      evaluateSnapcompactEligibility({
        actor: "long-running-coordinator",
        model: { id: "v", vision: true },
        durable: { ...durableOk, beadsRereadOk: false },
      }).ok,
    ).toBe(false);
  });

  test("unsynced Beads rejection stays a rejection", async () => {
    const calls: unknown[] = [];
    const ctx = {
      compact: (opts?: { mode?: string }) => {
        calls.push(opts);
      },
    };
    const result = await runSelectiveSnapcompact(ctx, {
      actor: "long-running-coordinator",
      model: { id: "v", vision: true },
      durable: { ...durableOk, beadsSynced: false },
    });
    expect(result.ok).toBe(false);
    expect(result.policyRejected).toBe(true);
    expect(result.reason).toMatch(/unsynced/i);
    // must not invoke compact on reject
    expect(calls).toHaveLength(0);
  });

  test("eligible coordinator+vision invokes only mode snapcompact", async () => {
    const calls: unknown[] = [];
    const ctx = {
      compact: (opts?: { mode?: string }) => {
        calls.push(opts);
      },
    };
    const result = await runSelectiveSnapcompact(ctx, {
      actor: "long-running-coordinator",
      model: { id: "vision-model", vision: true },
      durable: durableOk,
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ mode: "snapcompact" }]);
    expect(result.invoked).toBe('ctx.compact({ mode: "snapcompact" })');
  });
});

describe("CompactMode contract", () => {
  test("CompactMode is exactly soft | remote | snapcompact", () => {
    expect([...ALLOWED_COMPACT_MODES].slice().sort()).toEqual(
      (["remote", "snapcompact", "soft"] as const).slice().sort(),
    );
    expect(validateCompactModeArg("soft")).toBe("soft");
    expect(validateCompactModeArg("remote")).toBe("remote");
    expect(validateCompactModeArg("snapcompact")).toBe("snapcompact");
    expect(validateCompactModeArg(undefined)).toBe("global-default");
  });

  test("never pass shake or handoff as one-off mode", () => {
    expect([...FORBIDDEN_ONE_OFF_MODES]).toEqual(["shake", "handoff"]);
    expect(() => validateCompactModeArg("shake")).toThrow(/forbidden one-off/);
    expect(() => validateCompactModeArg("handoff")).toThrow(/forbidden one-off/);
  });
});

describe("context-full recovery and resume", () => {
  test("context-full recovery cannot turn rejected snapcompact into success", () => {
    const recovery = contextFullRecovery({
      priorSnapcompactRejected: true,
      reason: "text-only model",
    });
    expect(recovery.strategy).toBe("context-full");
    expect(recovery.cannotOverrideSnapcompact).toBe(true);
    // still a separate recovery path — does not clear the rejection
    expect(recovery.ok).toBe(true);
  });

  test("resume reconstructs from Beads/repository not compaction prose", () => {
    expect(() =>
      validateResumeSource({
        fromBeads: false,
        fromRepository: false,
        fromCompactionProse: true,
      }),
    ).toThrow(/not compaction prose/);
    expect(() =>
      validateResumeSource({
        fromBeads: true,
        fromRepository: true,
        fromCompactionProse: false,
      }),
    ).not.toThrow();
    // prose alone with beads is ok as secondary
    expect(() =>
      validateResumeSource({
        fromBeads: true,
        fromRepository: false,
        fromCompactionProse: true,
      }),
    ).not.toThrow();
  });
});

describe("phase boundary protocol", () => {
  test("finish → write Beads → verify → shake → resume from Beads", async () => {
    const order: string[] = [];
    const ctx = {
      compact: () => {
        order.push("compact");
      },
    };
    const result = await phaseBoundaryCompact({
      config: { enabled: true, strategy: "shake" },
      ctx,
      durable: {
        runId: "r",
        phase: "Plan",
        evidenceWritten: false,
        nextActionWritten: false,
        beadsSynced: false,
      },
      actor: "parent-orchestrator",
      model: { id: "m", vision: false },
      preferSnapcompact: false,
      writeAndVerifyBeads: async () => {
        order.push("write-beads");
        return { written: true, rereadOk: true, synced: true };
      },
      resume: {
        fromBeads: true,
        fromRepository: true,
        fromCompactionProse: false,
      },
    });
    expect(order).toEqual(["write-beads", "compact"]);
    expect(result.ok).toBe(true);
    expect(result.invoked).toBe("ctx.compact()");
  });

  test("Beads write failure blocks compaction", async () => {
    await expect(
      phaseBoundaryCompact({
        config: { enabled: true, strategy: "shake" },
        ctx: { compact: () => {} },
        durable: {
          runId: "r",
          phase: "Plan",
          evidenceWritten: false,
          nextActionWritten: false,
          beadsSynced: false,
        },
        actor: "parent-orchestrator",
        model: { id: "m" },
        writeAndVerifyBeads: async () => ({
          written: false,
          rereadOk: false,
          synced: false,
        }),
        resume: {
          fromBeads: true,
          fromRepository: true,
          fromCompactionProse: false,
        },
      }),
    ).rejects.toThrow(/Beads write/);
  });
});

describe("index wiring", () => {
  test("getHarnessCompactionConfig and assertCompactionContract", () => {
    const cfg = getHarnessCompactionConfig();
    expect(cfg.strategy).toBe("shake");
    expect(assertCompactionContract().ok).toBe(true);
  });
});
