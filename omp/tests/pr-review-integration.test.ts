import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FakeExtensionApi,
  runFakeReview,
  targetFiles,
} from "./pr-review-fixture";
import defaultExtension, {
  createPrReviewExtension,
} from "../extensions/pr-review/index";
import roleManifestJson from "../extensions/pr-review/role-manifest.json";
import type { LoadedRoleManifest } from "../extensions/pr-review/role-integrity";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production PR-review extension", () => {
  test("loads the exported default factory from an arbitrary cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "wf7-default-extension-"));
    roots.push(root);
    const arbitraryRepo = join(root, "repo");
    const stateHome = join(root, "state");
    mkdirSync(arbitraryRepo, { recursive: true });
    const priorCwd = process.cwd();
    const priorStateHome = process.env.XDG_STATE_HOME;
    const canonicalDir = join(root, "canonical-agents");
    const liveDir = join(root, "home", ".omp", "agent", "agents");
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(liveDir, { recursive: true });
    const ompRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const roles = roleManifestJson.roles.map((role) => {
      const source = join(ompRoot, "agents", `${role.agent}.md`);
      const trackedPath = join(canonicalDir, `${role.agent}.md`);
      const livePath = join(liveDir, `${role.agent}.md`);
      const bytes = readFileSync(source);
      writeFileSync(trackedPath, bytes, { mode: 0o600 });
      const canonicalPath = realpathSync(trackedPath);
      symlinkSync(canonicalPath, livePath);
      return {
        ...role,
        livePath,
        canonicalPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
    const manifest: LoadedRoleManifest = {
      version: 1,
      digest: createHash("sha256").update(JSON.stringify(roles)).digest("hex"),
      roles,
    };
    const api = new FakeExtensionApi();
    try {
      process.chdir(arbitraryRepo);
      process.env.XDG_STATE_HOME = stateHome;
      await defaultExtension(api, {
        manifest,
        stateRootDir: join(stateHome, "runs"),
      });
    } finally {
      process.chdir(priorCwd);
      if (priorStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = priorStateHome;
    }
    expect([...api.commands.keys()]).toEqual(["review-pr"]);
    expect([...api.tools.keys()]).toEqual([
      "pr_review_snapshot",
      "pr_review_publish",
    ]);
    expect(api.hooks.get("tool_call")).toHaveLength(1);
    expect(existsSync(join(arbitraryRepo, ".omp"))).toBe(false);
  });

  test("registers one command, strict read/exec tools, and capture hooks", async () => {
    expect(typeof createPrReviewExtension).toBe("function");

    const run = await runFakeReview({ dryRun: true, decision: "reject" });
    roots.push(run.root);
    expect([...run.api.commands.keys()]).toEqual(["review-pr"]);
    expect([...run.api.tools.keys()]).toEqual([
      "pr_review_snapshot",
      "pr_review_publish",
    ]);
    expect(run.api.tools.get("pr_review_snapshot")).toMatchObject({
      approval: "read",
      strict: true,
    });
    expect(run.api.tools.get("pr_review_publish")).toMatchObject({
      approval: "exec",
      strict: true,
    });
    expect(run.api.hooks.get("tool_call")).toHaveLength(1);
    expect(run.api.hooks.get("tool_result")).toHaveLength(1);
  });

  test("drives exact next-turn, two batches, judge, sealed status, and dry-run receipt", async () => {
    const run = await runFakeReview({ dryRun: true, decision: "reject" });
    roots.push(run.root);

    expect(run.api.messages).toHaveLength(1);
    expect(run.api.messages[0]!.options).toEqual({
      deliverAs: "nextTurn",
      triggerTurn: true,
    });
    expect(run.api.messages[0]!.payload).toContain("WF7 PR REVIEW CONTROLLER PROTOCOL v1");
    expect(run.api.messages[0]!.payload).toContain("TARGET: owner/repo#7");
    expect(run.api.messages[0]!.payload).toContain("DRY_RUN: true");
    expect(run.githubCalls.some((call) => call.includes("repos/owner/repo"))).toBe(true);
    expect(run.githubCalls.some((call) => call.some((arg) => arg.includes("octo/repo")))).toBe(false);

    expect(run.captureHandle).toHaveLength(43);
    expect(run.publishResult).toMatchObject({
      status: "dry_run",
      event: "APPROVE",
      comment_count: 0,
    });
    expect(run.posts).toHaveLength(0);
    const batches = run.api.taskCalls.map((call) => {
      const tasks = call.input.tasks;
      if (!Array.isArray(tasks)) throw new Error("public next_task omitted tasks");
      return tasks.map((task) => {
        if (!task || typeof task !== "object" || !(("name") in task)) {
          throw new Error("public next_task contained invalid task");
        }
        return task.name;
      });
    });
    expect(batches).toEqual([
      ["wf7-fable-initial", "wf7-sol-initial"],
      ["wf7-fable-rebuttal", "wf7-sol-rebuttal"],
      ["wf7-grok-judge"],
    ]);
    expect(run.receipt.status).toBe("dry_run");
    expect(run.receipt.tasks.map((task) => task.task)).toEqual([
      "wf7-fable-initial",
      "wf7-sol-initial",
      "wf7-fable-rebuttal",
      "wf7-sol-rebuttal",
      "wf7-grok-judge",
    ]);
    expect(new Set(run.receipt.tasks.map((task) => task.nativeToolCallId))).toEqual(
      new Set(["task-1", "task-2", "task-3"]),
    );
    expect(run.receipt.head_sha).toBe("a".repeat(40));
    expect(run.receipt.diff_digest).toHaveLength(64);
    expect(run.receipt.roles.every((role) => role.prePublishValid)).toBe(true);
    expect(targetFiles(run.targetDir)).toEqual(["sentinel.txt"]);
    expect(readFileSync(join(run.targetDir, "sentinel.txt"), "utf8")).toBe("untouched");
  });

  test("denies direct GitHub comment mutation outside opaque publisher", async () => {
    const run = await runFakeReview({
      dryRun: true,
      decision: "reject",
      probeDirectWrite: true,
    });
    roots.push(run.root);
    expect(run.boundaryResults).toHaveLength(14);
    for (const result of run.boundaryResults!.slice(0, 10)) {
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("GitHub"),
      });
    }
    expect(run.boundaryResults!.slice(10)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(run.posts).toHaveLength(0);
    expect(run.receipt.status).toBe("dry_run");
  });


  test("keeps mutation boundary through publish and releases after terminal receipt", async () => {
    const run = await runFakeReview({
      dryRun: true,
      decision: "reject",
      probeGuardLifetime: true,
    });
    roots.push(run.root);
    expect(run.prePublishBlock).toEqual({
      block: true,
      reason: expect.stringContaining("GitHub"),
    });
    expect(run.prePublishGuardActive).toBe(true);
    expect(run.publishResult?.status).toBe("dry_run");
    expect(run.receipt.mutation_guard_active).toBe(false);
    expect(run.receipt.status).toBe("dry_run");
    expect(run.postPublishBlock).toBeUndefined();
  });
  test("fails closed on project role shadow with typed receipt and zero writes", async () => {
    const run = await runFakeReview({ dryRun: false, agentSource: "project" });
    roots.push(run.root);
    expect(run.receipt.status).toBe("failed");
    expect(run.receipt.failure_code).toBe("project_shadow");
    expect(run.receipt.completed_capture_digest).toBeUndefined();
    expect(run.posts).toHaveLength(0);
    expect(targetFiles(run.targetDir)).toEqual(["sentinel.txt"]);
  });

  test("publishes one grouped inline-only review from opaque capture", async () => {
    const run = await runFakeReview({ dryRun: false, decision: "request_changes" });
    roots.push(run.root);
    expect(run.publishResult).toMatchObject({
      status: "published",
      event: "REQUEST_CHANGES",
      comment_count: 2,
    });
    expect(run.posts).toHaveLength(1);
    expect(run.posts[0]).toMatchObject({
      commit_id: "a".repeat(40),
      event: "REQUEST_CHANGES",
      body: expect.stringContaining("findings are inline"),
    });
    expect(run.posts[0]!.comments).toHaveLength(2);
    expect(JSON.stringify(run.posts[0])).not.toContain("candidate body");
    expect(run.githubCalls.filter((call) => call.includes("POST"))).toHaveLength(1);
    expect(run.githubCalls.some((call) => call.some((arg) => /issues\/.+\/comments/.test(arg)))).toBe(false);
    expect(run.githubCalls.some((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "comment")).toBe(false);
    expect(run.receipt.status).toBe("published");
    expect(run.receipt.head_sha).toBe("a".repeat(40));
    expect(run.receipt.diff_digest).toHaveLength(64);
  });

  test("fresh sequential same-head review commands preserve attempts and reuse remote publication", async () => {
    const run = await runFakeReview({
      dryRun: false,
      decision: "request_changes",
      runCount: 2,
    });
    roots.push(run.root);

    expect(run.api.messages).toHaveLength(2);
    expect(run.posts).toHaveLength(1);
    expect(run.publishResults).toEqual([
      expect.objectContaining({
        status: "published",
        github_review_id: 77,
        github_inline_comment_ids: [100, 101],
      }),
      expect.objectContaining({
        status: "existing",
        github_review_id: 77,
        github_inline_comment_ids: [100, 101],
      }),
    ]);
    expect(run.receipts).toEqual([
      expect.objectContaining({ status: "published", github_review_id: 77 }),
      expect.objectContaining({ status: "published", github_review_id: 77 }),
    ]);
    expect(run.receipts![0]).not.toBe(run.receipts![1]);
  });

  test("stale publish head fails before mutation", async () => {
    const run = await runFakeReview({
      dryRun: false,
      decision: "accept",
      staleAtPublish: true,
    });
    roots.push(run.root);
    expect(run.publishResult).toBeUndefined();
    expect(run.receipt.status).toBe("failed");
    expect(run.receipt.failure_code).toBe("stale_head");
    expect(run.posts).toHaveLength(0);
  });

  test("link/config discovery is user-scoped from an arbitrary repository", () => {
    const root = mkdtempSync(join(tmpdir(), "wf7-link-integration-"));
    roots.push(root);
    const agentDir = join(root, "home", ".omp", "agent");
    const arbitraryRepo = join(root, "other-repo");
    mkdirSync(arbitraryRepo, { recursive: true });
    const ompRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const result = Bun.spawnSync(["sh", join(ompRoot, "link.sh")], {
      cwd: arbitraryRepo,
      env: { ...process.env, OMP_AGENT_DIR: agentDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(agentDir, "config.yml"))).toBe(true);
    expect(existsSync(join(agentDir, "extensions", "pr-review", "index.ts"))).toBe(true);
    for (const role of ["wf7-fable-reviewer", "wf7-sol-reviewer", "wf7-grok-judge"]) {
      const live = join(agentDir, "agents", `${role}.md`);
      expect(existsSync(live)).toBe(true);
      expect(realpathSync(live)).toBe(join(ompRoot, "agents", `${role}.md`));
    }
    expect(lstatSync(join(agentDir, "extensions")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(agentDir, "extensions"))).toBe(join(ompRoot, "extensions"));
    expect(existsSync(join(arbitraryRepo, ".omp"))).toBe(false);
  });
});
