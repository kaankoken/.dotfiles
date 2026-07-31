import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReceiptJournal } from "../extensions/pr-review/receipts";
import {
  INITIAL_REVIEW_SCHEMA,
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA,
  REBUTTAL_SCHEMA_SHA256,
} from "../extensions/pr-review/schemas";
import {
  RoleIntegrityError,
  checkAllRoleFiles,
  checkAllRoleFilesAtRegistration,
  checkRoleForSlot,
  createRoleMutationGuard,
  loadRoleManifest,
  type LoadedRoleManifest,
  type RoleManifestEntry,
} from "../extensions/pr-review/role-integrity";
import type { PrReviewReceiptV1, Wf7AgentName } from "../extensions/pr-review/contracts";

const roots: string[] = [];
const ROLE_SOURCE_DIR = join(import.meta.dir, "..", "agents");

const ROLE_DATA = [
  {
    agent: "wf7-fable-reviewer",
    file: "wf7-fable-reviewer.md",
    model: "anthropic/claude-fable-5:max",
    schemas: [
      { identity: INITIAL_REVIEW_SCHEMA.$id, sha256: INITIAL_REVIEW_SCHEMA_SHA256 },
      { identity: REBUTTAL_SCHEMA.$id, sha256: REBUTTAL_SCHEMA_SHA256 },
    ],
  },
  {
    agent: "wf7-sol-reviewer",
    file: "wf7-sol-reviewer.md",
    model: "openai-codex/gpt-5.6-sol:xhigh",
    schemas: [
      { identity: INITIAL_REVIEW_SCHEMA.$id, sha256: INITIAL_REVIEW_SCHEMA_SHA256 },
      { identity: REBUTTAL_SCHEMA.$id, sha256: REBUTTAL_SCHEMA_SHA256 },
    ],
  },
  {
    agent: "wf7-grok-judge",
    file: "wf7-grok-judge.md",
    model: "xai-oauth/grok-4.5:xhigh",
    schemas: [{ identity: JUDGE_RESULT_SCHEMA.$id, sha256: JUDGE_RESULT_SCHEMA_SHA256 }],
  },
] as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(): LoadedRoleManifest {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "wf7-role-integrity-")));
  roots.push(root);
  const canonicalDir = join(root, "canonical");
  const liveDir = join(root, "live");
  mkdirSync(canonicalDir);
  mkdirSync(liveDir);

  const roles = ROLE_DATA.map((role) => {
    const canonicalPath = join(canonicalDir, role.file);
    const livePath = join(liveDir, role.file);
    const bytes = readFileSync(join(ROLE_SOURCE_DIR, role.file));
    writeFileSync(canonicalPath, bytes, { mode: 0o600 });
    symlinkSync(canonicalPath, livePath);
    return {
      livePath,
      canonicalPath,
      sha256: sha256(bytes),
      agent: role.agent,
      model: role.model,
      tools: ["pr_review_snapshot"],
      spawns: [],
      blocking: true,
      schemas: role.schemas.map((schema) => ({ ...schema })),
    } satisfies RoleManifestEntry;
  });

  return { version: 1, digest: sha256(JSON.stringify(roles)), roles };
}

function journalFor(manifest: LoadedRoleManifest, id: string): ReceiptJournal {
  const rootDir = join(roots.at(-1)!, "receipts");
  return ReceiptJournal.start({
    rootDir,
    provisionalId: id,
    owner: "octo",
    repo: "repo",
    pullNumber: 7,
    roleManifestDigest: manifest.digest,
    now: () => "2026-07-31T12:00:00.000Z",
  });
}

function receipt(journal: ReceiptJournal): PrReviewReceiptV1 {
  return JSON.parse(readFileSync(journal.receiptPath, "utf8")) as PrReviewReceiptV1;
}

