Tool routing (mandatory):

1. Symbols, callers, impact, "how does this function work":
   mcp__tokensave → tokensave_context, then tokensave_search.
   Not repo-wide grep for symbol lookup.

2. Architecture / communities / "what talks to what":
   load graphify skill. If graphify-out/graph.json exists, `graphify query`.
   tokensave = live symbol graph. graphify = corpus/architecture graph.

3. File read / edit = **hashline** (`read`, `replace`, `insert`, `undo_last_change`).
   Built-in `edit` is disabled. Never bash `cat`/`sed` to patch files.
   Pi `grep` returns hashline anchors — use after tokensave, then `replace` by anchor.
   `write` only for new files or full rewrites.

4. Shell CLIs — use the **bash** tool so RTK + brew rewrite fire.
   Do not wrap these in ctx_execute:
   git, gh, rg, fd, eza, bat, dust, procs, sd, delta, cargo, npm, docker, test.

5. ctx_execute / ctx_execute_file / ctx_batch_execute: large unknown output
   only (logs, JSON transforms, test dumps). language=shell still goes through
   RTK + brew rewrite. ctx_execute_file = analyze, not edit.

6. Installed CLIs, never GNU. Extension auto-swaps:
   grep→rg · ls→eza · cat/less→bat -P · du -sh→dust · ps aux→procs.
   You still type: fd not find · sd not sed.
   git already uses delta as pager; agent git/diff still go through rtk.
   Never fzf (TUI).

7. Ponytail + caveman extensions inject their own rules when on. Obey them.
   Off only: "stop ponytail" / "stop caveman" / "normal mode".
