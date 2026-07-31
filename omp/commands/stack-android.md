---
name: stack-android
description: Activate Android/Compose domain skills on demand (not cold-loaded).
---

# /stack-android

Activate the **Android / Compose** domain pack for this turn. Expand `$ARGUMENTS` as optional focus (e.g. navigation, AGP, billing).

## Why this exists

Cold-start `includeSkills` is only `intent-router` + `beads`. This command
loads the Android pack on demand. Skills remain under `~/.agents/skills` via `customDirectories`.

## Do this now

1. `read skill://stack-android` (on-demand router; not cold-listed).
2. Load entry skills by **absolute path** (or `skill://` if session used `omp --config ~/.dotfiles/omp/configs/pack-android.yml`):

```text
~/.agents/skills/android-cli/SKILL.md
~/.agents/skills/testing-setup/SKILL.md
~/.agents/skills/migrate-xml-views-to-jetpack-compose/SKILL.md
~/.agents/skills/navigation-3/SKILL.md
```

3. If `$ARGUMENTS` names a topic, load that skill by path only (`edge-to-edge`, `r8-analyzer`, …) — not the full Android set.
4. Prefer TokenSave for code structure; use Android skills for platform conventions.

## Optional full catalog (new session)

```bash
omp --config ~/.dotfiles/omp/configs/pack-android.yml
```

## Do not

- Assume Android skills are in the cold skill list
- Vendor skill bodies into prompts
- Load rust/axiom packs unless markers require them
