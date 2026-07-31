import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PR_REVIEW_TASK_SLOTS,
  type ImmutableSnapshot,
  type SealedTaskResult,
  type SnapshotChangedFile,
} from "../extensions/pr-review/contracts";
import {
  parseUnifiedDiff,
  validateAnchor,
} from "../extensions/pr-review/line-map";
import { PrReviewStateStore } from "../extensions/pr-review/state";
import { writeAllSync } from "../extensions/pr-review/private-files";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const keep = 1;
-old value
+new value
+extra value
 tail value
@@ -10 +11 @@
-old ten
+new eleven
diff --git a/assets/logo.bin b/assets/logo.bin
index 3333333..4444444 100644
Binary files a/assets/logo.bin and b/assets/logo.bin differ
`;

const CHANGED_FILES: readonly SnapshotChangedFile[] = [
  { path: "src/a.ts", status: "modified", patchComplete: true, reviewable: true },
  { path: "assets/logo.bin", status: "binary", patchComplete: true, reviewable: false },
];

describe("captured unified diff line map", () => {
  test("maps deletions to LEFT and additions or visible context to RIGHT", () => {
    const parsed = parseUnifiedDiff(DIFF, CHANGED_FILES);

    expect(parsed.lines).toEqual([
      { path: "src/a.ts", line: 1, side: "RIGHT", hunk: 0 },
      { path: "src/a.ts", line: 2, side: "LEFT", hunk: 0 },
      { path: "src/a.ts", line: 2, side: "RIGHT", hunk: 0 },
      { path: "src/a.ts", line: 3, side: "RIGHT", hunk: 0 },
      { path: "src/a.ts", line: 4, side: "RIGHT", hunk: 0 },
      { path: "src/a.ts", line: 10, side: "LEFT", hunk: 1 },
      { path: "src/a.ts", line: 11, side: "RIGHT", hunk: 1 },
    ]);
    expect(parsed.nonreviewableEntries).toEqual([
      { path: "assets/logo.bin", reason: "binary" },
    ]);
  });

  test("matches Git-quoted UTF-8 paths to canonical changed-file paths", () => {
    const quoted = `diff --git "a/\\303\\251.ts" "b/\\303\\251.ts"
--- "a/\\303\\251.ts"
+++ "b/\\303\\251.ts"
@@ -1 +1 @@
-old
+new
`;
    expect(parseUnifiedDiff(quoted, [{
      path: "é.ts",
      status: "modified",
      patchComplete: true,
      reviewable: true,
    }]).lines).toEqual([
      { path: "é.ts", line: 1, side: "LEFT", hunk: 0 },
      { path: "é.ts", line: 1, side: "RIGHT", hunk: 0 },
    ]);

    const binaryQuoted = `diff --git a/old.bin "b/\\303\\251.bin"
similarity index 100%
rename from old.bin
rename to "\\303\\251.bin"
Binary files a/old.bin and "b/\\303\\251.bin" differ
`;
    expect(parseUnifiedDiff(binaryQuoted, [{
      path: "é.bin",
      status: "binary",
      patchComplete: true,
      reviewable: false,
    }]).nonreviewableEntries).toEqual([
      { path: "é.bin", reason: "binary" },
    ]);
  });

  test("accepts only exact same-side ordered anchors within one hunk", () => {
    const { lines } = parseUnifiedDiff(DIFF, CHANGED_FILES);

    expect(validateAnchor({ path: "src/a.ts", line: 3, side: "RIGHT" }, lines)).toBe(true);
    expect(validateAnchor({
      path: "src/a.ts",
      start_line: 2,
      start_side: "RIGHT",
      line: 4,
      side: "RIGHT",
    }, lines)).toBe(true);

    expect(validateAnchor({ path: "src/a.ts", line: 9, side: "RIGHT" }, lines)).toBe(false);
    expect(validateAnchor({ path: "src/a.ts", line: 11, side: "RIGHT", start_line: 4, start_side: "RIGHT" }, lines)).toBe(false);
    expect(validateAnchor({ path: "src/a.ts", line: 2, side: "LEFT", start_line: 1, start_side: "RIGHT" }, lines)).toBe(false);
    expect(validateAnchor({ path: "src/a.ts", line: 2, side: "RIGHT", start_line: 4, start_side: "RIGHT" }, lines)).toBe(false);
    expect(validateAnchor({ path: "assets/logo.bin", line: 1, side: "RIGHT" }, lines)).toBe(false);
    expect(validateAnchor({ path: "src/a.ts", line: 2, side: "RIGHT", position: 3 } as never, lines)).toBe(false);
    expect(validateAnchor({ path: "src/a.ts", line: 2, side: "RIGHT", start_line: 1 } as never, lines)).toBe(false);
  });

  test("accepts complete empty-file and metadata-only changes without hunks", () => {
    const noHunkDiff = `diff --git a/empty-added.txt b/empty-added.txt
