import { createHash } from "node:crypto";
import {
  PR_REVIEW_MARKER_NAMESPACE,
  PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA,
  WF7_ROLE_SPECS,
  type CompletedCapture,
  type PrReviewFailureCode,
  type RoleIntegrityObservation,
} from "./contracts";
import {
  GitHubPublishError,
  GitHubReadClient,
  GitHubReadError,
  PrReviewPublish,
  DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS,
  defaultPrReviewExec,
  type PrReviewExec,
  type PublishedReview,
} from "./github";
import {
  buildReviewPlanFromCapture,
  type ReviewEvent,
  type ReviewPlan,
} from "./publisher";
import type { ReceiptJournal } from "./receipts";
import {
  RoleIntegrityError,
  checkAllRoleFilesAtPublish,
  loadRoleManifest,
  type LoadedRoleManifest,
} from "./role-integrity";
import type { PrReviewStateStore } from "./state";

export interface PrReviewPublishInput {
  capture_handle: string;
  dry_run: boolean;
}

export interface PrReviewPublishResult {
  status: "dry_run" | "published" | "existing";
  event: ReviewEvent;
  payload_digest: string;
  comment_count: number;
  github_review_id?: number;
  github_inline_comment_ids?: readonly number[];
  published_on_superseded_head?: boolean;
}

export interface PrReviewPublishTool {
  readonly name: "pr_review_publish";
  readonly description: string;
  readonly parameters: typeof PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA;
  execute(
    input: PrReviewPublishInput,
    signal?: AbortSignal,
  ): Promise<PrReviewPublishResult>;
}

export interface PrReviewPublishToolOptions {
  state: Pick<PrReviewStateStore, "lookupCapture">;
  journalForCapture: (captureHandle: string) => ReceiptJournal;
  exec?: PrReviewExec;
  cwd?: string;
  loadManifest?: () => LoadedRoleManifest;
  checkRoles?: (
    manifest: LoadedRoleManifest,
    journal: ReceiptJournal,
    previous: readonly RoleIntegrityObservation[],
  ) => readonly RoleIntegrityObservation[];
}

interface ExistingReview {
  reviewId: number;
  inlineCommentIds: readonly number[];
}

interface UncertainPublication {
  event: ReviewEvent;
  payloadDigest: string;
  inlineCommentMarkers: readonly string[];
  reviewId?: number;
  inlineCommentIds?: readonly number[];
}

export class PrReviewPublishError extends Error {
  readonly code: PrReviewFailureCode;

  constructor(code: PrReviewFailureCode, message: string) {
    super(message);
    this.name = "PrReviewPublishError";
    this.code = code;
  }
}


function inspectExisting(
  reviews: readonly Record<string, unknown>[],
  comments: readonly Record<string, unknown>[],
  actor: string,
  plan: ReviewPlan,
): ExistingReview | "conflict" | undefined {
  const authored = reviews.filter((review) => {
    const user = review.user;
    return !!user
      && typeof user === "object"
      && !Array.isArray(user)
      && typeof (user as Record<string, unknown>).login === "string"
      && ((user as Record<string, unknown>).login as string).toLowerCase() === actor.toLowerCase()
      && typeof review.body === "string"
      && review.body.includes(plan.runMarker);
  });
  if (authored.length === 0) return undefined;
  if (authored.length !== 1) return "conflict";
  const review = authored[0]!;
  const reviewId = Number.isSafeInteger(review.id) && Number(review.id) > 0
    ? Number(review.id)
    : undefined;
  const rawState = review.state ?? review.event;
  const remoteEvent = rawState === "APPROVED" || rawState === "APPROVE"
    ? "APPROVE"
    : rawState === "CHANGES_REQUESTED" || rawState === "REQUEST_CHANGES"
    ? "REQUEST_CHANGES"
    : rawState === "COMMENTED" || rawState === "COMMENT"
    ? "COMMENT"
    : undefined;
  if (
    reviewId === undefined
    || remoteEvent !== plan.event
    || review.commit_id !== plan.payload.commit_id
    || review.body !== plan.payload.body
  ) return "conflict";

  const namespaced = comments.filter((comment) => {
    const user = comment.user;
    return comment.pull_request_review_id === reviewId
      && !!user
      && typeof user === "object"
      && !Array.isArray(user)
      && typeof (user as Record<string, unknown>).login === "string"
      && ((user as Record<string, unknown>).login as string).toLowerCase() === actor.toLowerCase()
      && typeof comment.body === "string"
      && comment.body.includes(`<!-- ${PR_REVIEW_MARKER_NAMESPACE}:finding:`);
  });
  if (namespaced.length !== plan.payload.comments.length) return "conflict";
  const inlineCommentIds: number[] = [];
  for (const planned of plan.payload.comments) {
    const matches = namespaced.filter((comment) =>
      comment.path === planned.path
      && comment.line === planned.line
      && comment.side === planned.side
      && comment.body === planned.body
      && (planned.start_line === undefined
        ? comment.start_line === undefined || comment.start_line === null
        : comment.start_line === planned.start_line && comment.start_side === planned.start_side)
    );
    if (matches.length !== 1) return "conflict";
    const id = Number.isSafeInteger(matches[0]!.id) && Number(matches[0]!.id) > 0
      ? Number(matches[0]!.id)
      : undefined;
    if (id === undefined) return "conflict";
    inlineCommentIds.push(id);
  }
  return Object.freeze({ reviewId, inlineCommentIds: Object.freeze(inlineCommentIds) });
}

