import { rmSync } from "node:fs";
import { runFakeReview, targetFiles } from "./pr-review-fixture";

const run = await runFakeReview({ dryRun: true, decision: "reject" });
try {
  if (
    run.api.messages.length !== 1 ||
    run.receipt.status !== "dry_run" ||
    run.receipt.tasks.length !== 5 ||
    run.posts.length !== 0 ||
    run.publishResult?.status !== "dry_run" ||
    targetFiles(run.targetDir).join(",") !== "sentinel.txt"
  ) {
    throw new Error("pr-reviewer dry-run smoke invariant failed");
  }
  console.log("PASS pr-reviewer dry-run: 5 sealed, 0 GitHub writes, receipt=dry_run");
} finally {
  rmSync(run.root, { recursive: true, force: true });
}