new file mode 100644
index 0000000..e69de29
diff --git a/empty-deleted.txt b/empty-deleted.txt
deleted file mode 100644
index e69de29..0000000
diff --git a/mode-only.sh b/mode-only.sh
old mode 100644
new mode 100755
diff --git a/old-name.txt b/new-name.txt
similarity index 100%
rename from old-name.txt
rename to new-name.txt
`;
    const parsed = parseUnifiedDiff(noHunkDiff, [
      { path: "empty-added.txt", status: "added", patchComplete: true, reviewable: true },
      { path: "empty-deleted.txt", status: "removed", patchComplete: true, reviewable: true },
      { path: "mode-only.sh", status: "modified", patchComplete: true, reviewable: true },
      { path: "new-name.txt", status: "renamed", patchComplete: true, reviewable: true },
    ]);

    expect(parsed.lines).toEqual([]);
    expect(parsed.nonreviewableEntries).toEqual([]);
  });

  test("fails closed on incomplete, truncated, or rename-mismatched patches", () => {
    expect(() => parseUnifiedDiff(DIFF, [
      { ...CHANGED_FILES[0]!, patchComplete: false },
      CHANGED_FILES[1]!,
    ])).toThrow("incomplete patch");

    expect(() => parseUnifiedDiff(DIFF, [
      ...CHANGED_FILES,
      { path: "missing.ts", status: "modified", patchComplete: true, reviewable: true },
    ])).toThrow("missing textual patch");

    const truncated = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
-old
+new
`;
    expect(() => parseUnifiedDiff(truncated, [
      { path: "a.ts", status: "modified", patchComplete: true, reviewable: true },
    ])).toThrow("truncated hunk");

    const renameMismatch = `diff --git a/old.ts b/other.ts
similarity index 100%
rename from old.ts
rename to other.ts
--- a/old.ts
+++ b/other.ts
@@ -1 +1 @@
-old
+new
`;
    expect(() => parseUnifiedDiff(renameMismatch, [
      { path: "new.ts", status: "renamed", patchComplete: true, reviewable: true },
    ])).toThrow("rename mismatch");
  });
});

function sealedResults(
  snapshot: Readonly<ImmutableSnapshot>,
  callNonces: readonly string[],
): SealedTaskResult[] {
  return PR_REVIEW_TASK_SLOTS.map((slot, index) => ({
    slot: slot.name,
    stage: slot.stage,
    name: slot.name,
    agent: slot.agent,
    schemaSha256: `schema-${index}`,
    runNonce: snapshot.runNonce,
    snapshotNonce: snapshot.snapshotNonce,
    callNonce: callNonces[index]!,
    snapshotHandle: snapshot.snapshotHandle,
    headSha: snapshot.headSha,
    diffDigest: snapshot.diffDigest,
    nativeToolCallId: `tool-${index}`,
    nativeResultId: `result-${index}`,
    result: {},
    evidence: {},
    outputDigest: `output-${index}`,
  })) as SealedTaskResult[];
}

describe("private file writes", () => {
  test("writes every byte across short writes and rejects zero progress", () => {
    const bytes = new TextEncoder().encode("short writes still complete");
    const written: number[] = [];
    writeAllSync(bytes, (buffer, offset, length) => {
      const count = Math.min(2, length);
      written.push(...buffer.slice(offset, offset + count));
      return count;
    });
    expect(Uint8Array.from(written)).toEqual(bytes);

    let calls = 0;
    expect(() => writeAllSync(bytes, (_buffer, _offset, length) => {
      calls += 1;
      return calls === 1 ? Math.min(2, length) : 0;
    })).toThrow("no progress");
  });
});

