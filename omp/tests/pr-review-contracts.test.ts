import { describe, expect, test } from "bun:test";
import {
  PR_REVIEW_MARKER_NAMESPACE,
  PR_REVIEW_PROTOCOL_VERSION,
  PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA,
  PR_REVIEW_ROLE_MANIFEST_VERSION,
  PR_REVIEW_SCHEMA_VERSION,
  PR_REVIEW_SNAPSHOT_PARAMETERS_SCHEMA,
  PR_REVIEW_SUMMARY_BODIES,
  WF7_ROLE_SPECS,
  WF7_TASK_SLOTS,
} from "../extensions/pr-review/contracts";
import type {
  PrReviewReceiptV1,
  RoleIntegrityObservation,
} from "../extensions/pr-review/contracts";

describe("WF7 PR review contracts", () => {
  test("pins the exact three user-role routes", () => {
    expect(WF7_ROLE_SPECS).toEqual([
      {
        livePath: "~/.omp/agent/agents/wf7-fable-reviewer.md",
        canonicalPath:
          "/Users/legolas/.dotfiles/omp/agents/wf7-fable-reviewer.md",
        agent: "wf7-fable-reviewer",
        model: "anthropic/claude-fable-5:max",
      },
      {
        livePath: "~/.omp/agent/agents/wf7-sol-reviewer.md",
        canonicalPath:
          "/Users/legolas/.dotfiles/omp/agents/wf7-sol-reviewer.md",
        agent: "wf7-sol-reviewer",
        model: "openai-codex/gpt-5.6-sol:xhigh",
      },
      {
        livePath: "~/.omp/agent/agents/wf7-grok-judge.md",
        canonicalPath: "/Users/legolas/.dotfiles/omp/agents/wf7-grok-judge.md",
        agent: "wf7-grok-judge",
        model: "xai-oauth/grok-4.5:xhigh",
      },
    ]);
  });

  test("defines exactly five ordered task slots", () => {
    expect(WF7_TASK_SLOTS).toEqual([
      {
        stage: "initial",
        name: "wf7-fable-initial",
        agent: "wf7-fable-reviewer",
      },
      {
        stage: "initial",
        name: "wf7-sol-initial",
        agent: "wf7-sol-reviewer",
      },
      {
        stage: "rebuttal",
        name: "wf7-fable-rebuttal",
        agent: "wf7-fable-reviewer",
      },
      {
        stage: "rebuttal",
        name: "wf7-sol-rebuttal",
        agent: "wf7-sol-reviewer",
      },
      {
        stage: "judge",
        name: "wf7-grok-judge",
        agent: "wf7-grok-judge",
      },
    ]);
  });

  test("pins protocol constants and fixed GitHub summary bodies", () => {
    expect({
      protocol: PR_REVIEW_PROTOCOL_VERSION,
      schema: PR_REVIEW_SCHEMA_VERSION,
      manifest: PR_REVIEW_ROLE_MANIFEST_VERSION,
      marker: PR_REVIEW_MARKER_NAMESPACE,
    }).toEqual({ protocol: 1, schema: 1, manifest: 1, marker: "dotfiles-wf7" });
    expect(PR_REVIEW_SUMMARY_BODIES).toEqual({
      COMMENT: "Automated review completed; findings are inline.",
      REQUEST_CHANGES:
        "Automated review requests changes; findings are inline.",
      APPROVE: "Automated review completed; no publishable findings.",
    });
  });

  test("keeps snapshot operations closed and bounded", () => {
    expect(PR_REVIEW_SNAPSHOT_PARAMETERS_SCHEMA).toEqual({
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
            snapshot_handle: { type: "string", minLength: 32, maxLength: 256 },
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
            run_handle: { type: "string", minLength: 32, maxLength: 256 },
          },
          required: ["action", "run_handle"],
          additionalProperties: false,
        },
      ],
    });
  });

  test("publish accepts only the completed capture handle and dry-run flag", () => {
    expect(PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA).toEqual({
      type: "object",
      properties: {
        capture_handle: { type: "string", minLength: 32, maxLength: 256 },
        dry_run: { type: "boolean" },
      },
      required: ["capture_handle", "dry_run"],
      additionalProperties: false,
    });
  });
  test("receipt types represent missing roles and post-publication evidence", () => {
    const missingRole = {
      agent: "wf7-fable-reviewer",
      livePath: "~/.omp/agent/agents/wf7-fable-reviewer.md",
      preCallValid: false,
    } satisfies RoleIntegrityObservation;
    const publication = {
      github_inline_comment_markers: ["<!-- dotfiles-wf7:finding:key -->"],
      post_publish_head_sha: "b".repeat(40),
      published_on_superseded_head: true,
    } satisfies Pick<
      PrReviewReceiptV1,
      | "github_inline_comment_markers"
      | "post_publish_head_sha"
      | "published_on_superseded_head"
    >;

    expect(missingRole).toEqual({
      agent: "wf7-fable-reviewer",
      livePath: "~/.omp/agent/agents/wf7-fable-reviewer.md",
      preCallValid: false,
    });
    expect(publication.github_inline_comment_markers).toHaveLength(1);
    expect(publication.post_publish_head_sha).toHaveLength(40);
    expect(publication.published_on_superseded_head).toBe(true);
  });

});
