import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse } from "yaml";
import compatibility from "../../compatibility.json";
import {
  createCaptureCoordinator,
  expectedTaskInput,
  observeTaskCall,
  rejectCapture,
  observeTaskResult,
  type CaptureCoordinator,
  type CaptureRoleCheck,
  type NativeTaskCallEvent,
  type NativeTaskResultEvent,
} from "./capture";
import {
  assertReviewPrConfig,
  registerReviewPrCommand,
  type ReviewPrCompatibility,
} from "./command";
import type {
  RoleIntegrityObservation,
  Wf7TaskName,
} from "./contracts";
import { buildPhaseCapabilities } from "../goal-harness/capabilities";
import { classifyCommand } from "../goal-harness/sandbox";
import type { PrReviewExec } from "./github";
import {
  createPrReviewPublishTool,
  type PrReviewPublishInput,
} from "./publish-tool";
import { ReceiptJournal } from "./receipts";
import {
  checkAllRoleFiles,
  checkAllRoleFilesAtPublish,
  checkAllRoleFilesAtRegistration,
  checkRoleForSlot,
  createRoleMutationGuard,
  loadRoleManifest,
  type LoadedRoleManifest,
  type RoleMutationGuard,
  type RoleSlotCheckOptions,
} from "./role-integrity";
import {
  createPrReviewSnapshotTool,
  type SnapshotCreateInput,
  type SnapshotReadInput,
  type SnapshotStatusInput,
  type PrReviewSnapshotTool,
} from "./snapshot-tool";
import { PrReviewStateStore } from "./state";

export type PrReviewAgentToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
};

export type PrReviewRegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  approval: "read" | "exec";
  strict: true;
  execute: (
    toolCallId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    context?: { cwd?: string },
  ) => Promise<PrReviewAgentToolResult>;
};

type HookResult = void | { block: true; reason: string };
type ExtensionHook = (
  event: NativeTaskCallEvent | NativeTaskResultEvent,
  context?: { cwd?: string },
) => HookResult | Promise<HookResult>;

export type PrReviewExtensionApi = {
  registerCommand: (name: string, options: Record<string, unknown>) => void;
  registerTool: (tool: PrReviewRegisteredTool) => void;
  on(event: "tool_call" | "tool_result", handler: ExtensionHook): void;
  on(event: "session_shutdown", handler: () => void | Promise<void>): void;
  sendMessage: (
    payload: string,
    options: { deliverAs: "nextTurn"; triggerTurn: true },
  ) => void | Promise<void>;
};

type SlotVerifier = (
  manifest: LoadedRoleManifest,
  options: RoleSlotCheckOptions,
) => unknown;

export type PrReviewExtensionOptions = {
  config?: unknown;
  runtime?: ReviewPrCompatibility;
  cwd?: string;
  exec?: PrReviewExec;
  receiptRootDir?: string;
  stateRootDir?: string;
  manifest?: LoadedRoleManifest;
  checkAtRegistration?: (
    manifest: LoadedRoleManifest,
  ) => readonly RoleIntegrityObservation[];
  checkAtPreCall?: (
    manifest: LoadedRoleManifest,
    journal: ReceiptJournal,
  ) => readonly RoleIntegrityObservation[];
  checkAtPublish?: (
    manifest: LoadedRoleManifest,
    journal: ReceiptJournal,
    previous: readonly RoleIntegrityObservation[],
  ) => readonly RoleIntegrityObservation[];
  verifySlot?: SlotVerifier;
  createGuard?: (
    manifest: LoadedRoleManifest,
    journal: ReceiptJournal,
  ) => RoleMutationGuard;
  now?: () => string;
  provisionalId?: () => string;
};

function loadConfig(): unknown {
  return parse(readFileSync(new URL("../../config.yml", import.meta.url), "utf8"));
}

