---
name: stack-rust
description: On-demand Rust domain pack router. Load when working in a Rust/Cargo project or stack route / harness marker / explicit ask. Not needed for non-Rust work.
---

# stack-rust (on-demand pack)

Cold start does **not** catalog every rust-skills skill. Activate this pack only when the repo or task needs Rust.

## When to use

- `Cargo.toml` / Rust workspace present
- Stack route / harness marker is `rust`
- Debugging Rust borrow/type/tooling issues

## Load order (live paths — never vendor bodies)

1. Prefer `read skill://rust-router` **only if** that skill is in the current session catalog (e.g. after `omp --config …/configs/pack-rust.yml`).
2. Otherwise read entry `SKILL.md` files by absolute path from the rust-skills marketplace root, typically:

```text
~/.claude/plugins/marketplaces/rust-skills/skills/rust-router/SKILL.md
~/.claude/plugins/marketplaces/rust-skills/skills/coding-guidelines/SKILL.md
```

3. Pull additional pack skills by path as needed (`m0*`, `domain-*`, `rust-*`, `unsafe-checker`, …). Do not load the whole pack into context up front.

## Do not

- Assume rust pack skills appear in the cold-start skill list
- Copy skill bodies into AGENTS.md or prompts
- Load axiom/android packs for pure Rust work
