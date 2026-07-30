---
name: mcp-stack
description: Enable on-demand stack MCPs (headroom, context-mode, context7). Tokensave is always cold-loaded.
---

# /mcp-stack

Cold start only connects **tokensave**. Other stack MCPs stay defined with `enabled: false` so they do not inflate the xd:// inventory.

## Enable now (this session)

Run or instruct (OMP native):

```text
/mcp enable headroom
/mcp enable context-mode
/mcp enable context7
```

Or enable only what the task needs:

| Server | When |
|--------|------|
| **headroom** | Large tool outputs need compress/retrieve |
| **context-mode** | Big logs/files → sandbox + FTS index |
| **context7** | Library/API docs (docs-scout primary path) |

## After enable

- Prefer TokenSave for code structure (always available).
- Prefer context7 over inventing APIs from training data.
- Prefer context-mode / headroom over dumping huge blobs into chat.

## Do not

- Re-enable codebase-memory / chrome-devtools / node_repl (blocked in `disabledServers`).
- Leave all three on forever after a one-off docs look — disable again if cold % matters:

```text
/mcp disable context7
```
