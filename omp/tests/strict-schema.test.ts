import { describe, expect, test } from "bun:test";
import {
  validateReviewResult,
  validateImplementerEvidence,
} from "../extensions/goal-harness/validation";

describe("strict schemas", () => {
  test("review-result rejects invalid shapes", () => {
    expect(validateReviewResult({ ok: true, feedback: "x", blocking: [] }).ok).toBe(true);
    expect(validateReviewResult({ ok: false, feedback: "x", blocking: ["a"] }).ok).toBe(true);
    expect(validateReviewResult({ ok: true, feedback: "x" }).ok).toBe(false);
    expect(validateReviewResult({ ok: true, feedback: "x", blocking: [], extra: 1 }).ok).toBe(false);
    expect(validateReviewResult({ ok: true, feedback: "x", blocking: [1] as any }).ok).toBe(false);
    expect(validateReviewResult({ ok: true, feedback: "x", blocking: ["nope"] }).ok).toBe(false);
    expect(validateReviewResult({ ok: false, feedback: "x", blocking: [] }).ok).toBe(false);
  });

  test("implementer-evidence rejects invalid and mismatched facts", () => {
    const git = {
      branch: "feat/x",
      worktreePath: "/wt/x",
      headSha: "abc1234",
      changedFiles: ["a.ts", "b.ts"],
    };
    const beads = { issueId: "nix-setup-dug.12" };
    const good = {
      issueId: "nix-setup-dug.12",
      branch: "feat/x",
      worktreePath: "/wt/x",
      headSha: "abc1234",
      changedFiles: ["a.ts", "b.ts"],
      red: { command: "test", exitCode: 1, summary: "fail" },
      green: { command: "test", exitCode: 0, summary: "pass" },
      notes: "ok",
    };
    expect(validateImplementerEvidence(good, git, beads).ok).toBe(true);
    expect(validateImplementerEvidence({ ...good, headSha: "ZZZ" }, git, beads).ok).toBe(false);
    expect(validateImplementerEvidence({ ...good, changedFiles: ["a.ts", "a.ts"] }, git, beads).ok).toBe(false);
    expect(validateImplementerEvidence({ ...good, changedFiles: [] }, git, beads).ok).toBe(false);
    const noRed = { ...good } as any;
    delete noRed.red;
    expect(validateImplementerEvidence(noRed, git, beads).ok).toBe(false);
    expect(
      validateImplementerEvidence(
        { ...good, branch: "wrong" },
        git,
        beads,
      ).ok,
    ).toBe(false);
    expect(
      validateImplementerEvidence(
        { ...good, green: { command: "t", exitCode: 1, summary: "x" } },
        git,
        beads,
      ).ok,
    ).toBe(false);
  });
});
