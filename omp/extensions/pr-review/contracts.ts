export const PR_REVIEW_PROTOCOL_VERSION = 1 as const;
export const PR_REVIEW_SCHEMA_VERSION = 1 as const;
export const PR_REVIEW_ROLE_MANIFEST_VERSION = 1 as const;
export const PR_REVIEW_MARKER_NAMESPACE = "dotfiles-pr-review" as const;

export const PR_REVIEW_SUMMARY_BODIES = {
  COMMENT: "Automated review completed; findings are inline.",
  REQUEST_CHANGES:
    "Automated review requests changes; findings are inline.",
  APPROVE: "Automated review completed; no publishable findings.",
} as const;

export const PR_REVIEW_ROLE_SPECS = [
  {
    livePath: "~/.omp/agent/agents/pr-fable-reviewer.md",
    canonicalPath: "/Users/legolas/.dotfiles/omp/agents/pr-fable-reviewer.md",
    agent: "pr-fable-reviewer",
    model: "anthropic/claude-fable-5:max",
  },
  {
    livePath: "~/.omp/agent/agents/pr-sol-reviewer.md",
    canonicalPath: "/Users/legolas/.dotfiles/omp/agents/pr-sol-reviewer.md",
    agent: "pr-sol-reviewer",
    model: "openai-codex/gpt-5.6-sol:xhigh",
  },
  {
    livePath: "~/.omp/agent/agents/pr-grok-judge.md",
    canonicalPath: "/Users/legolas/.dotfiles/omp/agents/pr-grok-judge.md",
    agent: "pr-grok-judge",
    model: "xai-oauth/grok-4.5:xhigh",
  },
] as const;

export const PR_REVIEW_TASK_SLOTS = [
  {
    stage: "initial",
    name: "pr-fable-initial",
    agent: "pr-fable-reviewer",
  },
  {
    stage: "initial",
    name: "pr-sol-initial",
    agent: "pr-sol-reviewer",
  },
  {
    stage: "rebuttal",
    name: "pr-fable-rebuttal",
    agent: "pr-fable-reviewer",
  },
  {
    stage: "rebuttal",
    name: "pr-sol-rebuttal",
    agent: "pr-sol-reviewer",
  },
  {
    stage: "judge",
    name: "pr-grok-judge",
    agent: "pr-grok-judge",
  },
] as const;

export type PrReviewFailureCode =
  | "invalid_arguments"
  | "incompatible_runtime"
  | "invalid_config"
  | "auth_failed"
  | "target_resolution_failed"
  | "pr_not_open"
  | "snapshot_incomplete"
  | "diff_too_large"
  | "role_integrity_drift"
  | "role_mutation_denied"
  | "project_shadow"
  | "task_envelope_invalid"
  | "task_result_invalid"
  | "task_failed"
  | "task_cancelled"
  | "route_mismatch"
  | "model_fallback"
  | "structured_output_invalid"
  | "binding_mismatch"
  | "anchor_invalid"
  | "permission_denied"
  | "self_review_denied"
  | "stale_head"
  | "same_head_conflict"
  | "rate_limited"
  | "github_api_failed"
  | "publication_indeterminate"
  | "published_on_superseded_head"
  | "internal_error";

export type PrReviewRoleSpec = (typeof PR_REVIEW_ROLE_SPECS)[number];
export type PrReviewAgentName = PrReviewRoleSpec["agent"];
export type PrReviewModel = PrReviewRoleSpec["model"];
export type PrReviewTaskSlot = (typeof PR_REVIEW_TASK_SLOTS)[number];
export type PrReviewTaskName = PrReviewTaskSlot["name"];
export type PrReviewStage = PrReviewTaskSlot["stage"];

export interface PrReviewTaskBinding {
  schema_version: typeof PR_REVIEW_SCHEMA_VERSION;
  stage: PrReviewStage;
  run_nonce: string;
  snapshot_nonce: string;
  call_nonce: string;
  snapshot_handle: string;
  head_sha: string;
  diff_digest: string;
  stage_data: unknown;
}

export interface PrReviewTaskItem {
  name: PrReviewTaskName;
  agent: PrReviewAgentName;
  task: string;
  outputSchema: unknown;
  schemaMode: "strict";
  isolated: true;
}

export interface TaskSlotExpectation {
  slot: PrReviewTaskName;
  stage: PrReviewStage;
  name: PrReviewTaskName;
  agent: PrReviewAgentName;
  schemaSha256: string;
  runNonce: string;
  snapshotNonce: string;
  callNonce: string;
  snapshotHandle: string;
  headSha: string;
  diffDigest: string;
  nativeToolCallId: string;
}

export interface StructuredSubagentOutput {
  source: "caller" | "agent" | "session" | "none";
  mode: "permissive" | "strict";
  status: "valid" | "invalid" | "unavailable";
  data?: unknown;
  error?: string;
}

export interface NativeSingleResult {
  index: number;
  id: string;
  agent: string;
  agentSource: "bundled" | "user" | "project";
  task: string;
  exitCode: number;
  output: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  tokens: number;
  requests: number;
  assignment?: string;
  structuredOutput?: StructuredSubagentOutput;
  modelOverride?: string | string[];
  resolvedModel?: string;
  resolvedModelIsFallback?: boolean;
  error?: string;
  aborted?: boolean;
  abortReason?: string;
  outputPath?: string;
}

