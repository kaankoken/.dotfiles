/**
 * Best-effort beads persistence for design-flow PDR/Arc42.
 * ADR files on disk remain the durable SoT; bd is optional.
 */

import { spawnSync } from "node:child_process";

export type BdRunner = (
  args: string[],
  cwd: string,
) => { status: number; stdout: string; stderr: string };

function defaultBdSpawn(
  args: string[],
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bd", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

export function persistDesignArtifactsBestEffort(opts: {
  cwd: string;
  issueId?: string;
  boundGoal: string;
  pdr: unknown;
  arc42: unknown;
  adrPaths: string[];
  bdRunner?: BdRunner;
}): { ok: boolean; warning?: string } {
  if (!opts.issueId) {
    return { ok: false, warning: "no beadsIssue; session-only PDR/Arc42" };
  }
  const run = opts.bdRunner ?? defaultBdSpawn;
  const payload = JSON.stringify({
    kind: "design-flow-artifacts",
    boundGoal: opts.boundGoal,
    pdr: opts.pdr,
    arc42: opts.arc42,
    adrPaths: opts.adrPaths,
  });
  try {
    const res = run(
      ["update", opts.issueId, `--design=${payload}`],
      opts.cwd,
    );
    if (res.status !== 0) {
      return {
        ok: false,
        warning: `bd update failed: ${res.stderr || res.stdout}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      warning: e instanceof Error ? e.message : String(e),
    };
  }
}
