import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrReviewReceiptV1 } from "../extensions/pr-review/contracts";
import {
  defaultPrReviewExec,
  type PrReviewExec,
  type PrReviewExecOptions,
} from "../extensions/pr-review/github";
import { RoleIntegrityError } from "../extensions/pr-review/role-integrity";
import { PrReviewStateStore } from "../extensions/pr-review/state";
import {
  createPrReviewSnapshotTool,
  PrReviewSnapshotError,
} from "../extensions/pr-review/snapshot-tool";
import {
  parsePrReviewTarget,
  parseRemoteRepository,
  resolvePrReviewTarget,
} from "../extensions/pr-review/target";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function receipts(root: string): PrReviewReceiptV1[] {
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".json")) paths.push(path);
    }
  };
  visit(root);
  return paths.map((path) => JSON.parse(readFileSync(path, "utf8")) as PrReviewReceiptV1);
}

interface ExecReply {
  exitCode: number;
  stdout: string | Uint8Array;
  stderr: string;
}

function ok(value: unknown): ExecReply {
  return {
    exitCode: 0,
    stdout: typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value),
    stderr: "",
  };
}

function fixtureFiles(count = 101): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return {
        filename: "src/renamed.ts",
        previous_filename: "src/old.ts",
        status: "renamed",
        patch: "@@ -1 +1 @@\n-old\n+new",
      };
    }
    if (index === 1) return { filename: "assets/logo.bin", status: "modified" };
    return {
      filename: `src/file-${index}.ts`,
      status: "modified",
      patch: "@@ -1 +1 @@\n-old\n+new",
    };
  });
}

function fixtureDiff(files: Array<Record<string, unknown>>): string {
  return files.map((file, index) => {
    const path = String(file.filename);
    if (index === 0) {
      return [
        "diff --git a/src/old.ts b/src/renamed.ts",
        "similarity index 80%",
        "rename from src/old.ts",
        "rename to src/renamed.ts",
        "--- a/src/old.ts",
        "+++ b/src/renamed.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n");
    }
    if (index === 1) {
      return [
        `diff --git a/${path} b/${path}`,
        `Binary files a/${path} and b/${path} differ`,
      ].join("\n");
    }
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
  }).join("\n") + "\n";
}

function pull(head = "head123", state = "open", changedFiles = 101): Record<string, unknown> {
  return {
    state,
    draft: true,
    merged: false,
    changed_files: changedFiles,
    base: { sha: "base123", repo: { full_name: "octo/repo" } },
    head: {
      sha: head,
      repo: { full_name: "contributor/fork", fork: false },
    },
  };
}

interface FakeGithub {
  exec: PrReviewExec;
  calls: string[][];
  options: PrReviewExecOptions[];
}

function fakeGithub(
  files: Array<Record<string, unknown>>,
  diff: string | Uint8Array,
  options: { actorFailure?: boolean; actorError?: string; state?: string; stale?: boolean } = {},
): FakeGithub {
  const calls: string[][] = [];
  const execOptions: PrReviewExecOptions[] = [];
  let pullReads = 0;
  const exec: PrReviewExec = async (argv, callOptions = {}) => {
    execOptions.push(callOptions);
    const call = [...argv];
    calls.push(call);
    if (call[0] === "git") return ok("git@github.com:octo/repo.git\n");
    const endpoint = call.at(-1)!;
    if (endpoint === "user") {
      if (options.actorFailure || options.actorError) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: options.actorError ?? "HTTP 401 token=github_pat_SUPERSECRET",
        };
      }
      return ok({ login: "octocat", id: 42 });
    }
    if (endpoint === "repos/octo/repo") {
      return ok({ id: 9, node_id: "R_node", full_name: "octo/repo", permissions: { pull: true } });
    }
    if (endpoint === "repos/octo/repo/pulls/7" && call.some((arg) => arg.includes("application/vnd.github.v3.diff"))) {
      return ok(diff);
    }
    if (endpoint === "repos/octo/repo/pulls/7") {
      pullReads += 1;
      return ok(pull(options.stale && pullReads > 1 ? "new-head" : "head123", options.state, files.length));
    }
    if (endpoint === "repos/octo/repo/pulls/7/files?per_page=100&page=1") return ok(files.slice(0, 100));
    if (endpoint === "repos/octo/repo/pulls/7/files?per_page=100&page=2") return ok(files.slice(100));
    throw new Error(`unexpected argv ${JSON.stringify(call)}`);
  };
  return { exec, calls, options: execOptions };
}

