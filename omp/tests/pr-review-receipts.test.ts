import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ReceiptJournal } from "../extensions/pr-review/receipts";
import {
  PR_REVIEW_PROTOCOL_VERSION,
  type PrReviewReceiptV1,
} from "../extensions/pr-review/contracts";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readReceipt(path: string): PrReviewReceiptV1 {
  return JSON.parse(readFileSync(path, "utf8")) as PrReviewReceiptV1;
}

function startJournal(rootDir: string, provisionalId = "attempt-1"): ReceiptJournal {
  return ReceiptJournal.start({
    rootDir,
    provisionalId,
    owner: "octo",
    repo: "repo",
    pullNumber: 7,
    roleManifestDigest: digest("manifest"),
    now: () => "2026-07-31T12:00:00.000Z",
  });
}

describe("early private receipt journal", () => {
  test("durably starts unresolved, then atomically promotes to the known head", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wf7-receipts-"));
    try {
      const journal = startJournal(rootDir);
      const provisionalPath = join(rootDir, "octo", "repo", "7", "unresolved-attempt-1.json");

      expect(journal.receiptPath).toBe(provisionalPath);
      expect(readReceipt(provisionalPath)).toMatchObject({
        status: "prepared",
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        roles: [],
        tasks: [],
        mutation_guard_active: false,
      });
      expect(readReceipt(provisionalPath).run_key).toBeUndefined();
      for (const directory of [
        rootDir,
        join(rootDir, "octo"),
        join(rootDir, "octo", "repo"),
        dirname(provisionalPath),
      ]) {
        expect(statSync(directory).mode & 0o777).toBe(0o700);
      }
      expect(statSync(provisionalPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(dirname(provisionalPath)).some((name) => name.includes(".tmp-"))).toBe(false);

      const headPath = journal.promoteToHead({
        base_sha: "base",
        head_sha: "abc123",
        snapshot_digest: digest("snapshot"),
        diff_digest: digest("diff"),
        authenticated_actor: "octocat",
        repositoryNodeId: "R_node",
      });

      expect(headPath).toBe(join(rootDir, "octo", "repo", "7", "abc123-attempt-1.json"));
      expect(journal.receiptPath).toBe(headPath);
      expect(existsSync(provisionalPath)).toBe(false);
      expect(readReceipt(headPath)).toMatchObject({
        head_sha: "abc123",
        base_sha: "base",
        run_key: digest(JSON.stringify([PR_REVIEW_PROTOCOL_VERSION, "R_node", 7, "abc123"])),
        snapshot_digest: digest("snapshot"),
        diff_digest: digest("diff"),
      });

      const renamedTarget = ReceiptJournal.start({
        rootDir,
        provisionalId: "renamed-target",
        owner: "renamed-owner",
        repo: "renamed-repo",
        pullNumber: 7,
        roleManifestDigest: digest("manifest"),
      });
      renamedTarget.promoteToHead({ head_sha: "abc123", repositoryNodeId: "R_node" });
      expect(readReceipt(renamedTarget.receiptPath).run_key).toBe(readReceipt(headPath).run_key);

      const changedNode = ReceiptJournal.start({
        rootDir,
        provisionalId: "changed-node",
        owner: "node-owner",
        repo: "repo",
        pullNumber: 7,
        roleManifestDigest: digest("manifest"),
      });
      changedNode.promoteToHead({ head_sha: "abc123", repositoryNodeId: "R_other" });
      expect(readReceipt(changedNode.receiptPath).run_key).not.toBe(readReceipt(headPath).run_key);
      expect(readReceipt(headPath).run_key).not.toBe(
        digest(JSON.stringify([PR_REVIEW_PROTOCOL_VERSION + 1, "R_node", 7, "abc123"])),
      );
      expect(statSync(headPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(dirname(headPath)).some((name) => name.includes(".tmp-"))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("records redacted terminal failure before any capture handle exists", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wf7-receipts-"));
    try {
      const journal = startJournal(rootDir);
      journal.fail(
        "auth_failed",
        "Bearer ghp_supersecret token=top-secret capture_handle=raw-capture nonce=raw-nonce AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc",
        {
          auth_token: "must-not-persist",
          full_diff: "private diff",
          findings: [{ body: "private finding" }],
          capture_handle: "raw-capture",
        } as never,
      );

      const raw = readFileSync(journal.receiptPath, "utf8");
      const receipt = JSON.parse(raw) as PrReviewReceiptV1;
      expect(receipt.status).toBe("failed");
      expect(receipt.failure_code).toBe("auth_failed");
      expect(receipt.failure_message).toContain("[REDACTED]");
      for (const forbidden of [
        "ghp_supersecret",
        "top-secret",
        "raw-capture",
        "raw-nonce",
        "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc",
        "must-not-persist",
        "private diff",
        "private finding",
        "capture_handle",
        "auth_token",
        "full_diff",
        "findings",
      ]) {
        expect(raw).not.toContain(forbidden);
      }
      expect("captureHandle" in journal).toBe(false);
      expect(() => journal.prepare({ payload_digest: "late" })).toThrow("terminal receipt");
      expect(() => journal.publish({ github_review_id: 1 })).toThrow("terminal receipt");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("requires head promotion for publication terminal states", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wf7-receipts-"));
    try {
      const dryRun = startJournal(rootDir, "unresolved-dry");
      expect(() => dryRun.dryRun()).toThrow("head promotion required");
      expect(readReceipt(dryRun.receiptPath).status).toBe("prepared");

      const published = startJournal(rootDir, "unresolved-publish");
      expect(() => published.publish()).toThrow("head promotion required");
      expect(readReceipt(published.receiptPath).status).toBe("prepared");

      const indeterminate = startJournal(rootDir, "unresolved-indeterminate");
      expect(() => indeterminate.indeterminate(
        "publication_indeterminate",
        "ambiguous response",
      )).toThrow("head promotion required");
      expect(readReceipt(indeterminate.receiptPath).status).toBe("prepared");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("uses atomic redacted prepare, dry-run, publish, and indeterminate transitions", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wf7-receipts-"));
    try {
      const prepared = startJournal(rootDir, "prepared");
      prepared.promoteToHead({ head_sha: "head-prepared", repositoryNodeId: "R_node", base_sha: "base" });
      prepared.prepare({
        payload_digest: digest("payload"),
        completed_capture_digest: digest("capture"),
        event: "COMMENT",
        roles: [{
          agent: "wf7-fable-reviewer",
          livePath: "/safe/role.md",
          preCallValid: true,
          raw_nonce: "nested-raw-nonce",
        }],
        capture_handle: "raw-handle-must-not-persist",
      } as never);
      expect(readReceipt(prepared.receiptPath)).toMatchObject({
        status: "prepared",
        payload_digest: digest("payload"),
        completed_capture_digest: digest("capture"),
        event: "COMMENT",
        roles: [{
          agent: "wf7-fable-reviewer",
          livePath: "/safe/role.md",
          preCallValid: true,
        }],
      });
      const preparedRaw = readFileSync(prepared.receiptPath, "utf8");
      expect(preparedRaw).not.toContain("raw-handle-must-not-persist");
      expect(preparedRaw).not.toContain("nested-raw-nonce");
      expect(preparedRaw).not.toContain("raw_nonce");

      const dryRun = startJournal(rootDir, "dry-run");
      dryRun.promoteToHead({ head_sha: "head-dry-run", repositoryNodeId: "R_node" });
      dryRun.dryRun({ payload_digest: digest("dry-payload"), event: "APPROVE" });
      expect(readReceipt(dryRun.receiptPath)).toMatchObject({
        status: "dry_run",
        payload_digest: digest("dry-payload"),
        event: "APPROVE",
      });

      const published = startJournal(rootDir, "published");
      published.promoteToHead({ head_sha: "head-published", repositoryNodeId: "R_node" });
      published.publish({
        github_review_id: 91,
        github_inline_comment_ids: [92, 93],
        github_inline_comment_markers: ["marker-1", "marker-2"],
        post_publish_head_sha: "head-published",
        published_on_superseded_head: false,
      });
      expect(readReceipt(published.receiptPath)).toMatchObject({
        status: "published",
        github_review_id: 91,
        github_inline_comment_ids: [92, 93],
      });

      const indeterminate = startJournal(rootDir, "indeterminate");
      indeterminate.promoteToHead({ head_sha: "head-indeterminate", repositoryNodeId: "R_node" });
      indeterminate.indeterminate("publication_indeterminate", "timeout token=secret-value");
      const uncertain = readReceipt(indeterminate.receiptPath);
      expect(uncertain.status).toBe("indeterminate");
      expect(uncertain.failure_code).toBe("publication_indeterminate");
      expect(uncertain.failure_message).not.toContain("secret-value");

      for (const journal of [prepared, dryRun, published, indeterminate]) {
        expect(statSync(journal.receiptPath).mode & 0o777).toBe(0o600);
        expect(readdirSync(dirname(journal.receiptPath)).some((name) => name.includes(".tmp-"))).toBe(false);
      }
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("versions same-head attempts without clobbering prior evidence", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wf7-receipts-"));
    try {
      expect(() => startJournal(rootDir, "../escape")).toThrow("invalid provisional id");
      const first = startJournal(rootDir, "first");
      const firstPath = first.promoteToHead({ head_sha: "same-head", repositoryNodeId: "R_node" });
      first.publish({ github_review_id: 91 });
      const firstReceipt = readReceipt(firstPath);
      expect(() => first.promoteToHead({
        head_sha: "other-head",
        repositoryNodeId: "R_node",
      })).toThrow("terminal receipt");

      const second = startJournal(rootDir, "second");
      const secondPath = second.promoteToHead({
        head_sha: "same-head",
        repositoryNodeId: "R_node",
      });

      expect(firstPath).toBe(join(rootDir, "octo", "repo", "7", "same-head-attempt-1.json"));
      expect(secondPath).toBe(join(rootDir, "octo", "repo", "7", "same-head-attempt-2.json"));
      expect(readReceipt(firstPath)).toEqual(firstReceipt);
      expect(readReceipt(secondPath)).toMatchObject({
        status: "prepared",
        run_key: firstReceipt.run_key,
      });
      expect(() => second.prepare({ head_sha: "other-head" })).toThrow("head sha is immutable");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("rejects raw handles or noncanonical values in every digest authority field", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wf7-receipts-"));
    const rawHandle = "A".repeat(43);
    const rawNonce = "B".repeat(43);
    try {
      expect(() => ReceiptJournal.start({
        rootDir,
        provisionalId: "bad-manifest",
        owner: "octo",
        repo: "repo",
        pullNumber: 7,
        roleManifestDigest: rawHandle,
      })).toThrow("canonical SHA-256");

      const journal = startJournal(rootDir, "digest-guard");
      expect(() => journal.promoteToHead({
        head_sha: "head-digest",
        repositoryNodeId: "R_node",
        snapshot_digest: rawHandle,
      })).toThrow("canonical SHA-256");
      expect(readFileSync(journal.receiptPath, "utf8")).not.toContain(rawHandle);

      journal.promoteToHead({
        head_sha: "head-digest",
        repositoryNodeId: "R_node",
        snapshot_digest: digest("snapshot"),
        diff_digest: digest("diff"),
      });
      expect(() => journal.prepare({ completed_capture_digest: rawHandle })).toThrow("canonical SHA-256");
      expect(() => journal.prepare({
        tasks: [{
          stage: "initial",
          task: "wf7-fable-initial",
          agent: "wf7-fable-reviewer",
          nonceDigest: rawNonce,
          nativeToolCallId: "tool",
          nativeResultId: "result",
          agentSource: "user",
          requestedModel: "anthropic/claude-fable-5:max",
          resolvedModel: "anthropic/claude-fable-5:max",
          resolvedModelIsFallback: false,
          schemaSha256: digest("schema"),
          structuredOutputSource: "caller",
          structuredOutputMode: "strict",
          structuredOutputStatus: "valid",
          outputDigest: digest("output"),
        }],
      })).toThrow("canonical SHA-256");
      expect(readFileSync(journal.receiptPath, "utf8")).not.toContain(rawNonce);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
