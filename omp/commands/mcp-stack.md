---
name: mcp-stack
description: Enable opt-in docs MCP (context7). headroom/context-mode are already cold.
---

# /mcp-stack

## Cold MCP (already connected)

- **tokensave** — code graph
- **headroom** — compress/retrieve large tool outputs
- **context-mode** — sandbox + FTS for big logs/files

RTK remains shell/hooks, not MCP.

## Opt-in now

```text
/mcp enable context7
```

| Server | When |
|--------|------|
| **context7** | Library/API docs (docs-scout primary path) |

`headroom` / `context-mode` should already be on; re-enable only if a session disabled them.

## Do not

- Re-enable codebase-memory / chrome-devtools / node_repl (`disabledServers`).
- Invent APIs from training data when context7 can answer.
