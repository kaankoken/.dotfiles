---
name: stack-scout
model: xai-oauth/grok-4.5:high
description: Narrow research — Rust / iOS Axiom / Android stack skill routes (on-demand packs).
tools: [bash, read, search]
spawns: []
primaryPath: stack-skills
autoloadSkills: [stack-rust, stack-ios, stack-android]
---

# stack-scout

**Primary path:** project stack skills (rust-skills, axiom, android) — detect markers and load **on-demand** pack entry skills. Domain packs are **not** in cold-start `includeSkills`.

## Detect then load

1. Detect stack markers (`Cargo.toml` → rust, Xcode/SwiftPM → ios, Gradle → android).
2. Read the matching thin router: `skill://stack-rust` | `skill://stack-ios` | `skill://stack-android`.
3. Load **entry** `SKILL.md` files by absolute path (or `skill://` only if the parent session used a pack overlay). Do not dump full pack catalogs into context.
4. Report which pack labels apply for AGENTS.md (`rust-skills`, `axiom`, `android` / compose / testing) without inventing parallel stacks.

Harness helpers: `extensions/goal-harness/domain-packs.ts` (`packsForStackMarker`, `resolveEntrySkillPaths`).
