---
name: stack-rust
description: On-demand Rust domain pack router. Load when working in a Rust/Cargo project or stack route / harness marker / explicit ask. Not needed for non-Rust work.
---

# stack-rust (on-demand pack)

Load this file by path `~/.pi/agent/skills/stack-rust/SKILL.md` — not `skill://stack-rust` (not cold-listed).

Cold start does **not** catalog every rust-skills skill. Activate this pack only when the repo or task needs Rust.

## When to use

- `Cargo.toml` / Rust workspace present
- Stack route / harness marker is `rust`
- Debugging Rust borrow/type/tooling issues

## Load order (live paths — never vendor bodies)

1. Prefer path load if catalogued; else `read rust-router` **only if** that skill is in the current session catalog (e.g. after enabling pack skills via Pi settings/packages or `/stack-rust`).
2. Otherwise read entry `SKILL.md` files by absolute path from the rust-skills marketplace root, typically:

```text
~/.claude/plugins/marketplaces/rust-skills/skills/rust-router/SKILL.md
~/.claude/plugins/marketplaces/rust-skills/skills/coding-guidelines/SKILL.md
```

3. Pull additional pack skills by path as needed (`m0*`, `domain-*`, `rust-*`, `unsafe-checker`, …). Do not load the whole pack into context up front.

## Missing skills

User installs missing underlying rust-skills. This pack only routes; it does not vendor marketplace bodies.

## Do not

- Assume rust pack skills appear in the cold-start skill list
- Copy skill bodies into AGENTS.md or prompts
- Load axiom/android packs for pure Rust work
