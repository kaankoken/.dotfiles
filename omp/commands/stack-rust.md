---
name: stack-rust
description: Activate Rust domain skills on demand (not cold-loaded).
---

# /stack-rust

Activate the **Rust** domain pack for this turn. Expand `$ARGUMENTS` as optional focus (e.g. ownership, clippy, CLI).

## Why this exists

Cold-start `includeSkills` deliberately omits `rust-*` / rust-skills pack metadata so generic sessions stay lean. Pack roots remain on disk via `customDirectories`.

## Do this now

1. `read skill://stack-rust` (router always cold-listed).
2. Load entry skills by **absolute path** (or `skill://` only if this session was started with `omp --config ~/.dotfiles/omp/configs/pack-rust.yml`):

```text
~/.claude/plugins/marketplaces/rust-skills/skills/rust-router/SKILL.md
~/.claude/plugins/marketplaces/rust-skills/skills/coding-guidelines/SKILL.md
```

3. If `$ARGUMENTS` names a topic, load the matching pack skill by path (e.g. `m01-ownership`, `domain-cli`, `unsafe-checker`) — not the entire pack.
4. Prefer TokenSave for code structure; use rust pack for language/tooling conventions only.

## Optional full catalog (new session)

```bash
omp --config ~/.dotfiles/omp/configs/pack-rust.yml
```

## Do not

- Pretend every rust skill is in the cold skill list
- Vendor skill bodies into AGENTS.md
- Load axiom/android packs unless markers require them
