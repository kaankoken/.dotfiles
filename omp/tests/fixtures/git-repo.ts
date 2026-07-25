/**
 * Temporary git repository fixture for harness git/worktree tests.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export type TempRepo = {
  root: string;
  /** Clean up the whole temp tree. */
  dispose(): void;
  git(...args: string[]): string;
  head(): string;
  branch(): string;
};

export function createTempRepo(opts?: {
  initialBranch?: string;
  file?: string;
}): TempRepo {
  const root = mkdtempSync(join(tmpdir(), "omp-harness-git-"));
  const initialBranch = opts?.initialBranch ?? "main";

  const git = (...args: string[]): string => {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "harness-test",
        GIT_AUTHOR_EMAIL: "harness@test",
        GIT_COMMITTER_NAME: "harness-test",
        GIT_COMMITTER_EMAIL: "harness@test",
      },
    }).trim();
  };

  git("init", "-b", initialBranch);
  git("config", "user.email", "harness@test");
  git("config", "user.name", "harness-test");
  writeFileSync(join(root, opts?.file ?? "README.md"), "# test\n");
  git("add", ".");
  git("commit", "-m", "init");

  return {
    root,
    dispose() {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
    },
    git,
    head() {
      return git("rev-parse", "HEAD");
    },
    branch() {
      return git("branch", "--show-current");
    },
  };
}

/** Ensure a project-local worktree root is gitignored. */
export function ensureIgnored(repo: TempRepo, dirName: string): void {
  const gi = join(repo.root, ".gitignore");
  writeFileSync(gi, `${dirName}/\n`);
  repo.git("add", ".gitignore");
  repo.git("commit", "-m", `ignore ${dirName}`);
  mkdirSync(join(repo.root, dirName), { recursive: true });
}
