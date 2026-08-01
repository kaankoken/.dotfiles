#!/usr/bin/env bash
# Stage 4 OMP-native harness smoke.
# Deterministic by default. Opt-in live: OMP_LIVE_SMOKE=1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Stage 4 deterministic: stage4-native tests =="
bun test tests/stage4-native.test.ts

echo "== Stage 4 deterministic: stage3 parity still green =="
bun test tests/stage3-parity.test.ts

echo "== Stage 4 deterministic: harness binding + parity agentCount =="
bun -e '
import { bindGoal, DEFAULT_GOAL, HARNESS_COMMAND_NAME } from "./extensions/goal-harness/constants.ts";
import { GLOBAL_STRATEGY } from "./extensions/goal-harness/compaction.ts";
import { assertCompactionContract } from "./extensions/goal-harness/index.ts";
import { readFileSync } from "node:fs";
if (HARNESS_COMMAND_NAME !== "harness") throw new Error("bad command");
if (bindGoal("") !== DEFAULT_GOAL) throw new Error("default bind");
if (GLOBAL_STRATEGY !== "shake") throw new Error("strategy");
const c = assertCompactionContract();
if (!c.ok) throw new Error(c.reason);
const parity = JSON.parse(readFileSync("agents/parity-manifest.json", "utf8"));
if (parity.agentCount !== 19) throw new Error(`parity agentCount ${parity.agentCount}`);
console.log("binding+compaction+parity ok", parity.agentCount);
'

echo "== Stage 4: no pi-dynamic-workflows in sources =="
if rg -n 'pi-dynamic-workflows' extensions workflows package.json ../package.json 2>/dev/null | head -5; then
  echo "pi-dynamic-workflows found" >&2
  exit 1
fi
echo "no pi-dynamic-workflows"

echo "== Stage 4: /goal and /guided-goal unshadowed =="
if rg -n "registerCommand\\(['\"]goal|registerCommand\\(['\"]guided-goal|registerCommand\\(['\"]init" extensions/goal-harness/index.ts; then
  echo "harness must not register goal/guided-goal/init" >&2
  exit 1
fi

if [ "${OMP_LIVE_SMOKE:-}" = "1" ]; then
  echo "== Stage 4 LIVE smoke (OMP_LIVE_SMOKE=1) =="
  if ! command -v omp >/dev/null 2>&1; then
    echo "PREREQUISITE: omp not on PATH — live smoke requires installed omp binary" >&2
    exit 1
  fi
  omp --version || true
  # Discover parity roles + harness extension present
  test -f agents/parity-manifest.json
  test -f commands/harness.md || test -f extensions/goal-harness/index.ts
  echo "live: parity manifest + harness extension present"
  echo "live: native /goal and /guided-goal remain unshadowed (not registered by harness)"
else
  echo "== OMP_LIVE_SMOKE not set; skipping live provider section =="
fi

echo "Stage 4 OMP-native smoke PASS"
exit 0
