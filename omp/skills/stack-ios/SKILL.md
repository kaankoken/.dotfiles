---
name: stack-ios
description: On-demand iOS/Axiom domain pack router. Load when working in Swift/Xcode/iOS projects or stack route / harness marker / explicit ask. Not needed for non-iOS work.
---

# stack-ios (on-demand pack)

Cold start does **not** catalog every Axiom skill. Activate this pack only when the repo or task needs iOS/Swift.

## When to use

- `Package.swift`, `.xcodeproj`, `.xcworkspace`, or iOS app sources
- Stack route / harness marker is `ios`
- SwiftUI / concurrency / shipping / Xcode tooling work

## Load order (live paths — never vendor bodies)

1. Prefer `read skill://axiom-swiftui` (or related `axiom-*`) only if present in the session catalog (e.g. after `omp --config …/configs/pack-ios.yml`).
2. Otherwise read entry skills by absolute path under:

```text
~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills/axiom-swiftui/SKILL.md
~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills/axiom-swift/SKILL.md
~/.claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills/axiom-build/SKILL.md
```

3. Load further `axiom-*` skills by path as the task requires. Do not dump the full Axiom catalog into context.

## Do not

- Assume axiom skills appear in the cold-start skill list
- Vendor Axiom skill bodies into prompts
- Load rust/android packs for pure iOS work
