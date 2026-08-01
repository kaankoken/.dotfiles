---
name: architect
description: Empty shell — in-session architecture consult. Loads architect skill on invoke. Never auto-starts /design or /harness.
---

# /architect

**Empty shell.** Expand `$ARGUMENTS` as bound architecture question (required; ask once if empty). Bound text is the only goal — never invent a second one.

**vs `/design`:** `/architect` = single-session consult (recommendation + optional ADRs). `/design` = gated multi-agent pipeline (reviewed PDR + Arc42 + ADR). Neither auto-starts the other.

## On invoke only

1. Load by **path** (cold catalog is only intent-router+beads — not `skill://` for these):
   - `~/.agents/skills/superpowers/using-superpowers/SKILL.md`
   - `~/.omp/agent/skills/architect/SKILL.md`
   - `~/.agents/skills/superpowers/brainstorming/SKILL.md`
2. Run the skill's 8-step workflow **in-session** — no subagents, no extension, no gates. Research via `web_search` / context7 as needed.
3. Deliverable: blueprint-form recommendation (see the skill's `assets/planning/architecture-blueprint.md`) in session; bd best-effort notes when an issue is available. **No files written by default.**
4. **ADRs (optional):** only decisive, hard-to-reverse choices **and** after user confirmation. MADR-lite body; session writes `docs/adr/NNNN-slug.md` — list `docs/adr/` immediately before writing and take the next free `NNNN`. Never under `docs/superpowers/` or `docs/plans/`.
5. **Stop.** Do **not** auto-start `/design` or `/harness`; handoff may suggest `nextStep` (`/design <goal>` for the full pipeline, `/harness <goal>` to build).
