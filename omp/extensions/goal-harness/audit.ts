/**
 * Soft-sandbox audit + OMP approval preflight + tool_call interception.
 * Denials and one-run approvals go through Beads broker; never global policy.
 */

import type { PhaseCapabilityManifest } from "./capabilities";
import {
  classifyCommand,
  classifyPathAccess,
  resolveWritableCachePath,
  type SandboxDecision,
} from "./sandbox";

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

export type ApprovalMode = string;

export type OmpToolsConfig = {
  approvalMode?: ApprovalMode;
  /** Per-tool policy map; missing or "auto-approve-all" is incompatible */
  tools?: Record<string, { approval?: string } | string>;
  /** Extension guard flag */
  extensionGuard?: boolean;
};

export type CompatibilityContract = {
  settings: string[];
};

export type AuditEvent = {
  at: string;
  runId: string;
  phase: string;
  agent: string;
  issueId: string;
  kind: "deny" | "allow" | "approval";
  tool: string;
  decision: SandboxDecision;
  /** One-run approval id; never global */
  approvalId?: string;
};

export type RunApproval = {
  id: string;
  runId: string;
  tool: string;
  pathOrCommand: string;
  /** Does not survive past run end */
  expiresWithRun: true;
};

export type BeadsAuditSink = {
  appendNotes: (issueId: string, notes: string) => void | Promise<void>;
};

const INCOMPATIBLE_APPROVAL = new Set([
  "never",
  "auto",
  "auto-approve",
  "auto-approve-all",
  "off",
  "",
]);

/**
 * At harness entry: verify tools.approvalMode + per-tool policy + extension guard.
 */
export function preflightOmpApprovalConfig(
  config: OmpToolsConfig,
  compatibility: CompatibilityContract,
): { ok: true } | { ok: false; reason: string } {
  if (!compatibility.settings.includes("tools.approvalMode")) {
    return {
      ok: false,
      reason: "compatibility contract missing tools.approvalMode",
    };
  }
  const mode = config.approvalMode;
  if (mode == null || INCOMPATIBLE_APPROVAL.has(String(mode).toLowerCase())) {
    return {
      ok: false,
      reason: `incompatible/missing tools.approvalMode: ${String(mode)}`,
    };
  }
  // require non-permissive modes like always-ask / on-failure / manual
  const okModes = new Set([
    "always-ask",
    "on-failure",
    "manual",
    "ask",
    "strict",
  ]);
  if (!okModes.has(String(mode).toLowerCase())) {
    // allow unknown strict-looking modes that aren't in deny list — still require explicit
    if (String(mode).toLowerCase().includes("auto")) {
      return {
        ok: false,
        reason: `permissive tools.approvalMode rejected: ${mode}`,
      };
    }
  }
  if (config.extensionGuard === false) {
    return { ok: false, reason: "extension guard missing/disabled" };
  }
  if (config.tools) {
    for (const [name, pol] of Object.entries(config.tools)) {
      const ap =
        typeof pol === "string"
          ? pol
          : pol && typeof pol === "object"
            ? pol.approval
            : undefined;
      if (ap && INCOMPATIBLE_APPROVAL.has(String(ap).toLowerCase())) {
        return {
          ok: false,
          reason: `per-tool policy incompatible for ${name}: ${ap}`,
        };
      }
    }
  }
  return { ok: true };
}

export type ToolCallRequest = {
  tool: string;
  argv?: string[];
  path?: string;
  mode?: "read" | "write";
};

export type InterceptorState = {
  manifest: PhaseCapabilityManifest;
  runApprovals: Map<string, RunApproval>;
  events: AuditEvent[];
  sink?: BeadsAuditSink;
};

export function createInterceptor(
  manifest: PhaseCapabilityManifest,
  sink?: BeadsAuditSink,
): InterceptorState {
  return {
    manifest,
    runApprovals: new Map(),
    events: [],
    sink,
  };
}

function record(
  state: InterceptorState,
  kind: AuditEvent["kind"],
  tool: string,
  decision: SandboxDecision,
  approvalId?: string,
): void {
  const ev: AuditEvent = {
    at: new Date().toISOString(),
    runId: state.manifest.runId,
    phase: state.manifest.phase,
    agent: state.manifest.agent,
    issueId: state.manifest.issueId,
    kind,
    tool,
    decision,
    approvalId,
  };
  state.events.push(ev);
  if (state.sink) {
    void state.sink.appendNotes(
      state.manifest.issueId || state.manifest.runId,
      `sandbox:${kind} tool=${tool} allow=${decision.allow} ${decision.reason}`,
    );
  }
}

/**
 * Fail-closed tool_call handler: check against current manifest.
 */
export function interceptToolCall(
  state: InterceptorState,
  req: ToolCallRequest,
): SandboxDecision {
  let decision: SandboxDecision;

  if (req.argv?.length) {
    decision = classifyCommand(state.manifest, req.argv);
  } else if (req.path) {
    decision = classifyPathAccess(
      state.manifest,
      req.path,
      req.mode ?? "read",
    );
  } else {
    decision = {
      allow: false,
      reason: "unclassifiable tool call (no argv/path)",
    };
  }

  // One-run approval can override deny for exact tool+target
  if (!decision.allow) {
    const key = approvalKey(req);
    const ap = state.runApprovals.get(key);
    if (ap && ap.runId === state.manifest.runId) {
      decision = {
        allow: true,
        reason: `one-run approval ${ap.id}`,
        operation: decision.operation,
        resolvedPath: decision.resolvedPath,
      };
      record(state, "approval", req.tool, decision, ap.id);
      return decision;
    }
    record(state, "deny", req.tool, decision);
    return decision;
  }

  record(state, "allow", req.tool, decision);
  return decision;
}

function approvalKey(req: ToolCallRequest): string {
  return `${req.tool}::${req.argv?.join(" ") ?? req.path ?? ""}`;
}

/**
 * Grant exact one-run approval. Never mutates global policy; dies with run.
 */
export function grantRunApproval(
  state: InterceptorState,
  req: ToolCallRequest,
  approvalId: string,
): RunApproval {
  const ap: RunApproval = {
    id: approvalId,
    runId: state.manifest.runId,
    tool: req.tool,
    pathOrCommand: req.argv?.join(" ") ?? req.path ?? "",
    expiresWithRun: true,
  };
  state.runApprovals.set(approvalKey(req), ap);
  record(
    state,
    "approval",
    req.tool,
    { allow: true, reason: "granted one-run approval" },
    approvalId,
  );
  if (state.sink) {
    void state.sink.appendNotes(
      state.manifest.issueId || state.manifest.runId,
      `sandbox:approval id=${approvalId} tool=${req.tool} run=${state.manifest.runId}`,
    );
  }
  return ap;
}

/** End of run: drop all one-run approvals. */
export function clearRunApprovals(state: InterceptorState): void {
  state.runApprovals.clear();
}

export function cachePathForLane(
  state: InterceptorState,
  cacheName: string,
): SandboxDecision {
  return resolveWritableCachePath(state.manifest, cacheName);
}
