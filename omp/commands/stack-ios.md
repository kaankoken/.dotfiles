---
name: stack-ios
description: Activate iOS/Axiom domain skills on demand (not cold-loaded).
---

# /stack-ios

Activate the **iOS / Axiom** domain pack for this turn. Expand `$ARGUMENTS` as optional focus (e.g. SwiftUI, concurrency, shipping).

## Why this exists

Cold-start `includeSkills` is only `intent-router` + `beads`. This command
loads the iOS/Axiom pack on demand. Pack roots remain on disk via `customDirectories`.

## Do this now

1. `read skill://stack-ios` (on-demand router; not cold-listed).
2. Load entry skills by **absolute path** (or `skill://` if session used `omp --config ~/.dotfiles/omp/configs/pack-ios.yml`):

```text
~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills/axiom-swiftui/SKILL.md
~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills/axiom-swift/SKILL.md
~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills/axiom-build/SKILL.md
```

3. If `$ARGUMENTS` names a domain, load that `axiom-*` skill by path only — not the full Axiom set.
4. Prefer TokenSave for code structure; use Axiom for Apple platform conventions.

## Optional full catalog (new session)

```bash
omp --config ~/.dotfiles/omp/configs/pack-ios.yml
```

## Do not

- Assume axiom skills are in the cold skill list
- Vendor Axiom bodies into prompts
- Load rust/android packs unless markers require them
