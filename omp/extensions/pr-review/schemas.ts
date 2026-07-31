import { createHash } from "node:crypto";
import initialReviewSchema from "../../schemas/pr-review-initial.schema.json";
import judgeResultSchema from "../../schemas/pr-review-judge.schema.json";
import rebuttalSchema from "../../schemas/pr-review-rebuttal.schema.json";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    if (primitive === undefined) throw new TypeError("value is not JSON");
    return primitive;
  }
  if (isJsonArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function schemaSha256(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

export const INITIAL_REVIEW_SCHEMA = initialReviewSchema;
export const REBUTTAL_SCHEMA = rebuttalSchema;
export const JUDGE_RESULT_SCHEMA = judgeResultSchema;

export const INITIAL_REVIEW_SCHEMA_CANONICAL = canonicalJson(INITIAL_REVIEW_SCHEMA);
export const REBUTTAL_SCHEMA_CANONICAL = canonicalJson(REBUTTAL_SCHEMA);
export const JUDGE_RESULT_SCHEMA_CANONICAL = canonicalJson(JUDGE_RESULT_SCHEMA);

export const INITIAL_REVIEW_SCHEMA_SHA256 = schemaSha256(
  INITIAL_REVIEW_SCHEMA_CANONICAL,
);
export const REBUTTAL_SCHEMA_SHA256 = schemaSha256(REBUTTAL_SCHEMA_CANONICAL);
export const JUDGE_RESULT_SCHEMA_SHA256 = schemaSha256(
  JUDGE_RESULT_SCHEMA_CANONICAL,
);
