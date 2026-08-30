---
name: dispatch-via-dw
description: >
  When Bigpowers delegate-task / dispatch-agents patterns apply, implement them
  with Pi dynamic-workflows (and bg_delegate for inspect-only).
---

# dispatch-via-dw

**Policy:** one fan-out substrate on Pi — **dynamic-workflows** + **pi-background-tasks**.

## Mapping

| Bigpowers intent | Pi mechanism |
|------------------|--------------|
| `dispatch-agents` (parallel independent) | DW `agent()` / `parallel()` / `/workflows run` with worktree isolation when editing |
| `delegate-task` (one complex task + two-stage review) | single DW `agentType` then code-reviewer |
| inspect-only scout | `bg_delegate` capability=inspect → `bg_result` |
| long shell | `bg_run` / `/bg` — do not poll |

## Rules

1. Path-load Bigpowers `delegate-task` / `dispatch-agents` for **policy** — execution is DW/bg.
2. Prefer registered agent types under `~/.pi/agent/agents/*.md`.
3. Model tiers: `~/.pi/workflows/model-tiers.json`.
4. Harness owns phase order; agents do not start a second `/harness`.
5. Do not install a second subagent framework alongside DW for the same gate.

## Forbidden

- Superpowers subagent path-loads
- Polling bg jobs instead of wait/notify