function expectFailure(run: () => unknown, code: PrReviewReceiptV1["failure_code"]): void {
  try {
    run();
    throw new Error("expected role integrity failure");
  } catch (error) {
    expect(error).toBeInstanceOf(RoleIntegrityError);
    expect((error as RoleIntegrityError).code).toBe(code);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("canonical WF7 role manifest", () => {
  test("pins exact absolute paths, role contracts, selectors, schemas, and role bytes", () => {
    const manifest = loadRoleManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.roles).toHaveLength(3);

    for (const [index, expected] of ROLE_DATA.entries()) {
      const role = manifest.roles[index]!;
      expect(role).toMatchObject({
        livePath: `/Users/legolas/.omp/agent/agents/${expected.file}`,
        canonicalPath: `/Users/legolas/.dotfiles/omp/agents/${expected.file}`,
        agent: expected.agent,
        model: expected.model,
        tools: ["pr_review_snapshot"],
        spawns: [],
        blocking: true,
        schemas: expected.schemas,
      });
      expect(role.sha256).toBe(sha256(readFileSync(join(ROLE_SOURCE_DIR, expected.file))));
    }
  });
});

describe("role realpath, bytes, and frontmatter checks", () => {
  test("accepts exact regular canonical roles at registration, pre-call, and pre-publish", () => {
    const manifest = fixture();
    const registration = checkAllRoleFilesAtRegistration(manifest);
    expect(registration.every((role) => role.preCallValid)).toBe(true);
    const journal = journalFor(manifest, "success");

    const preCall = checkRoleForSlot(manifest, {
      boundary: "pre-call",
      taskName: "wf7-fable-initial",
      task: {
        agent: "wf7-fable-reviewer",
        schemaIdentity: INITIAL_REVIEW_SCHEMA.$id,
        schemaSha256: INITIAL_REVIEW_SCHEMA_SHA256,
      },
      journal,
    });
    expect(preCall).toMatchObject({ agent: "wf7-fable-reviewer", preCallValid: true });

    const prePublish = checkAllRoleFiles(manifest, { boundary: "pre-publish", journal });
    expect(prePublish.every((role) => role.prePublishValid)).toBe(true);
    expect(prePublish.every((role) => role.prePublishSha256 === manifest.roles.find((entry) => entry.agent === role.agent)!.sha256)).toBe(true);
  });

  test("fails closed and receipts missing, nonregular, wrong-realpath, and hash drift before publication", () => {
    const cases = ["missing", "nonregular", "wrong-realpath", "hash"] as const;
    for (const [index, drift] of cases.entries()) {
      const manifest = fixture();
      const role = manifest.roles[0]!;
      if (drift === "missing") unlinkSync(role.livePath);
      if (drift === "nonregular") {
        unlinkSync(role.livePath);
        rmSync(role.canonicalPath);
        mkdirSync(role.canonicalPath);
        symlinkSync(role.canonicalPath, role.livePath);
      }
      if (drift === "wrong-realpath") {
        const other = `${role.canonicalPath}.other`;
        writeFileSync(other, readFileSync(role.canonicalPath));
        unlinkSync(role.livePath);
        symlinkSync(other, role.livePath);
      }
      if (drift === "hash") writeFileSync(role.canonicalPath, `${readFileSync(role.canonicalPath, "utf8")}\ntoken=super-secret-value`);

      const journal = journalFor(manifest, `drift-${index}`);
      let captureMints = 0;
      let publisherCalls = 0;
      expectFailure(() => {
        checkAllRoleFiles(manifest, { boundary: "pre-call", journal });
        captureMints++;
        publisherCalls++;
      }, "role_integrity_drift");

      const failed = receipt(journal);
      expect(failed).toMatchObject({ status: "failed", failure_code: "role_integrity_drift" });
      expect(failed.roles.some((observation) => !observation.preCallValid)).toBe(true);
      expect(JSON.stringify(failed)).not.toContain("super-secret-value");
      expect(captureMints).toBe(0);
      expect(publisherCalls).toBe(0);
    }
  });

  test("rejects hash-consistent frontmatter role, model, tool, and spawn drift", () => {
    const replacements = [
      ["name: wf7-fable-reviewer", "name: wf7-sol-reviewer"],
      ["model: anthropic/claude-fable-5:max", "model: anthropic/claude-fable-5:min"],
      ["tools: [pr_review_snapshot]", "tools: [read]"],
      ["spawns: []", "spawns: [scout]"],
      ["blocking: true", "blocking: false"],
    ] as const;

    for (const [index, [from, to]] of replacements.entries()) {
      const manifest = fixture();
      const role = manifest.roles[0]!;
      const drifted = readFileSync(role.canonicalPath, "utf8").replace(from, to);
      writeFileSync(role.canonicalPath, drifted);
      role.sha256 = sha256(drifted);
      const journal = journalFor(manifest, `frontmatter-${index}`);
      expectFailure(
        () => checkAllRoleFiles(manifest, { boundary: "pre-call", journal }),
        "role_integrity_drift",
      );
      expect(receipt(journal)).toMatchObject({ status: "failed", failure_code: "role_integrity_drift" });
    }
  });
});

describe("slot provenance and selector checks", () => {
  test("requires user source and rejects target-project shadow before capture or publish", () => {
    const manifest = fixture();
    const journal = journalFor(manifest, "project-shadow");
    let captureMints = 0;
    let publisherCalls = 0;
    expectFailure(() => {
      checkRoleForSlot(manifest, {
        boundary: "pre-call",
        taskName: "wf7-sol-initial",
        task: {
          agent: "wf7-sol-reviewer",
          schemaIdentity: INITIAL_REVIEW_SCHEMA.$id,
          schemaSha256: INITIAL_REVIEW_SCHEMA_SHA256,
        },
        settlement: {
          agentSource: "project",
          resolvedModel: "openai-codex/gpt-5.6-sol:xhigh",
          resolvedModelIsFallback: false,
        },
        journal,
      });
      captureMints++;
      publisherCalls++;
    }, "project_shadow");

    expect(receipt(journal)).toMatchObject({ status: "failed", failure_code: "project_shadow" });
    expect(captureMints).toBe(0);
    expect(publisherCalls).toBe(0);
  });


  test("requires exact requested and resolved selectors on user settlements", () => {
    const validManifest = fixture();
    const validJournal = journalFor(validManifest, "valid-settlement");
    expect(checkRoleForSlot(validManifest, {
      boundary: "pre-call",
      taskName: "wf7-sol-initial",
      task: {
        agent: "wf7-sol-reviewer",
        schemaIdentity: INITIAL_REVIEW_SCHEMA.$id,
        schemaSha256: INITIAL_REVIEW_SCHEMA_SHA256,
      },
      settlement: {
        agentSource: "user",
        requestedModel: "openai-codex/gpt-5.6-sol:xhigh",
        resolvedModel: "openai-codex/gpt-5.6-sol:xhigh",
        resolvedModelIsFallback: false,
      },
      journal: validJournal,
    }).preCallValid).toBe(true);

    const missingManifest = fixture();
    const journal = journalFor(missingManifest, "missing-requested-model");
    expectFailure(() => checkRoleForSlot(missingManifest, {
      boundary: "pre-call",
      taskName: "wf7-sol-initial",
      task: {
        agent: "wf7-sol-reviewer",
        schemaIdentity: INITIAL_REVIEW_SCHEMA.$id,
        schemaSha256: INITIAL_REVIEW_SCHEMA_SHA256,
      },
      settlement: {
        agentSource: "user",
        resolvedModel: "openai-codex/gpt-5.6-sol:xhigh",
        resolvedModelIsFallback: false,
      },
      journal,
    }), "route_mismatch");
    expect(receipt(journal).failure_code).toBe("route_mismatch");
  });

  test("checks all three pinned roles before accepting a slot-specific task", () => {
    const manifest = fixture();
    const nonSlotRole = manifest.roles.find((role) => role.agent === "wf7-grok-judge")!;
    writeFileSync(nonSlotRole.canonicalPath, `${readFileSync(nonSlotRole.canonicalPath, "utf8")}\ndrift`);
    const journal = journalFor(manifest, "non-slot-drift");

    expectFailure(() => checkRoleForSlot(manifest, {
      boundary: "pre-call",
      taskName: "wf7-fable-initial",
      task: {
        agent: "wf7-fable-reviewer",
        schemaIdentity: INITIAL_REVIEW_SCHEMA.$id,
        schemaSha256: INITIAL_REVIEW_SCHEMA_SHA256,
      },
      journal,
    }), "role_integrity_drift");
    expect(receipt(journal)).toMatchObject({
      status: "failed",
      failure_code: "role_integrity_drift",
    });
  });
  test("uses only manifest selectors and rejects caller model, effort, schema, fallback, and route overrides", () => {
    const cases = [
      { callerModel: "openai-codex/gpt-5.6-sol:xhigh" },
      { callerEffort: "xhigh" },
      { schemaSha256: "0".repeat(64) },
      { resolvedModel: "openai-codex/gpt-5.6-sol:high" },
      { resolvedModelIsFallback: true },
      { agentSource: "builtin" },
    ] as const;

    for (const [index, override] of cases.entries()) {
      const manifest = fixture();
      const journal = journalFor(manifest, `override-${index}`);
      const task = {
        agent: "wf7-sol-reviewer" as const,
        schemaIdentity: INITIAL_REVIEW_SCHEMA.$id,
        schemaSha256: "schemaSha256" in override ? override.schemaSha256 : INITIAL_REVIEW_SCHEMA_SHA256,
        ...(override.callerModel ? { model: override.callerModel } : {}),
        ...(override.callerEffort ? { effort: override.callerEffort } : {}),
      };
      const settlement = "resolvedModel" in override || "resolvedModelIsFallback" in override || "agentSource" in override
        ? {
            agentSource: "agentSource" in override ? override.agentSource : "user",
            resolvedModel: "resolvedModel" in override ? override.resolvedModel : "openai-codex/gpt-5.6-sol:xhigh",
            resolvedModelIsFallback: "resolvedModelIsFallback" in override ? override.resolvedModelIsFallback : false,
          }
        : undefined;
      expectFailure(
        () => checkRoleForSlot(manifest, {
          boundary: "pre-call",
          taskName: "wf7-sol-initial",
          task,
          settlement,
          journal,
        }),
        override.resolvedModelIsFallback ? "model_fallback" : "agentSource" in override || "resolvedModel" in override ? "route_mismatch" : "task_envelope_invalid",
      );
    }
  });
});

describe("run-scoped OMP role mutation guard", () => {
  test("denies and receipts every direct write/create/delete/rename/chmod/link family", () => {
    const calls = [
      { toolName: "write", input: { path: "live" } },
      { toolName: "create", input: { path: "canonical" } },
      { toolName: "delete", input: { path: "live" } },
      { toolName: "rename", input: { fromPath: "live", toPath: "elsewhere" } },
      { toolName: "chmod", input: { path: "canonical", mode: 0o777 } },
      { toolName: "link", input: { target: "elsewhere", path: "live" } },
      { toolName: "edit", input: { path: "canonical" } },
    ] as const;

    for (const [index, call] of calls.entries()) {
      const manifest = fixture();
      const role = manifest.roles[0]!;
      const journal = journalFor(manifest, `guard-${index}`);
      const guard = createRoleMutationGuard(manifest, journal);
      const input = Object.fromEntries(
        Object.entries(call.input).map(([key, value]) => [
          key,
          value === "live" ? role.livePath : value === "canonical" ? role.canonicalPath : join(roots.at(-1)!, String(value)),
        ]),
      );
      const decision = guard.handleToolCall({ toolName: call.toolName, input });
      expect(decision).toEqual({ block: true, reason: "WF7 role mutation denied" });
      expect(receipt(journal)).toMatchObject({
        status: "failed",
        failure_code: "role_mutation_denied",
        mutation_guard_active: true,
      });
    }
  });

  test("denies hashline edit patches that name a protected role path", () => {
    const manifest = fixture();
    const journal = journalFor(manifest, "guard-hashline");
    const guard = createRoleMutationGuard(manifest, journal);
    const role = manifest.roles[0]!;

    expect(guard.handleToolCall({
      toolName: "edit",
      input: { patch: `*** Begin Patch\n[${role.livePath}#ABCD]\nCUT 1\n*** End Patch` },
    })).toEqual({ block: true, reason: "WF7 role mutation denied" });
    expect(receipt(journal).failure_code).toBe("role_mutation_denied");
  });

  test("denies mutation-capable shell and argv operations on live and resolved canonical paths", () => {
    const calls = [
      (role: RoleManifestEntry) => ({ toolName: "bash", input: { command: `chmod 777 '${role.canonicalPath}'` } }),
      (role: RoleManifestEntry) => ({ toolName: "bash", input: { command: `rm -- '${role.livePath}'` } }),
      (role: RoleManifestEntry) => ({ toolName: "exec", input: { argv: ["ln", "-sf", "/tmp/replacement", role.livePath] } }),
      (role: RoleManifestEntry) => ({ toolName: "exec", input: { argv: ["mv", role.canonicalPath, "/tmp/moved"] } }),
    ];

    for (const [index, makeCall] of calls.entries()) {
      const manifest = fixture();
      const journal = journalFor(manifest, `shell-${index}`);
      const guard = createRoleMutationGuard(manifest, journal);
      expect(guard.handleToolCall(makeCall(manifest.roles[0]!))).toEqual({
        block: true,
        reason: "WF7 role mutation denied",
      });
      expect(receipt(journal).failure_code).toBe("role_mutation_denied");
    }
  });

  test("denies nested sh -c shell strings and argv with embedded protected paths", () => {
    const calls = [
      (role: RoleManifestEntry) => ({
        toolName: "bash",
        input: { command: `sh -c "chmod 777 '${role.canonicalPath}'"` },
      }),
      (role: RoleManifestEntry) => ({
        toolName: "exec",
        input: { argv: ["sh", "-c", `rm -- '${role.livePath}'`] },
      }),
    ];

    for (const [index, makeCall] of calls.entries()) {
      const manifest = fixture();
      const journal = journalFor(manifest, `nested-shell-${index}`);
      const guard = createRoleMutationGuard(manifest, journal);
      expect(guard.handleToolCall(makeCall(manifest.roles[0]!))).toEqual({
        block: true,
        reason: "WF7 role mutation denied",
      });
      expect(receipt(journal).failure_code).toBe("role_mutation_denied");
    }
  });

  test("allows reads and unrelated writes, remains active for run, then stops cleanly", () => {
    const manifest = fixture();
    const journal = journalFor(manifest, "guard-safe");
    const guard = createRoleMutationGuard(manifest, journal);
    const role = manifest.roles[0]!;

    expect(guard.active).toBe(true);
    expect(guard.handleToolCall({ toolName: "read", input: { path: role.livePath } })).toBeUndefined();
    expect(guard.handleToolCall({ toolName: "bash", input: { command: `sha256sum '${role.canonicalPath}'` } })).toBeUndefined();
    expect(guard.handleToolCall({ toolName: "write", input: { path: join(roots.at(-1)!, "other.txt") } })).toBeUndefined();
    guard.stop();
    expect(guard.active).toBe(false);
    expect(guard.handleToolCall({ toolName: "write", input: { path: role.canonicalPath } })).toBeUndefined();
    expect(receipt(journal)).toMatchObject({ status: "prepared", mutation_guard_active: false });
    expect(lstatSync(role.livePath).isSymbolicLink()).toBe(true);
    expect(lstatSync(role.canonicalPath).isFile()).toBe(true);
    chmodSync(role.canonicalPath, 0o600);
  });
});