describe("private immutable PR review state", () => {
  test("mints opaque handles, copies state, stores private bytes, and enforces lifecycle", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pr-review-state-"));
    try {
      let allowRemoval = false;
      let removalAttempts = 0;
      const store = new PrReviewStateStore({
        rootDir,
        maxReadBytes: 8,
        removeRunDirectory: (directory) => {
          removalAttempts += 1;
          if (!allowRemoval) throw new Error("simulated unlink failure");
          rmSync(directory, { recursive: true, force: true });
        },
      });
      const run = store.startRun();
      const inputBytes = new TextEncoder().encode("exact captured diff");
      const changedFiles = [{
        path: "a.ts",
        status: "modified",
        patchComplete: true,
        reviewable: true,
      }];
      const snapshot = store.storeSnapshot(run.runHandle, {
        owner: "octo",
        repo: "repo",
        pullNumber: 7,
        repositoryNodeId: "R_1",
        baseSha: "base",
        headSha: "head",
        diffBytes: inputBytes,
        changedFiles,
        lineMap: [{ path: "a.ts", line: 1, side: "RIGHT", hunk: 0 }],
        nonreviewableEntries: [],
      });

      expect(run.runHandle).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(run.runNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(snapshot.snapshotHandle).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(snapshot.snapshotNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(new Set([run.runHandle, run.runNonce, snapshot.snapshotHandle, snapshot.snapshotNonce]).size).toBe(4);
      expect(snapshot.diffDigest).toBe(createHash("sha256").update(inputBytes).digest("hex"));
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.changedFiles)).toBe(true);
      expect(Object.isFrozen(snapshot.changedFiles[0]!)).toBe(true);

      inputBytes[0] = 0;
      changedFiles[0]!.path = "mutated.ts";
      snapshot.diffBytes[0] = 0;
      const fresh = store.lookupSnapshot(snapshot.snapshotHandle);
      expect(new TextDecoder().decode(fresh.diffBytes)).toBe("exact captured diff");
      expect(fresh.changedFiles[0]!.path).toBe("a.ts");
      expect(readFileSync(join(rootDir, run.runHandle, `${snapshot.snapshotHandle}.diff`), "utf8")).toBe("exact captured diff");
      expect(statSync(join(rootDir, run.runHandle)).mode & 0o777).toBe(0o700);
      expect(statSync(join(rootDir, run.runHandle, `${snapshot.snapshotHandle}.diff`)).mode & 0o777).toBe(0o600);

      expect(new TextDecoder().decode(store.readSnapshot(snapshot.snapshotHandle, 6, 8))).toBe("captured");
      expect(() => store.readSnapshot(snapshot.snapshotHandle, 0, 9)).toThrow("bounded");
      expect(() => store.lookupSnapshot("A".repeat(43))).toThrow("unknown snapshot handle");
      expect(() => store.transitionRun(run.runHandle, "judge")).toThrow("illegal stage transition");

      store.transitionRun(run.runHandle, "initial");
      store.transitionRun(run.runHandle, "rebuttal");
      store.transitionRun(run.runHandle, "judge");
      const callNonces = PR_REVIEW_TASK_SLOTS.map((slot) =>
        store.mintCallNonce(run.runHandle, slot.name)
      );
      expect(new Set(callNonces).size).toBe(5);
      expect(callNonces.every((nonce) => /^[A-Za-z0-9_-]{43}$/.test(nonce))).toBe(true);

      const capture = store.completeCapture(run.runHandle, sealedResults(fresh, callNonces));
      expect(capture.captureHandle).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(store.lookupCapture(capture.captureHandle).results).toHaveLength(5);
      expect(() => store.completeCapture(run.runHandle, [] as never)).toThrow("illegal stage transition");

      store.cleanupRun(run.runHandle);
      expect(() => store.getRunStatus(run.runHandle)).toThrow("unknown run handle");
      expect(() => store.lookupSnapshot(snapshot.snapshotHandle)).toThrow("unknown snapshot handle");
      expect(() => store.lookupCapture(capture.captureHandle)).toThrow("unknown capture handle");
      expect(statSync(join(rootDir, run.runHandle)).isDirectory()).toBe(true);
      expect(removalAttempts).toBe(3);

      allowRemoval = true;
      store.retryCleanup();
      expect(removalAttempts).toBe(4);
      expect(() => statSync(join(rootDir, run.runHandle))).toThrow();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("rejects capture records that do not contain the exact bound five slots", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "pr-review-state-"));
    try {
      const store = new PrReviewStateStore({ rootDir });
      const run = store.startRun();
      const snapshot = store.storeSnapshot(run.runHandle, {
        owner: "octo",
        repo: "repo",
        pullNumber: 7,
        repositoryNodeId: "R_1",
        baseSha: "base",
        headSha: "head",
        diffBytes: new TextEncoder().encode("diff"),
        changedFiles: [],
        lineMap: [],
        nonreviewableEntries: [],
      });
      store.transitionRun(run.runHandle, "initial");
      store.transitionRun(run.runHandle, "rebuttal");
      store.transitionRun(run.runHandle, "judge");
      expect(() => store.completeCapture(
        run.runHandle,
        sealedResults(snapshot, Array.from({ length: 5 }, (_, index) => `unminted-${index}`)),
      )).toThrow("unknown call nonce");

      const callNonces = PR_REVIEW_TASK_SLOTS.map((slot) =>
        store.mintCallNonce(run.runHandle, slot.name)
      );
      expect(() => store.mintCallNonce(run.runHandle, PR_REVIEW_TASK_SLOTS[0]!.name)).toThrow("already minted");
      expect(() => store.mintCallNonce(run.runHandle, "pr-review-extra" as never)).toThrow("unknown task slot");

      const swapped = [...callNonces];
      [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
      expect(() => store.completeCapture(
        run.runHandle,
        sealedResults(snapshot, swapped),
      )).toThrow("call nonce slot mismatch");

      const wrong = sealedResults(snapshot, callNonces);
      wrong[4] = { ...wrong[4]!, headSha: "other-head" };
      expect(() => store.completeCapture(run.runHandle, wrong as never)).toThrow("capture binding mismatch");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
