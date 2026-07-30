---
name: stack-android
description: On-demand Android/Compose domain pack router. Load when working in Android/Gradle/Compose projects or when the user invokes /stack-android. Not needed for non-Android work.
---

# stack-android (on-demand pack)

Cold start does **not** catalog every Android skill. Activate this pack only when the repo or task needs Android.

## When to use

- Gradle / Compose / Android app markers
- User ran `/stack-android` or harness stack marker is `android`
- AGP, Compose, navigation, billing, or Android testing work

## Load order (live paths — never vendor bodies)

1. Prefer `read skill://android-cli` only if present in the session catalog (e.g. after `omp --config …/configs/pack-android.yml`).
2. Otherwise read entry skills by absolute path under `~/.agents/skills/`:

```text
~/.agents/skills/android-cli/SKILL.md
~/.agents/skills/testing-setup/SKILL.md
~/.agents/skills/migrate-xml-views-to-jetpack-compose/SKILL.md
~/.agents/skills/navigation-3/SKILL.md
```

3. Load further Android skills by path as needed (`edge-to-edge`, `r8-analyzer`, `perfetto-*`, …). Do not preload the full Android set.

## Do not

- Assume Android skills appear in the cold-start skill list
- Vendor skill bodies into prompts
- Load rust/axiom packs for pure Android work