function snapshotHandleFromTask(input: Record<string, unknown>): string | undefined {
  const items = Array.isArray(input.tasks) ? input.tasks : [input];
  const first = items[0];
  if (!first || typeof first !== "object" || Array.isArray(first) || !("task" in first)) {
    return undefined;
  }
  if (typeof first.task !== "string") return undefined;
  try {
    const binding: unknown = JSON.parse(first.task);
    if (
      binding &&
      typeof binding === "object" &&
      !Array.isArray(binding) &&
      "snapshot_handle" in binding &&
      typeof binding.snapshot_handle === "string"

    ) return binding.snapshot_handle;
  } catch {
    return undefined;
  }
  return undefined;
}
function agentToolResult(details: object): PrReviewAgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

function isSnapshotInput(
  input: Record<string, unknown>,
): input is SnapshotCreateInput | SnapshotReadInput | SnapshotStatusInput {
  return input.action === "create" || input.action === "read" || input.action === "status";
}

function isPublishInput(input: Record<string, unknown>): input is PrReviewPublishInput {
  return typeof input.capture_handle === "string" && typeof input.dry_run === "boolean";
}

type DirectGitHubCommand =
  | { kind: "none" }
  | { kind: "nested" }
  | { kind: "direct"; argv: string[] };

function directGitHubCommand(input: Record<string, unknown>): DirectGitHubCommand {
  const containsGitHub = (value: string) =>
    /(?:^|[\/\s'"])gh(?:[\s'"]|$)/.test(value);
  if (Array.isArray(input.argv)) {
    const argv = input.argv.filter((value): value is string => typeof value === "string");
    if (!argv.some(containsGitHub)) return { kind: "none" };
    if (basename(argv[0] ?? "") !== "gh") return { kind: "nested" };
    return { kind: "direct", argv: ["gh", ...argv.slice(1)] };
  }
  if (typeof input.command !== "string" || !containsGitHub(input.command)) {
    return { kind: "none" };
  }
  const command = input.command.trim();
  if (/(?:&&|\|\||[;<>])/.test(command)) return { kind: "nested" };
  const argv = command.split(/\s+/).map((value) => value.replace(/^['"]|['"]$/g, ""));
  if (basename(argv[0] ?? "") !== "gh") return { kind: "nested" };
  return { kind: "direct", argv: ["gh", ...argv.slice(1)] };
}

function demonstrablyReadOnlyGitHub(argv: readonly string[]): boolean {
  let index = 1;
  while (argv[index] === "-R" || argv[index] === "--repo") index += 2;
  const command = argv[index];
  if (
    ["pr", "repo", "issue", "run", "release", "workflow"].includes(command ?? "") &&
    argv[index + 1] === "view"
  ) return true;
  if (command !== "api" || argv.includes("graphql")) return false;

  let method = "GET";
  let endpoint: string | undefined;
  for (let cursor = index + 1; cursor < argv.length; cursor += 1) {
    const argument = argv[cursor]!;
    if (argument === "--method" || argument === "-X") {
      method = argv[cursor + 1]?.toUpperCase() ?? "";
      cursor += 1;
    } else if (argument.startsWith("--method=")) {
      method = argument.slice("--method=".length).toUpperCase();
    } else if (argument.startsWith("-X") && argument.length > 2) {
      method = argument.slice(2).replace(/^=/, "").toUpperCase();
    } else if (
      argument === "-f" ||
      argument === "-F" ||
      argument === "--field" ||
      argument === "--raw-field" ||
      argument === "--input" ||
      argument.startsWith("-f") ||
      argument.startsWith("-F") ||
      argument.startsWith("--field=") ||
      argument.startsWith("--raw-field=") ||
      argument.startsWith("--input=")
    ) {
      return false;
    } else if (!argument.startsWith("-") && endpoint === undefined) {
      endpoint = argument;
    }
  }
  return method === "GET" && endpoint !== undefined;
}

function retainRoleGuard(guard: RoleMutationGuard): RoleMutationGuard {
  return {
    get active() {
      return guard.active;
    },
    handleToolCall(event) {
      return guard.handleToolCall(event);
    },
    stop() {
      // Extension owns release through publisher terminal transition.
    },
  };
}

/** Pure construction seam. Runtime state remains closure-private. */
export function createPrReviewExtension(
  options: PrReviewExtensionOptions = {},
): (api: PrReviewExtensionApi) => Promise<void> {
  return async (api) => {
    const config = options.config ?? loadConfig();
    assertReviewPrConfig(config, options.runtime ?? compatibility);

    const manifest = options.manifest ?? loadRoleManifest();
    const checkAtRegistration = options.checkAtRegistration ?? checkAllRoleFilesAtRegistration;
    checkAtRegistration(manifest);

    const state = new PrReviewStateStore(
      options.stateRootDir ? { rootDir: options.stateRootDir } : {},
    );
    const journalBySnapshotCall = new Map<string, ReceiptJournal>();
    const pendingSnapshotCalls = new Set<string>();
    const active = new Set<CaptureCoordinator>();
    const coordinatorBySnapshot = new Map<string, CaptureCoordinator>();
    const coordinatorByRun = new Map<string, CaptureCoordinator>();
    const coordinatorByToolCall = new Map<string, CaptureCoordinator>();
    const journalByCoordinator = new WeakMap<CaptureCoordinator, ReceiptJournal>();
    const guardByCoordinator = new Map<CaptureCoordinator, RoleMutationGuard>();
    const coordinatorByCapture = new Map<string, CaptureCoordinator>();
    const journalByCapture = new Map<string, ReceiptJournal>();
    const lifecycleByCoordinator = new Map<CaptureCoordinator, {
      runHandle: string;
      snapshotHandle: string;
      journal: ReceiptJournal;
    }>();
    let snapshot!: PrReviewSnapshotTool;
    const teardown = (coordinator: CaptureCoordinator) => {
      const lifecycle = lifecycleByCoordinator.get(coordinator);
      if (!lifecycle) return;
      const guard = guardByCoordinator.get(coordinator);
      try {
        guard?.stop();
      } catch {
        // Receipt is already durable; teardown remains idempotent.
      }
      try {
        snapshot.cleanup(lifecycle.runHandle);
      } catch {
        // Durable receipt and route revocation must survive filesystem cleanup errors.
      }
      active.delete(coordinator);
      coordinatorByRun.delete(lifecycle.runHandle);
      coordinatorBySnapshot.delete(lifecycle.snapshotHandle);
      if (coordinator.captureHandle) {
        coordinatorByCapture.delete(coordinator.captureHandle);
        journalByCapture.delete(coordinator.captureHandle);
      }
      for (const [toolCallId, routed] of coordinatorByToolCall) {
        if (routed === coordinator) coordinatorByToolCall.delete(toolCallId);
      }
      guardByCoordinator.delete(coordinator);
      journalByCoordinator.delete(coordinator);
      lifecycleByCoordinator.delete(coordinator);
    };
    const capabilityRoot = options.cwd ?? process.cwd();
    const githubClassifierCapabilities = buildPhaseCapabilities({
      phase: "Init",
      agent: "pr-review-controller",
      runId: "extension",
      canonicalRoots: {
        repo: capabilityRoot,
        worktree: capabilityRoot,
        runTemp: state.rootDir,
      },
    });
    const checkAtPreCall = options.checkAtPreCall ?? ((loaded, journal) =>
      checkAllRoleFiles(loaded, { boundary: "pre-call", journal }));
    const verifySlot = options.verifySlot ?? checkRoleForSlot;
    const createGuard = options.createGuard ?? createRoleMutationGuard;
    const auditInvalidTaskCall = () => {
      try {
        ReceiptJournal.recordInvalidTaskCall({
          rootDir: options.receiptRootDir,
          roleManifestDigest: manifest.digest,
          now: options.now,
        });
      } catch {
        // Fail closed even if the separate audit receipt cannot be written.
      }
      return {
        block: true as const,
        reason: "Unattributed WF7 native task call blocked",
      };
    };

    snapshot = createPrReviewSnapshotTool({
      state,
      exec: options.exec,
      cwd: options.cwd,
      receiptRootDir: options.receiptRootDir,
      loadManifest: () => manifest,
      checkRoles: (loaded, journal, invocationId) => {
        if (!invocationId) throw new Error("snapshot invocation is unidentifiable");
        const observations = checkAtPreCall(loaded, journal);
        journalBySnapshotCall.set(invocationId, journal);
        return observations;
      },
      provisionalId: options.provisionalId,
      now: options.now,
    });

    const publisher = createPrReviewPublishTool({
      state,
      exec: options.exec,
      cwd: options.cwd,
      loadManifest: () => manifest,
      checkRoles: options.checkAtPublish ?? ((loaded, _journal, previous) =>
        checkAllRoleFilesAtPublish(loaded, previous)),
      journalForCapture: (captureHandle) => {
        const journal = journalByCapture.get(captureHandle);
        if (!journal) throw new Error("capture journal is unavailable");
        return journal;
      },
    });

    api.registerTool({
      name: snapshot.name,
      label: "PR review snapshot",
      description: snapshot.description,
      parameters: snapshot.parameters,
      approval: "read",
      strict: true,
      async execute(toolCallId, input, signal) {
        if (!isSnapshotInput(input)) {
          const rejected = await snapshot.execute(
            input as SnapshotCreateInput,
            toolCallId,
            signal,
          );
          return agentToolResult(rejected);
        }
        if (input.action === "create") pendingSnapshotCalls.add(toolCallId);
        const related = input.action === "read" && typeof input.snapshot_handle === "string"
          ? coordinatorBySnapshot.get(input.snapshot_handle)
          : input.action === "status" && typeof input.run_handle === "string"
          ? coordinatorByRun.get(input.run_handle)
          : undefined;
        let createdRunHandle: string | undefined;
        try {
          const result = await snapshot.execute(input, toolCallId, signal);
          if (input.action === "create" && result.status === "created") {
            createdRunHandle = result.run_handle;
            const journal = journalBySnapshotCall.get(toolCallId);
            if (!journal) throw new Error("snapshot receipt journal was not initialized");
            const immutable = state.lookupSnapshot(result.snapshot_handle);
            const callNonces = Object.fromEntries(
              result.call_nonces.map((entry) => [entry.task, entry.call_nonce]),
            ) as Record<Wf7TaskName, string>;
            const roleGuard = createGuard(manifest, journal);
            const coordinator = createCaptureCoordinator({
              state,
              journal,
              guard: retainRoleGuard(roleGuard),
              releaseGuardOnCompletion: false,
              cleanupStateOnFailure: false,
              snapshot: immutable,
              callNonces,
              verifyRole: (check: CaptureRoleCheck) => {
                verifySlot(manifest, {
                  taskName: check.taskName,
                  task: check.task,
                  settlement: check.settlement,
                  journal,
                  previousObservations: journal.currentReceipt.roles,
                });
              },
              now: options.now,
            });
            active.add(coordinator);
            coordinatorBySnapshot.set(result.snapshot_handle, coordinator);
            coordinatorByRun.set(result.run_handle, coordinator);
            journalByCoordinator.set(coordinator, journal);
            guardByCoordinator.set(coordinator, roleGuard);
            lifecycleByCoordinator.set(coordinator, {
              runHandle: result.run_handle,
              snapshotHandle: result.snapshot_handle,
              journal,
            });
            journalBySnapshotCall.delete(toolCallId);
            pendingSnapshotCalls.delete(toolCallId);
            snapshot.finishCreate(toolCallId);
            return agentToolResult(Object.freeze({
              ...result,
              next_task: expectedTaskInput(coordinator),
            }));
          }
          if (input.action === "status" && result.status === "pending") {
            const coordinator = coordinatorByRun.get(input.run_handle);
            if (coordinator?.status === "active") {
              return agentToolResult(Object.freeze({
                ...result,
                next_task: expectedTaskInput(coordinator),
              }));
            }
          }
          return agentToolResult(result);
        } catch (error) {
          const journal = journalBySnapshotCall.get(toolCallId);
          journalBySnapshotCall.delete(toolCallId);
          pendingSnapshotCalls.delete(toolCallId);
          snapshot.finishCreate(toolCallId);
          if (journal?.currentReceipt.status === "prepared") {
            try {
              journal.fail(
                "internal_error",
                error instanceof Error ? error.message : "snapshot registration failed",
              );
            } catch {
              // Preserve the original snapshot error.
            }
          }
          if (createdRunHandle) snapshot.cleanup(createdRunHandle);
          if (
            related
            && ["failed", "dry_run", "published", "indeterminate"].includes(
              lifecycleByCoordinator.get(related)?.journal.currentReceipt.status ?? "",
            )
          ) teardown(related);
          throw error;
        }
      },
    });

    api.registerTool({
      name: publisher.name,
      label: "Publish PR review",
      description: publisher.description,
      parameters: publisher.parameters,
      approval: "exec",
      strict: true,
      async execute(_toolCallId, input, signal) {
        const coordinator = isPublishInput(input)
          ? coordinatorByCapture.get(input.capture_handle)
          : undefined;
        const journal = isPublishInput(input)
          ? journalByCapture.get(input.capture_handle)
          : undefined;
        try {
          const result = !isPublishInput(input)
            ? await publisher.execute(input as PrReviewPublishInput, signal)
            : await publisher.execute(input, signal);
          return agentToolResult(result);
        } finally {
          if (
            coordinator &&
            journal &&
            ["dry_run", "published", "failed", "indeterminate"].includes(
              journal.currentReceipt.status,
            )
          ) teardown(coordinator);
        }
      },
    });

    api.on("tool_call", (rawEvent, context) => {
      if (rawEvent.type !== "tool_call") return undefined;
      const event: NativeTaskCallEvent = {
        ...rawEvent,
        cwd: rawEvent.cwd ?? context?.cwd,
      };
      if (guardByCoordinator.size > 0 && event.toolName !== "pr_review_publish") {
        const github = directGitHubCommand(event.input);
        if (github.kind === "nested") {
          return {
            block: true,
            reason: "GitHub command nested in shell denied during active WF7 run",
          };
        }
        if (github.kind === "direct") {
          const classification = classifyCommand(githubClassifierCapabilities, github.argv);
          if (!classification.allow) {
            return {
              block: true,
              reason: `GitHub command denied: ${classification.reason}`,
            };
          }
          if (classification.operation === "gh.pr.inline-review") {
            return {
              block: true,
              reason: "GitHub mutation requires gh.pr.inline-review inside pr_review_publish",
            };
          }
          if (!demonstrablyReadOnlyGitHub(github.argv)) {
            return {
              block: true,
              reason: "GitHub command is not demonstrably read-only during active WF7 run",
            };
          }
        }
      }
      if (event.toolName === "task") {
        if (
          lifecycleByCoordinator.size === 0
          && pendingSnapshotCalls.size === 0
        ) return undefined;
        const handle = snapshotHandleFromTask(event.input);
        let coordinator = handle
          ? coordinatorBySnapshot.get(handle)
          : undefined;
        if (!coordinator && pendingSnapshotCalls.size > 0) {
          if (
            !handle
            && pendingSnapshotCalls.size === 1
            && lifecycleByCoordinator.size === 0
          ) {
            const invocationId = pendingSnapshotCalls.values().next().value as string;
            snapshot.cancelCreate(
              invocationId,
              "task_envelope_invalid",
              "native task call arrived before snapshot create completed",
            );
            pendingSnapshotCalls.delete(invocationId);
            journalBySnapshotCall.delete(invocationId);
            return {
              block: true,
              reason: "Invalid WF7 task envelope during snapshot creation",
            };
          }
          return auditInvalidTaskCall();
        }
        if (
          !handle
          && lifecycleByCoordinator.size === 1
        ) {
          coordinator = lifecycleByCoordinator.keys().next().value as CaptureCoordinator;
        }
        if (!coordinator) return auditInvalidTaskCall();
        const routed = coordinatorByToolCall.get(event.toolCallId);
        const result = routed && routed !== coordinator
          ? rejectCapture(
            coordinator,
            "task_envelope_invalid",
            "duplicate native task call identifier",
          )
          : observeTaskCall(coordinator, event);
        if (!result && coordinator.status === "active") {
          coordinatorByToolCall.set(event.toolCallId, coordinator);
        }
        if (coordinator.status === "failed") teardown(coordinator);
        else if (coordinator.status !== "active") active.delete(coordinator);
        return result;
      }

      let blocked: { block: true; reason: string } | undefined;
      for (const coordinator of active) {
        const result = observeTaskCall(coordinator, event);
        if (result) blocked = result;
        if (coordinator.status === "failed") teardown(coordinator);
        else if (coordinator.status !== "active") active.delete(coordinator);
      }
      for (const [coordinator, guard] of guardByCoordinator) {
        if (coordinator.status !== "completed") continue;
        const result = guard.handleToolCall(event);
        if (result) {
          blocked = rejectCapture(
            coordinator,
            "role_mutation_denied",
            result.reason,
          );
          teardown(coordinator);
        }
      }
      return blocked;
    });

    api.on("tool_result", (rawEvent) => {
      if (rawEvent.type !== "tool_result" || rawEvent.toolName !== "task") return undefined;
      const coordinator = coordinatorByToolCall.get(rawEvent.toolCallId);
      if (!coordinator) return undefined;
      coordinatorByToolCall.delete(rawEvent.toolCallId);
      observeTaskResult(coordinator, rawEvent);
      if (coordinator.status === "completed" && coordinator.captureHandle) {
        const journal = journalByCoordinator.get(coordinator);
        if (journal) journalByCapture.set(coordinator.captureHandle, journal);
        coordinatorByCapture.set(coordinator.captureHandle, coordinator);
      }
      if (coordinator.status === "failed") teardown(coordinator);
      else if (coordinator.status !== "active") active.delete(coordinator);
      return undefined;
    });

    api.on("session_shutdown", async () => {
      for (const [coordinator, lifecycle] of [...lifecycleByCoordinator]) {
        if (
          !["failed", "dry_run", "published", "indeterminate"].includes(
            lifecycle.journal.currentReceipt.status,
          )
        ) {
          try {
            lifecycle.journal.fail(
              "internal_error",
              "WF7 session shut down before terminal publication",
              { mutation_guard_active: false },
            );
          } catch {
            // Teardown must still revoke every live handle.
          }
        }
        teardown(coordinator);
      }
      const settlements: Promise<void>[] = [];
      for (const invocationId of pendingSnapshotCalls) {
        const settlement = snapshot.cancelCreate(
          invocationId,
          "internal_error",
          "WF7 session shut down during snapshot creation",
        );
        if (settlement) settlements.push(settlement);
        const journal = journalBySnapshotCall.get(invocationId);
        if (!settlement && journal?.currentReceipt.status === "prepared") {
          try {
            journal.fail(
              "internal_error",
              "WF7 session shut down during snapshot creation",
              { mutation_guard_active: false },
            );
          } catch {
            // Pending state revocation remains mandatory.
          }
        }
        journalBySnapshotCall.delete(invocationId);
      }
      pendingSnapshotCalls.clear();
      journalBySnapshotCall.clear();
      await Promise.allSettled(settlements);
      snapshot.retryCleanup();
    });

    registerReviewPrCommand(api, config, options.runtime ?? compatibility);
  };
}

export default async function prReviewExtension(
  api: PrReviewExtensionApi,
  options: PrReviewExtensionOptions = {},
): Promise<void> {
  await createPrReviewExtension(options)(api);
}