function toolFixture(
  github: FakeGithub,
  options: {
    maxDiffBytes?: number;
    checkRoles?: () => never;
    loadManifest?: () => { version: 1; digest: string; roles: [] };
  } = {},
) {
  const root = tempRoot("wf7-snapshot-tool-");
  const targetDir = join(root, "target");
  const receiptRootDir = join(root, "receipts");
  const state = new PrReviewStateStore({ rootDir: join(root, "state"), maxReadBytes: 64 });
  const tool = createPrReviewSnapshotTool({
    cwd: targetDir,
    exec: github.exec,
    state,
    receiptRootDir,
    maxDiffBytes: options.maxDiffBytes,
    loadManifest: options.loadManifest ?? (() => ({ version: 1, digest: digest("manifest"), roles: [] })),
    checkRoles: options.checkRoles ?? (() => []),
    provisionalId: () => "attempt-1",
    now: () => "2026-07-31T12:00:00.000Z",
  });
  return { root, targetDir, receiptRootDir, state, tool };
}

async function expectFailure(
  promise: Promise<unknown>,
  code: string,
): Promise<PrReviewSnapshotError> {
  try {
    await promise;
    throw new Error("expected snapshot failure");
  } catch (error) {
    expect(error).toBeInstanceOf(PrReviewSnapshotError);
    expect((error as PrReviewSnapshotError).code).toBe(code);
    return error as PrReviewSnapshotError;
  }
}

describe("PR target resolution", () => {
  test("accepts exact URL and owner/repo targets", () => {
    expect(parsePrReviewTarget("https://github.com/Octo/Repo/pull/17")).toEqual({
      kind: "explicit", owner: "Octo", repo: "Repo", pullNumber: 17,
    });
    expect(parsePrReviewTarget("octo/repo#17")).toEqual({
      kind: "explicit", owner: "octo", repo: "repo", pullNumber: 17,
    });
    expect(() => parsePrReviewTarget("https://evil.example/octo/repo/pull/17")).toThrow();
    expect(() => parsePrReviewTarget("octo/repo#0")).toThrow();
    expect(() => parsePrReviewTarget("octo/.#7")).toThrow();
    expect(() => parsePrReviewTarget("octo/..#7")).toThrow();
  });

  test("bare numbers require authenticated repository and remote agreement", () => {
    const bare = parsePrReviewTarget("17");
    const remote = parseRemoteRepository("git@github.com:octo/repo.git");
    expect(resolvePrReviewTarget(bare, remote, { owner: "Octo", repo: "Repo", nodeId: "R_1" })).toEqual({
      owner: "octo", repo: "repo", pullNumber: 17,
    });
    expect(() => resolvePrReviewTarget(bare, remote, { owner: "other", repo: "repo", nodeId: "R_2" })).toThrow();
    expect(() => parseRemoteRepository("https://gitlab.com/octo/repo.git")).toThrow();
  });
});

