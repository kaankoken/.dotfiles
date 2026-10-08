---
name: dispatch-via-dw
description: >
  Apply Bigpowers delegate-task / dispatch-agents policy through Pi dynamic-workflows.
---

# dispatch-via-dw

**Policy:** one delegation engine on Pi: **dynamic-workflows**. **bd** owns durable task state.

| Bigpowers intent | Pi mechanism |
|-----------------|--------------|
| `dispatch-agents` | DW `agent()` / `parallel()` with disjoint ownership; worktree isolation when edits may overlap |
| `delegate-task` | one registered `agentType`, then a fresh reviewer |
| inspect-only scout | DW scout role with read-oriented tools; no edits |
| long shell check | `bg_run` when available, otherwise `bash`; retain exit code and summarize bounded logs with context-mode |

## Rules

1. Load Bigpowers skills for policy, not a second executor.
2. Require workflow opt-in. `/harness`, workflow commands, or an explicit delegation request qualify.
3. Prefer registered roles under `~/.pi/agent/agents/*.md`; tiers live in `~/.pi/workflows/model-tiers.json`.
4. Harness owns phase order. Agents must not start another harness; its work is `background:false`.
5. Outside harness, background workflows deliver completion events. Use `workflow_control` for status/pause/resume/stop, not tight polling.
6. Use pi-background-tasks for long process checks. Workflow children must use isAgent:false and finish jobs before returning; child shutdown stops unfinished jobs. Do not launch child Pi/LLM commands or recursive delegate/Fusion work.
7. Worktrees and role tool lists are not sandboxes. Keep one integrator; require fresh verification before accepting agent work.

Never path-load `~/.agents/skills/superpowers/**`.
