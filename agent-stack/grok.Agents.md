# Shared agent stack (Grok)
# Includes resolve next to this file (link.sh installs AGENTS.shared.md + RTK.md).
# Shell rewrite: ~/.grok/hooks/rtk-shell.json → rtk rewrite (bare modern CLIs allowed).

@AGENTS.shared.md
@RTK.md

## Prefer tokensave MCP tools

Before reading source files or scanning the codebase with file tools or sub-agents (especially the `explore` sub-agent), use the tokensave MCP tools. Discover them with the built-in `search_tool` (query for "tokensave" or a code concept) and invoke via `use_tool` with the namespaced name (e.g. `tokensave__tokensave_context`, `tokensave__tokensave_search`, `tokensave__tokensave_callers`, `tokensave__tokensave_callees`, `tokensave__tokensave_impact`, `tokensave__tokensave_node`, `tokensave__tokensave_files`, `tokensave__tokensave_affected`).

They provide instant semantic results from a pre-built knowledge graph and are faster and lower-token than raw file reads or sub-agent exploration.

If a code analysis question cannot be fully answered by tokensave MCP tools, try querying the SQLite database directly at `.tokensave/tokensave.db` (tables: `nodes`, `edges`, `files`). Use SQL to answer complex structural queries that go beyond what the built-in tools expose.

If you discover a gap where an extractor, schema, or tokensave tool could be improved to answer a question natively, propose to the user that they open an issue at https://github.com/aovestdipaperino/tokensave describing the limitation. **Remind the user to strip any sensitive or proprietary code from the bug description before submitting.**
