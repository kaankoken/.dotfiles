---
name: stack-android
description: On-demand Android/Compose pack router. Stack route / harness marker / explicit ask — not cold-listed, no slash command.
---

# stack-android (on-demand pack)

Load this file by path `~/.omp/agent/skills/stack-android/SKILL.md` — not `skill://stack-android` (not cold-listed).

Cold start does **not** catalog every Android skill. Activate only when the repo or task needs Android.

## When to use

- Gradle / Compose / Android app markers
- Stack route / harness marker `android` / explicit ask
- AGP, Compose, navigation, or Android testing work

## Load order (live paths — never vendor bodies)

1. Prefer path load if catalogued; else `read android-cli` only if present in the session catalog (e.g. after `omp --config …/configs/pack-android.yml`).
2. Otherwise read entry skills by absolute path under `~/.agents/skills/`:

```text
~/.agents/skills/android-cli/SKILL.md
~/.agents/skills/testing-setup/SKILL.md
~/.agents/skills/migrate-xml-views-to-jetpack-compose/SKILL.md
~/.agents/skills/navigation-3/SKILL.md
```

3. Load further **default** Android skills by path as needed (`edge-to-edge`, `r8-analyzer`, `perfetto-*`, …). Do not preload the full set.

## Explicit-only (not default pack)

Play / Google-services skills are **out of default android includeGlobs** (Play ≠ GCP). Load **only** on explicit user ask, by absolute path:

```text
~/.agents/skills/play-billing-library-version-upgrade/SKILL.md
~/.agents/skills/engage-sdk-integration/SKILL.md
~/.agents/skills/verified-email/SKILL.md
```

Do **not** route these through `~/.omp/agent/skills/stack-gcp/SKILL.md`.

## Do not

- Assume Android skills appear in the cold-start skill list
- Vendor skill bodies into prompts
- Load rust/axiom/gcp packs for pure Android UI work
- Register `/stack-android` slash command
