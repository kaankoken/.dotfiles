#!/usr/bin/env bash
# Stage 3 smoke: deterministic by default; opt-in live with OMP_LIVE_SMOKE=1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Stage 3 deterministic: bun stage3-parity =="
bun test tests/stage3-parity.test.ts

echo "== Stage 3 deterministic: harness binding =="
bun -e '
import { bindGoal, DEFAULT_GOAL, HARNESS_COMMAND_NAME } from "./extensions/goal-harness/constants.ts";
if (HARNESS_COMMAND_NAME !== "harness") throw new Error("bad command name");
if (bindGoal("") !== DEFAULT_GOAL) throw new Error("default bind failed");
if (bindGoal("x") !== "x") throw new Error("custom bind failed");
console.log("harness binding ok");
'

echo "== Stage 3 deterministic: 19 agents present =="
count=$(find agents -name '*.md' | wc -l | tr -d ' ')
if [ "$count" != "19" ]; then
  echo "expected 19 agents, got $count" >&2
  exit 1
fi

if [ "${OMP_LIVE_SMOKE:-}" = "1" ]; then
  echo "== Stage 3 LIVE smoke (OMP_LIVE_SMOKE=1) =="
  if ! command -v omp >/dev/null 2>&1; then
    echo "omp not on PATH; live smoke skipped with failure" >&2
    exit 1
  fi
  omp --version || true
  # Custom roles discoverable via agent files (no model call required for list)
  ls agents/*.md | wc -l | grep -q 19
  echo "live: roles discoverable"
  # Native /goal and /guided-goal must remain available (not registered by harness)
  if grep -R "registerCommand.*goal" extensions/goal-harness/index.ts 2>/dev/null; then
    echo "harness must not register goal" >&2
    exit 1
  fi
  echo "live: /goal unshadowed check ok"
else
  echo "== OMP_LIVE_SMOKE not set; skipping live section =="
fi

echo "Stage 3 smoke PASS"
exit 0
