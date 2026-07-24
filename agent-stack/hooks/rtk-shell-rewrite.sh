#!/usr/bin/env bash
# PreToolUse: rewrite shell commands via `rtk rewrite`.
# Accepts Claude (snake_case) and Grok (camelCase) hook stdin JSON.
# Emits Claude-compatible updatedInput + decision allow. Fail-open.
set -euo pipefail

if [[ "${RTK_DISABLED:-}" == "1" ]]; then
  exit 0
fi

if ! command -v rtk >/dev/null 2>&1; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input="$(cat || true)"
[[ -n "${input}" ]] || exit 0

cmd="$(printf '%s' "${input}" | jq -r '
  .tool_input.command
  // .toolInput.command
  // .command
  // empty
' 2>/dev/null || true)"

[[ -n "${cmd}" && "${cmd}" != "null" ]] || exit 0

# Already under rtk — leave alone (bare modern tools also left alone by rtk rewrite).
case "${cmd}" in
  rtk\ *) exit 0 ;;
esac

rewritten="$(rtk rewrite "${cmd}" 2>/dev/null || true)"
if [[ -z "${rewritten}" || "${rewritten}" == "${cmd}" ]]; then
  exit 0
fi

# Claude-style updatedInput (Grok scans Claude hooks and accepts hookSpecificOutput).
jq -n --arg c "${rewritten}" '{
  decision: "allow",
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecisionReason: "RTK auto-rewrite",
    updatedInput: { command: $c }
  }
}'