describe("default PR review executor", () => {
  test("preserves maxBuffer overflow evidence from execFile", async () => {
    const result = await defaultPrReviewExec(
      [process.execPath, "-e", "process.stderr.write('warning');process.stdout.write('x'.repeat(1024))"],
      { maxBufferBytes: 8 },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/maxBuffer|stdout.*exceeded/i);
    expect(result.stderr).toContain("warning");
  });

  test("forces an abort-resistant argv child closed without a survivor", async () => {
    const root = tempRoot("wf7-exec-abort-");
    const pidPath = join(root, "pid");
    const termPath = join(root, "sigterm");
    const escapedPath = join(root, "escaped");
    const watcher = watch(root);
    const ready = once(watcher, "change");
    const controller = new AbortController();
    // Platform integration: child timer is a RED escape hatch for broken forced termination.
    const pending = defaultPrReviewExec([
      process.execPath,
      "-e",
      "const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>fs.writeFileSync(process.argv[2],'SIGTERM'));setTimeout(()=>fs.writeFileSync(process.argv[3],'escaped'),500)",
      pidPath,
      termPath,
      escapedPath,
    ], { signal: controller.signal, terminationGraceMs: 10 });
    await ready;
    watcher.close();

    controller.abort();
    const result = await pending;
    const pid = Number(readFileSync(pidPath, "utf8"));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/abort/i);
    expect(readFileSync(termPath, "utf8")).toBe("SIGTERM");
    expect(existsSync(escapedPath)).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("forces a timeout-resistant argv child closed without a survivor", async () => {
    const root = tempRoot("wf7-exec-timeout-");
    const pidPath = join(root, "pid");
    const termPath = join(root, "sigterm");
    const escapedPath = join(root, "escaped");
    const watcher = watch(root);
    const ready = once(watcher, "change");
    // Platform integration: child timer is a RED escape hatch for broken forced termination.
    const pending = defaultPrReviewExec([
      process.execPath,
      "-e",
      "const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>fs.writeFileSync(process.argv[2],'SIGTERM'));setTimeout(()=>fs.writeFileSync(process.argv[3],'escaped'),500)",
      pidPath,
      termPath,
      escapedPath,
    ], { timeoutMs: 25, terminationGraceMs: 10 });
    await ready;
    watcher.close();

    const result = await pending;
    const pid = Number(readFileSync(pidPath, "utf8"));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/timed out/i);
    expect(readFileSync(termPath, "utf8")).toBe("SIGTERM");
    expect(existsSync(escapedPath)).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("read-only GitHub snapshot tool", () => {
  test("captures paginated open draft fork metadata, rename/binary line map, and five nonces", async () => {
    const files = fixtureFiles();
    const diff = fixtureDiff(files);
    const github = fakeGithub(files, diff);
    const fixture = toolFixture(github);

    const created = await fixture.tool.execute({ action: "create", target: "7", dry_run: true });

    expect(created).toMatchObject({
      status: "created",
      owner: "octo",
      repo: "repo",
      pull_number: 7,
      repository_node_id: "R_node",
      actor: "octocat",
      state: "open",
      draft: true,
      fork: true,
      base_sha: "base123",
      head_sha: "head123",
      changed_file_count: 101,
      diff_size: Buffer.byteLength(diff),
    });
    expect(created.run_nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.snapshot_nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.call_nonces).toHaveLength(5);
    expect(new Set(created.call_nonces.map((entry: { call_nonce: string }) => entry.call_nonce)).size).toBe(5);
    expect(created.line_map).toContainEqual({ path: "src/renamed.ts", line: 1, side: "RIGHT", hunk: 0 });
    expect(created.nonreviewable_entries).toContainEqual({ path: "assets/logo.bin", reason: "binary" });
    expect(github.calls).toContainEqual([
      "gh", "api", "--method", "GET", "repos/octo/repo/pulls/7/files?per_page=100&page=2",
    ]);
    expect(github.calls.every((argv) => argv[0] === "git" || (argv[0] === "gh" && argv.includes("GET")))).toBe(true);
    expect(existsSync(fixture.targetDir)).toBe(false);

    const chunk = await fixture.tool.execute({
      action: "read",
      snapshot_handle: created.snapshot_handle,
      offset: 0,
      length: 32,
    });
    expect(chunk.content).toBe(diff.slice(0, 32));
    expect(chunk.bytes_read).toBe(32);
    expect(chunk.eof).toBe(false);

    expect(await fixture.tool.execute({ action: "status", run_handle: created.run_handle })).toEqual({
      status: "pending",
    });
    expect(receipts(fixture.receiptRootDir)).toEqual([
      expect.objectContaining({
        status: "prepared",
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        head_sha: "head123",
        authenticated_actor: "octocat",
        diff_digest: digest(diff),
      }),
    ]);
  });

  test("aborts an in-flight snapshot GET with a typed receipt and no live state", async () => {
    const files = fixtureFiles(3);
    const github = fakeGithub(files, fixtureDiff(files));
    const originalExec = github.exec;
    const observedOptions: PrReviewExecOptions[] = [];
    const started = Promise.withResolvers<void>();
    let blocked = false;
    github.exec = async (argv, options = {}) => {
      observedOptions.push(options);
      if (!blocked && argv.at(-1) === "repos/octo/repo/pulls/7") {
        blocked = true;
        started.resolve();
        if (!options.signal) {
          return { exitCode: 1, stdout: "", stderr: "missing AbortSignal" };
        }
        await new Promise<void>((resolve) => {
          options.signal!.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          exitCode: 1,
          stdout: "",
          stderr: "operation aborted token=github_pat_ABORTSECRET",
        };
      }
      return originalExec(argv, options);
    };
    const fixture = toolFixture(github);
    const controller = new AbortController();
    const pending = fixture.tool.execute(
      { action: "create", target: "octo/repo#7", dry_run: false },
      "cancelled-create",
      controller.signal,
    );
    await started.promise;

    controller.abort();
    await expectFailure(pending, "task_cancelled");

    expect(observedOptions.every((options) => options.signal !== controller.signal)).toBe(true);
    expect(observedOptions.every((options) => options.signal?.aborted)).toBe(true);
    expect(observedOptions.every((options) =>
      Number.isSafeInteger(options.timeoutMs) && Number(options.timeoutMs) > 0
    )).toBe(true);
    expect(github.calls.some((argv) => argv.includes("POST"))).toBe(false);
    expect(readdirSync(join(fixture.root, "state"))).toEqual([]);
    expect(receipts(fixture.receiptRootDir)).toEqual([
      expect.objectContaining({
        status: "failed",
        failure_code: "task_cancelled",
        mutation_guard_active: false,
      }),
    ]);
    expect(JSON.stringify(receipts(fixture.receiptRootDir))).not.toContain("ABORTSECRET");
  });

  test("aborted snapshot reads revoke handles instead of returning bytes", async () => {
    const files = fixtureFiles(3);
    const fixture = toolFixture(fakeGithub(files, fixtureDiff(files)));
    const created = await fixture.tool.execute({
      action: "create",
      target: "octo/repo#7",
      dry_run: true,
    });
    const controller = new AbortController();
    controller.abort();

    await expectFailure(fixture.tool.execute({
      action: "read",
      snapshot_handle: created.snapshot_handle,
      offset: 0,
      length: 8,
    }, "cancelled-read", controller.signal), "task_cancelled");

    expect(() => fixture.state.lookupSnapshot(created.snapshot_handle)).toThrow(
      "unknown snapshot handle",
    );
    expect(receipts(fixture.receiptRootDir)[0]).toMatchObject({
      status: "failed",
      failure_code: "task_cancelled",
      mutation_guard_active: false,
    });
  });

  test("idempotent cleanup revokes handles and removes the private diff", async () => {
    const files = fixtureFiles(3);
    const fixture = toolFixture(fakeGithub(files, fixtureDiff(files)));
    const created = await fixture.tool.execute({
      action: "create",
      target: "octo/repo#7",
      dry_run: true,
    });
    const runDirectory = join(fixture.root, "state", readdirSync(join(fixture.root, "state"))[0]!);
    const diffPath = join(runDirectory, `${created.snapshot_handle}.diff`);
    expect(statSync(diffPath).mode & 0o777).toBe(0o600);

    fixture.tool.cleanup(created.run_handle);
    fixture.tool.cleanup(created.run_handle);

    expect(readdirSync(join(fixture.root, "state"))).toEqual([]);
    expect(() => fixture.state.lookupSnapshot(created.snapshot_handle)).toThrow(
      "unknown snapshot handle",
    );
    await expectFailure(fixture.tool.execute({
      action: "read",
      snapshot_handle: created.snapshot_handle,
      offset: 0,
      length: 1,
    }), "snapshot_incomplete");
    await expectFailure(fixture.tool.execute({
      action: "status",
      run_handle: created.run_handle,
    }), "invalid_arguments");
  });

  test("fails closed on incomplete textual patches and records promoted receipt", async () => {
    const files = [{
      filename: "src/a.ts",
      status: "modified",
      patch: "@@ -1 +1 @@\n-old",
    }];
    const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const github = fakeGithub(files, diff);
    const fixture = toolFixture(github);

    await expectFailure(fixture.tool.execute({ action: "create", target: "octo/repo#7", dry_run: false }), "snapshot_incomplete");
    expect(receipts(fixture.receiptRootDir)).toEqual([
      expect.objectContaining({ status: "failed", head_sha: "head123", failure_code: "snapshot_incomplete" }),
    ]);
    expect(github.calls.some((argv) => argv.includes("POST") || argv.includes("PATCH") || argv.includes("PUT") || argv.includes("DELETE"))).toBe(false);
  });

  test("rejects oversized and stale snapshots with durable typed failures", async () => {
    const files = fixtureFiles(3);
    const diff = fixtureDiff(files);

    const oversized = toolFixture(fakeGithub(files, diff), { maxDiffBytes: 8 });
    await expectFailure(oversized.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true }), "diff_too_large");
    expect(receipts(oversized.receiptRootDir)[0]).toMatchObject({ status: "failed", failure_code: "diff_too_large" });

    const stale = toolFixture(fakeGithub(files, diff, { stale: true }));
    await expectFailure(stale.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true }), "stale_head");
    expect(receipts(stale.receiptRootDir)[0]).toMatchObject({ status: "failed", failure_code: "stale_head", head_sha: "head123" });
  });

  test("allows draft/fork but rejects non-open PRs", async () => {
    const files = fixtureFiles(3);
    const diff = fixtureDiff(files);
    const fixture = toolFixture(fakeGithub(files, diff, { state: "closed" }));

    await expectFailure(fixture.tool.execute({ action: "create", target: "octo/repo#7", dry_run: false }), "pr_not_open");
    expect(receipts(fixture.receiptRootDir)[0]).toMatchObject({ status: "failed", failure_code: "pr_not_open" });
  });

  test("receipts redact auth and role failures before any handle is returned", async () => {
    const files = fixtureFiles(3);
    const diff = fixtureDiff(files);

    const auth = toolFixture(fakeGithub(files, diff, { actorFailure: true }));
    await expectFailure(auth.tool.execute({ action: "create", target: "octo/repo#7", dry_run: false }), "auth_failed");
    const authBytes = JSON.stringify(receipts(auth.receiptRootDir));
    expect(authBytes).not.toContain("SUPERSECRET");
    expect(authBytes).not.toContain("run_handle");
    expect(authBytes).not.toContain("snapshot_handle");

    const role = toolFixture(fakeGithub(files, diff), {
      checkRoles: () => { throw new RoleIntegrityError("role_integrity_drift", "token=github_pat_ROLESECRET"); },
    });
    await expectFailure(role.tool.execute({ action: "create", target: "octo/repo#7", dry_run: false }), "role_integrity_drift");
    const roleBytes = JSON.stringify(receipts(role.receiptRootDir));
    expect(roleBytes).not.toContain("ROLESECRET");
    expect(roleBytes).toContain("role_integrity_drift");
  });

  test("bare repo mismatch, bounded reads, and closed actions fail with zero mutation", async () => {
    const files = fixtureFiles(3);
    const diff = fixtureDiff(files);
    const mismatchGithub = fakeGithub(files, diff);
    mismatchGithub.exec = async (argv, options) => {
      if (argv.at(-1) === "repos/octo/repo") return ok({ node_id: "R_other", full_name: "other/repo", permissions: { pull: true } });
      return fakeGithub(files, diff).exec(argv, options);
    };
    const mismatch = toolFixture(mismatchGithub);
    await expectFailure(mismatch.tool.execute({ action: "create", target: "7", dry_run: true }), "target_resolution_failed");
    expect(receipts(mismatch.receiptRootDir)[0]).toMatchObject({ status: "failed", failure_code: "target_resolution_failed" });

    const fixture = toolFixture(fakeGithub(files, diff));
    const created = await fixture.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true });
    await expectFailure(fixture.tool.execute({
      action: "read", snapshot_handle: created.snapshot_handle, offset: 0, length: 65,
    }), "snapshot_incomplete");
    expect(receipts(fixture.receiptRootDir)[0]).toMatchObject({ status: "failed", failure_code: "snapshot_incomplete" });

    await expectFailure(fixture.tool.execute({ action: "delete" } as never), "invalid_arguments");
    await expectFailure(fixture.tool.execute({ action: "status", run_handle: created.run_handle, extra: true } as never), "invalid_arguments");
  });
  test("receipts rejected bare-target remote execution before returning handles", async () => {
    const files = fixtureFiles(3);
    const github = fakeGithub(files, fixtureDiff(files));
    const originalExec = github.exec;
    github.exec = async (argv, options) => {
      if (argv[0] === "git") throw new Error("token=github_pat_REMOTESECRET");
      return originalExec(argv, options);
    };
    const fixture = toolFixture(github);
    await expectFailure(
      fixture.tool.execute({ action: "create", target: "7", dry_run: true }),
      "target_resolution_failed",
    );
    const bytes = JSON.stringify(receipts(fixture.receiptRootDir));
    expect(bytes).toContain("target_resolution_failed");
    expect(bytes).not.toContain("REMOTESECRET");
    expect(readdirSync(join(fixture.root, "state"))).toEqual([]);
  });

  test("classifies C-quoted non-ASCII binary paths through canonical diff association", async () => {
    const files = [{ filename: "é.bin", status: "modified" }];
    const oldPath = String.raw`"a/\303\251.bin"`;
    const newPath = String.raw`"b/\303\251.bin"`;
    const diff = [
      `diff --git ${oldPath} ${newPath}`,
      `Binary files ${oldPath} and ${newPath} differ`,
      "",
    ].join("\n");
    const fixture = toolFixture(fakeGithub(files, diff));
    const created = await fixture.tool.execute({
      action: "create",
      target: "octo/repo#7",
      dry_run: true,
    });
    expect(created.nonreviewable_entries).toContainEqual({ path: "é.bin", reason: "binary" });
    expect(created.line_map).toEqual([]);
  });

  test("revokes handles even when terminal receipt persistence fails", async () => {
    const files = fixtureFiles(3);
    const fixture = toolFixture(fakeGithub(files, fixtureDiff(files)));
    const created = await fixture.tool.execute({
      action: "create",
      target: "octo/repo#7",
      dry_run: true,
    });
    rmSync(fixture.receiptRootDir, { recursive: true, force: true });
    writeFileSync(fixture.receiptRootDir, "blocked");
    await expectFailure(fixture.tool.execute({
      action: "read",
      snapshot_handle: created.snapshot_handle,
      offset: 0,
      length: 65,
    }), "snapshot_incomplete");
    expect(() => fixture.state.lookupSnapshot(created.snapshot_handle)).toThrow("unknown snapshot handle");
    await expectFailure(
      fixture.tool.execute({ action: "status", run_handle: created.run_handle }),
      "invalid_arguments",
    );
  });

  test("bounded state reads do not materialize a whole-snapshot defensive copy", async () => {
    const files = fixtureFiles(3);
    const fixture = toolFixture(fakeGithub(files, fixtureDiff(files)));
    const created = await fixture.tool.execute({
      action: "create",
      target: "octo/repo#7",
      dry_run: true,
    });
    expect(created.diff_size).toBeGreaterThan(64);
    let wholeSnapshotLookups = 0;
    const lookupSnapshot = fixture.state.lookupSnapshot.bind(fixture.state);
    fixture.state.lookupSnapshot = ((handle: string) => {
      wholeSnapshotLookups += 1;
      return lookupSnapshot(handle);
    }) as typeof fixture.state.lookupSnapshot;
    const chunk = await fixture.tool.execute({
      action: "read",
      snapshot_handle: created.snapshot_handle,
      offset: 0,
      length: 16,
    });
    expect(chunk.bytes_read).toBe(16);
    expect(wholeSnapshotLookups).toBe(0);
  });

  test("preserves canonical bytes and reads only complete UTF-8 chunks", async () => {
    const files = [{ filename: "src/unicode.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+néw" }];
    const diff = "diff --git a/src/unicode.ts b/src/unicode.ts\n--- a/src/unicode.ts\n+++ b/src/unicode.ts\n@@ -1 +1 @@\n-old\n+néw\n";
    const bytes = new TextEncoder().encode(diff);
    const fixture = toolFixture(fakeGithub(files, bytes));
    const created = await fixture.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true });
    expect(created.diff_digest).toBe(createHash("sha256").update(bytes).digest("hex"));

    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = await fixture.tool.execute({
        action: "read",
        snapshot_handle: created.snapshot_handle,
        offset,
        length: 7,
      });
      chunks.push(Buffer.from(chunk.content_base64, "base64"));
      expect(new TextEncoder().encode(chunk.content)).toEqual(chunks.at(-1)!);
      expect(chunk.next_offset).toBeGreaterThan(offset);
      offset = chunk.next_offset;
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);

    const continuation = bytes.findIndex((byte, index) => index > 0 && (byte & 0xc0) === 0x80);
    const bad = toolFixture(fakeGithub(files, bytes));
    const badCreated = await bad.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true });
    await expectFailure(bad.tool.execute({
      action: "read",
      snapshot_handle: badCreated.snapshot_handle,
      offset: continuation,
      length: 7,
    }), "snapshot_incomplete");
    expect(() => bad.state.lookupSnapshot(badCreated.snapshot_handle)).toThrow("unknown snapshot handle");
  });

  test("journals manifest-load failures before returning and redacts details", async () => {
    const files = fixtureFiles(3);
    const fixture = toolFixture(fakeGithub(files, fixtureDiff(files)), {
      loadManifest: () => { throw new Error("token=github_pat_MANIFESTSECRET"); },
    });
    await expectFailure(
      fixture.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true }),
      "role_integrity_drift",
    );
    const bytes = JSON.stringify(receipts(fixture.receiptRootDir));
    expect(bytes).toContain("role_integrity_drift");
    expect(bytes).not.toContain("MANIFESTSECRET");
  });

  test("does not mistake source text for binary or submodule metadata", async () => {
    for (const source of [
      "Binary files a/src/a.ts and b/src/a.ts differ",
      "Subproject commit abcdef123456",
    ]) {
      const files = [{ filename: "src/a.ts", status: "modified" }];
      const diff = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+${source}\n`;
      const fixture = toolFixture(fakeGithub(files, diff));
      await expectFailure(
        fixture.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true }),
        "snapshot_incomplete",
      );
    }
  });

  test("preserves actor rate limits and maps executor overflow to diff size", async () => {

    const submoduleFiles = [{
      filename: "vendor/lib",
      status: "modified",
      patch: "@@ -1 +1 @@\n-Subproject commit aaaaaaa\n+Subproject commit bbbbbbb",
    }];
    const submoduleDiff = [
      "diff --git a/vendor/lib b/vendor/lib",
      "index aaaaaaa..bbbbbbb 160000",
      "--- a/vendor/lib",
      "+++ b/vendor/lib",
      "@@ -1 +1 @@",
      "-Subproject commit aaaaaaa",
      "+Subproject commit bbbbbbb",
      "",
    ].join("\n");
    const submodule = toolFixture(fakeGithub(submoduleFiles, submoduleDiff));
    const created = await submodule.tool.execute({
      action: "create",
      target: "octo/repo#7",
      dry_run: true,
    });
    expect(created.nonreviewable_entries).toContainEqual({
      path: "vendor/lib",
      reason: "submodule",
    });
    expect(created.line_map).toEqual([]);
    const files = fixtureFiles(3);
    const diff = fixtureDiff(files);
    const limited = toolFixture(fakeGithub(files, diff, { actorError: "HTTP 429 rate limit exceeded" }));
    await expectFailure(
      limited.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true }),
      "rate_limited",
    );

    const overflowGithub = fakeGithub(files, diff);
    const originalExec = overflowGithub.exec;
    overflowGithub.exec = async (argv, options) => {
      if (argv.some((arg) => arg.includes("application/vnd.github.v3.diff"))) {
        overflowGithub.calls.push([...argv]);
        overflowGithub.options.push(options ?? {});
        return { exitCode: 1, stdout: new Uint8Array(), stderr: "stdout maxBuffer length exceeded" };
      }
      return originalExec(argv, options);
    };
    const overflow = toolFixture(overflowGithub, { maxDiffBytes: 1234 });
    await expectFailure(
      overflow.tool.execute({ action: "create", target: "octo/repo#7", dry_run: true }),
      "diff_too_large",
    );
    const diffCall = overflowGithub.calls.findIndex((argv) =>
      argv.some((arg) => arg.includes("application/vnd.github.v3.diff"))
    );
    expect(overflowGithub.options[diffCall]?.maxBufferBytes).toBe(1234);
  });
});
