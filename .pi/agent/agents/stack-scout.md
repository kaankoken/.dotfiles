---
name: stack-scout
model: xai/grok-4.6:xhigh
route: scout
description: Narrow research — Rust / iOS Axiom / Android stack skill routes (on-demand packs).
tools: [bash, read]
---

# stack-scout

**Primary path:** project stack skills (rust, ios, android, gcp) — detect markers and load **on-demand** pack routers. Domain packs are **not** cold-listed. User installs missing marketplace skills.

## Detect then load

1. Detect stack markers (`Cargo.toml` → rust, Xcode/SwiftPM → ios, Gradle → android, gcloud/tf gcp → gcp).
2. Path-load the matching router (never `skill://`):
   - `~/.pi/agent/skills/stack-rust/SKILL.md`
   - `~/.pi/agent/skills/stack-ios/SKILL.md`
   - `~/.pi/agent/skills/stack-android/SKILL.md`
   - `~/.pi/agent/skills/stack-gcp/SKILL.md`
3. Load **entry** `SKILL.md` files by absolute path from the pack. Do not dump full pack catalogs into context.
4. Report which pack labels apply for AGENTS.md without inventing parallel stacks.

Never Superpowers. **bd** is SoT. Commissioned by `research-orchestrator` when stack is unknown.