function normalized(error: unknown, fallback: PrReviewFailureCode): PrReviewPublishError {
  if (error instanceof PrReviewPublishError) return error;
  if (
    error instanceof GitHubReadError
    || error instanceof GitHubPublishError
    || error instanceof RoleIntegrityError
  ) return new PrReviewPublishError(error.code, error.message);
  return new PrReviewPublishError(
    fallback,
    error instanceof Error ? error.message : "PR review publication failed",
  );
}

const RECONCILIATION_TIMEOUT_MS = 30_000;

class PublishTool implements PrReviewPublishTool {
  readonly name = "pr_review_publish" as const;
  readonly description = "Publish one validated, deduplicated grouped GitHub pull-request review.";
  readonly parameters = PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA;
  readonly #state: PrReviewPublishToolOptions["state"];
  readonly #journalForCapture: PrReviewPublishToolOptions["journalForCapture"];
  readonly #exec: PrReviewExec;
  readonly #cwd?: string;
  readonly #loadManifest: () => LoadedRoleManifest;
  readonly #checkRoles: NonNullable<PrReviewPublishToolOptions["checkRoles"]>;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #uncertain = new Map<string, UncertainPublication>();

  constructor(options: PrReviewPublishToolOptions) {
    this.#state = options.state;
    this.#journalForCapture = options.journalForCapture;
    this.#exec = options.exec ?? defaultPrReviewExec;
    this.#cwd = options.cwd;
    this.#loadManifest = options.loadManifest ?? loadRoleManifest;
    this.#checkRoles = options.checkRoles ?? ((manifest, _journal, previous) =>
      checkAllRoleFilesAtPublish(manifest, previous));
  }

  async execute(
    input: PrReviewPublishInput,
    signal?: AbortSignal,
  ): Promise<PrReviewPublishResult> {
    if (
      !input
      || typeof input !== "object"
      || Array.isArray(input)
      || Object.keys(input).length !== 2
      || !Object.hasOwn(input, "capture_handle")
      || !Object.hasOwn(input, "dry_run")
      || typeof input.capture_handle !== "string"
      || input.capture_handle.length < 32
      || input.capture_handle.length > 256
      || typeof input.dry_run !== "boolean"
    ) throw new PrReviewPublishError("invalid_arguments", "publish input is invalid");

    let capture: Readonly<CompletedCapture>;
    try {
      capture = this.#state.lookupCapture(input.capture_handle);
      if (capture.captureHandle !== input.capture_handle) throw new Error("capture handle mismatch");
    } catch {
      throw new PrReviewPublishError("invalid_arguments", "capture handle is not a live completed capture");
    }

    let journal: ReceiptJournal;
    try {
      journal = this.#journalForCapture(input.capture_handle);
    } catch (error) {
      throw normalized(error, "internal_error");
    }

    const lockKey = journal.currentReceipt.run_key ?? input.capture_handle;
    const prior = this.#locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate);
    this.#locks.set(lockKey, tail);
    await prior;
    try {
      return await this.#executeLocked(input, capture, journal, signal);
    } finally {
      release();
      if (this.#locks.get(lockKey) === tail) {
        this.#locks.delete(lockKey);
      }
    }
  }

  async #executeLocked(
    input: PrReviewPublishInput,
    capture: Readonly<CompletedCapture>,
    journal: ReceiptJournal,
    signal?: AbortSignal,
  ): Promise<PrReviewPublishResult> {
    try {
      if (signal?.aborted) {
        throw new PrReviewPublishError("task_cancelled", "PR review publication was cancelled before POST");
      }
      const plan = buildReviewPlanFromCapture(capture);
      const currentReceipt = journal.currentReceipt;
      if (
        currentReceipt.owner !== capture.snapshot.owner
        || currentReceipt.repo !== capture.snapshot.repo
        || currentReceipt.pull_number !== capture.snapshot.pullNumber
        || currentReceipt.head_sha !== capture.snapshot.headSha
        || currentReceipt.run_key !== plan.runKey
      ) throw new PrReviewPublishError("binding_mismatch", "capture does not match its publication receipt");

      let manifest: LoadedRoleManifest;
      let roleObservations: readonly RoleIntegrityObservation[];
      try {
        manifest = this.#loadManifest();
        if (manifest.digest !== currentReceipt.role_manifest_digest) {
          throw new PrReviewPublishError("role_integrity_drift", "WF7 role manifest changed before publication");
        }
        roleObservations = this.#checkRoles(manifest, journal, currentReceipt.roles);
      } catch (error) {
        if (
          error instanceof RoleIntegrityError
          && journal.currentReceipt.status === "prepared"
        ) {
          const failedObservation = error.observation;
          const failedRoles = error.observations ?? (failedObservation
            ? currentReceipt.roles.map((role) =>
              role.agent === failedObservation.agent ? failedObservation : role
            )
            : undefined);
          if (failedRoles) journal.prepare({ roles: failedRoles });
        }
        throw normalized(error, "role_integrity_drift");
      }
      if (
        roleObservations.length !== WF7_ROLE_SPECS.length
        || WF7_ROLE_SPECS.some((role) => !roleObservations.some((observation) =>
          observation.agent === role.agent && observation.preCallValid && observation.prePublishValid
        ))
      ) throw new PrReviewPublishError("role_integrity_drift", "WF7 role integrity recheck was incomplete");

      const github = new GitHubReadClient({
        exec: this.#exec,
        cwd: this.#cwd,
        signal,
        timeoutMs: DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS,
      });
      const actor = await github.readActor();
      const repository = await github.readRepository(
        capture.snapshot.owner,
        capture.snapshot.repo,
      );
      if (
        repository.nodeId !== capture.snapshot.repositoryNodeId
        || repository.owner.toLowerCase() !== capture.snapshot.owner.toLowerCase()
        || repository.repo.toLowerCase() !== capture.snapshot.repo.toLowerCase()
      ) throw new PrReviewPublishError("binding_mismatch", "GitHub repository identity changed");
      const pull = await github.readPull(
        capture.snapshot.owner,
        capture.snapshot.repo,
        capture.snapshot.pullNumber,
      );
      if (pull.state !== "open" || pull.merged) {
        throw new PrReviewPublishError("pr_not_open", "pull request is not open");
      }
      if (pull.headSha !== capture.snapshot.headSha) {
        throw new PrReviewPublishError("stale_head", "pull request head changed before publication");
      }
      if (!pull.authorLogin) {
        throw new PrReviewPublishError("github_api_failed", "pull request author identity is unavailable");
      }
      if (actor.login.toLowerCase() === pull.authorLogin.toLowerCase()) {
        throw new PrReviewPublishError("self_review_denied", "authenticated actor cannot review their own pull request");
      }
      const canRead = repository.permissions.pull === true
        || repository.permissions.push === true
        || repository.permissions.maintain === true
        || repository.permissions.admin === true;
      const canWrite = repository.permissions.push === true
        || repository.permissions.maintain === true
        || repository.permissions.admin === true;
      if ((plan.event === "COMMENT" ? !canRead : !canWrite)) {
        throw new PrReviewPublishError("permission_denied", `authenticated actor lacks permission for ${plan.event}`);
      }

      const findExisting = async (
        client: GitHubReadClient = github,
      ): Promise<ExistingReview | "conflict" | undefined> => {
        const reviews = await client.readReviews(
          capture.snapshot.owner,
          capture.snapshot.repo,
          capture.snapshot.pullNumber,
        );
        const comments = await client.readReviewComments(
          capture.snapshot.owner,
          capture.snapshot.repo,
          capture.snapshot.pullNumber,
        );
        return inspectExisting(reviews, comments, actor.login, plan);
      };
      const existing = await findExisting();
      if (existing === "conflict") {
        throw new PrReviewPublishError("same_head_conflict", "same-head review marker has a different payload or event");
      }

      const update = {
        authenticated_actor: actor.login,
        roles: roleObservations,
        completed_capture_digest: createHash("sha256").update(input.capture_handle).digest("hex"),
        adjudication_counts: plan.adjudicationCounts,
        event: plan.event,
        payload_digest: plan.payloadDigest,
      } as const;
      if (journal.currentReceipt.status === "prepared") journal.prepare(update);
      if (existing) {
        this.#uncertain.delete(plan.runKey);
      } else if (!input.dry_run) {
        const uncertain = this.#uncertain.get(plan.runKey);
        if (
          uncertain
          && (uncertain.event !== plan.event || uncertain.payloadDigest !== plan.payloadDigest)
        ) {
          throw new PrReviewPublishError(
            "same_head_conflict",
            "same-head uncertain publication has a different payload or event",
          );
        }
        if (uncertain) {
          const failure = new PrReviewPublishError(
            "publication_indeterminate",
            "prior same-head publication remains indeterminate after exact marker lookup",
          );
          journal.indeterminate(failure.code, failure.message, {
            ...update,
            mutation_guard_active: false,
            github_inline_comment_markers: uncertain.inlineCommentMarkers,
            ...(uncertain.reviewId === undefined ? {} : {
              github_review_id: uncertain.reviewId,
            }),
            ...(uncertain.inlineCommentIds === undefined ? {} : {
              github_inline_comment_ids: uncertain.inlineCommentIds,
            }),
          });
          throw failure;
        }
      }

      if (input.dry_run) {
        if (journal.currentReceipt.status === "prepared") {
          journal.dryRun({
            ...update,
            mutation_guard_active: false,
            ...(existing ? {
              github_review_id: existing.reviewId,
              github_inline_comment_ids: existing.inlineCommentIds,
              github_inline_comment_markers: plan.findings.map((finding) => finding.marker),
            } : {}),
          });
        }
        return Object.freeze({
          status: "dry_run",
          event: plan.event,
          payload_digest: plan.payloadDigest,
          comment_count: plan.payload.comments.length,
          ...(existing ? {
            github_review_id: existing.reviewId,
            github_inline_comment_ids: existing.inlineCommentIds,
          } : {}),
        });
      }

      if (existing) {
        if (journal.currentReceipt.status === "prepared") {
          journal.publish({
            ...update,
            mutation_guard_active: false,
            github_review_id: existing.reviewId,
            github_inline_comment_ids: existing.inlineCommentIds,
            github_inline_comment_markers: plan.findings.map((finding) => finding.marker),
            post_publish_head_sha: pull.headSha,
            published_on_superseded_head: false,
          });
        }
        return Object.freeze({
          status: "existing",
          event: plan.event,
          payload_digest: plan.payloadDigest,
          comment_count: plan.payload.comments.length,
          github_review_id: existing.reviewId,
          github_inline_comment_ids: existing.inlineCommentIds,
        });
      }
      if (journal.currentReceipt.status !== "prepared") {
        throw new PrReviewPublishError("same_head_conflict", "terminal receipt cannot authorize another publication");
      }
      if (signal?.aborted) {
        throw new PrReviewPublishError("task_cancelled", "PR review publication was cancelled before POST");
      }

      let response: PublishedReview | undefined;
      let publishFailure: PrReviewPublishError | undefined;
      try {
        response = await new PrReviewPublish({
          exec: this.#exec,
          cwd: this.#cwd,
          signal,
          timeoutMs: DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS,
        })
          .submitGroupedReview(
            capture.snapshot.owner,
            capture.snapshot.repo,
            capture.snapshot.pullNumber,
            plan.payload,
          );
      } catch (error) {
        publishFailure = normalized(error, "publication_indeterminate");
      }

      let postPublishGithub = github;
      let published: ExistingReview;
      if (response && response.inlineCommentIds.length === plan.payload.comments.length) {
        published = Object.freeze({
          reviewId: response.reviewId,
          inlineCommentIds: response.inlineCommentIds,
        });
      } else {
        const reconciliationSignal = AbortSignal.timeout(RECONCILIATION_TIMEOUT_MS);
        const reconciliationGithub = new GitHubReadClient({
          exec: this.#exec,
          cwd: this.#cwd,
          signal: reconciliationSignal,
          timeoutMs: RECONCILIATION_TIMEOUT_MS,
        });
        postPublishGithub = reconciliationGithub;
        let recovered: ExistingReview | "conflict" | undefined;
        try {
          recovered = await findExisting(reconciliationGithub);
        } catch {
          recovered = undefined;
        }
        if (recovered === "conflict") {
          throw new PrReviewPublishError("same_head_conflict", "same-head review marker conflicts after publish attempt");
        }
        if (!recovered) {
          const failure = publishFailure ?? new PrReviewPublishError(
            "publication_indeterminate",
            "published review IDs could not be recovered",
          );
          if (failure.code === "publication_indeterminate") {
            const inlineCommentMarkers = plan.findings.map((finding) => finding.marker);
            this.#uncertain.set(plan.runKey, {
              event: plan.event,
              payloadDigest: plan.payloadDigest,
              inlineCommentMarkers,
            });
            journal.indeterminate(failure.code, failure.message, {
              ...update,
              mutation_guard_active: false,
              github_inline_comment_markers: inlineCommentMarkers,
            });
          }
          throw failure;
        }
        published = recovered;
      }

      const knownPublication = {
        ...update,
        mutation_guard_active: false,
        github_review_id: published.reviewId,
        github_inline_comment_ids: published.inlineCommentIds,
        github_inline_comment_markers: plan.findings.map((finding) => finding.marker),
      } as const;
      let postHeadSha: string;
      try {
        postHeadSha = (await postPublishGithub.readPull(
          capture.snapshot.owner,
          capture.snapshot.repo,
          capture.snapshot.pullNumber,
        )).headSha;
      } catch (error) {
        const postCheckFailure = normalized(error, "publication_indeterminate");
        const failure = new PrReviewPublishError(
          "publication_indeterminate",
          `publication IDs are known but post-publication head check failed: ${postCheckFailure.message}`,
        );
        this.#uncertain.set(plan.runKey, {
          event: plan.event,
          payloadDigest: plan.payloadDigest,
          inlineCommentMarkers: knownPublication.github_inline_comment_markers,
          reviewId: published.reviewId,
          inlineCommentIds: published.inlineCommentIds,
        });
        journal.indeterminate(failure.code, failure.message, knownPublication);
        throw failure;
      }
      const superseded = postHeadSha !== capture.snapshot.headSha;
      this.#uncertain.delete(plan.runKey);
      journal.publish({
        ...knownPublication,
        post_publish_head_sha: postHeadSha,
        published_on_superseded_head: superseded,
      });
      return Object.freeze({
        status: "published",
        event: plan.event,
        payload_digest: plan.payloadDigest,
        comment_count: plan.payload.comments.length,
        github_review_id: published.reviewId,
        github_inline_comment_ids: published.inlineCommentIds,
        published_on_superseded_head: superseded,
      });
    } catch (error) {
      const failure = normalized(error, "binding_mismatch");
      if (journal.currentReceipt.status === "prepared") {
        if (failure.code === "publication_indeterminate") {
          journal.indeterminate(failure.code, failure.message, {
            mutation_guard_active: false,
          });
        } else {
          journal.fail(failure.code, failure.message, {
            mutation_guard_active: false,
          });
        }
      }
      throw failure;
    }
  }
}

export function createPrReviewPublishTool(options: PrReviewPublishToolOptions): PrReviewPublishTool {
  return new PublishTool(options);
}