export interface SingleResultEvidence {
  task: PrReviewTaskName;
  agent: PrReviewAgentName;
  agentSource: "user";
  resolvedModel: PrReviewModel;
  resolvedModelIsFallback: false;
  exitCode: 0;
  aborted: false;
  structuredOutput: {
    source: "caller";
    mode: "strict";
    status: "valid";
    data: unknown;
    error?: never;
  };
  schemaValid: true;
}

export interface SealedTaskResult extends TaskSlotExpectation {
  nativeResultId: string;
  result: Readonly<NativeSingleResult>;
  evidence: Readonly<SingleResultEvidence>;
  outputDigest: string;
}

export interface ReviewAnchor {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
}

export interface SnapshotChangedFile {
  path: string;
  status: string;
  patchComplete: boolean;
  reviewable: boolean;
}

export interface SnapshotReviewableLine extends ReviewAnchor {
  hunk: number;
}

export interface SnapshotNonreviewableEntry {
  path: string;
  reason: "binary" | "submodule" | "missing_patch";
}

export interface ImmutableSnapshot {
  runHandle: string;
  snapshotHandle: string;
  runNonce: string;
  snapshotNonce: string;
  owner: string;
  repo: string;
  pullNumber: number;
  repositoryNodeId: string;
  baseSha: string;
  headSha: string;
  diffDigest: string;
  diffBytes: Uint8Array;
  changedFiles: readonly SnapshotChangedFile[];
  lineMap: readonly SnapshotReviewableLine[];
  nonreviewableEntries: readonly SnapshotNonreviewableEntry[];
}

export interface CompletedCapture {
  captureHandle: string;
  snapshot: Readonly<ImmutableSnapshot>;
  results: readonly [
    SealedTaskResult,
    SealedTaskResult,
    SealedTaskResult,
    SealedTaskResult,
    SealedTaskResult,
  ];
  completedAt: string;
}

export type PrReviewReceiptStatus =
  | "prepared"
  | "published"
  | "dry_run"
  | "failed"
  | "indeterminate";

export interface RoleIntegrityObservation {
  agent: PrReviewAgentName;
  livePath: string;
  checkedRealpath?: string;
  preCallSha256?: string;
  prePublishSha256?: string;
  preCallValid: boolean;
  prePublishValid?: boolean;
}

export interface ReceiptTaskEvidence {
  stage: PrReviewStage;
  task: PrReviewTaskName;
  agent: PrReviewAgentName;
  nonceDigest: string;
  nativeToolCallId: string;
  nativeResultId: string;
  agentSource: "user";
  requestedModel: PrReviewModel;
  resolvedModel: PrReviewModel;
  resolvedModelIsFallback: false;
  schemaSha256: string;
  structuredOutputSource: "caller";
  structuredOutputMode: "strict";
  structuredOutputStatus: "valid";
  outputDigest: string;
}

export interface PrReviewReceiptV1 {
  protocol_version: typeof PR_REVIEW_PROTOCOL_VERSION;
  schema_version: typeof PR_REVIEW_SCHEMA_VERSION;
  role_manifest_version: typeof PR_REVIEW_ROLE_MANIFEST_VERSION;
  status: PrReviewReceiptStatus;
  run_key: string;
  owner: string;
  repo: string;
  pull_number: number;
  base_sha?: string;
  head_sha?: string;
  snapshot_digest?: string;
  diff_digest?: string;
  started_at: string;
  updated_at: string;
  authenticated_actor?: string;
  role_manifest_digest: string;
  roles: readonly RoleIntegrityObservation[];
  tasks: readonly ReceiptTaskEvidence[];
  mutation_guard_active: boolean;
  completed_capture_digest?: string;
  adjudication_counts?: Readonly<{
    accept: number;
    reject: number;
    request_changes: number;
  }>;
  event?: keyof typeof PR_REVIEW_SUMMARY_BODIES;
  payload_digest?: string;
  github_review_id?: number;
  github_inline_comment_ids?: readonly number[];
  github_inline_comment_markers?: readonly string[];
  post_publish_head_sha?: string;
  published_on_superseded_head?: boolean;
  failure_code?: PrReviewFailureCode;
  failure_message?: string;
}

const OPAQUE_HANDLE_SCHEMA = {
  type: "string",
  minLength: 32,
  maxLength: 256,
} as const;

export const PR_REVIEW_SNAPSHOT_PARAMETERS_SCHEMA = {
  type: "object",
  oneOf: [
    {
      type: "object",
      properties: {
        action: { const: "create" },
        target: { type: "string", minLength: 1, maxLength: 512 },
        dry_run: { type: "boolean" },
      },
      required: ["action", "target", "dry_run"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: { const: "read" },
        snapshot_handle: OPAQUE_HANDLE_SCHEMA,
        offset: { type: "integer", minimum: 0 },
        length: { type: "integer", minimum: 1, maximum: 65_536 },
      },
      required: ["action", "snapshot_handle", "offset", "length"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: { const: "status" },
        run_handle: OPAQUE_HANDLE_SCHEMA,
      },
      required: ["action", "run_handle"],
      additionalProperties: false,
    },
  ],
} as const;

export const PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA = {
  type: "object",
  properties: {
    capture_handle: OPAQUE_HANDLE_SCHEMA,
    dry_run: { type: "boolean" },
  },
  required: ["capture_handle", "dry_run"],
  additionalProperties: false,
} as const;
