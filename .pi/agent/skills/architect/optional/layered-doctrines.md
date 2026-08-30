# Layered doctrines (OPT-IN ONLY)

**Load only via `/architect-layered`.** Default `/architect` and `/design` writers must not treat this file as required.

Covers **Clean Architecture**, **onion**, and **hexagonal (ports & adapters)** as *optional vocabulary* when the user explicitly wants them.

## Default stance (even in this command)

Prefer **feature/bounded-context modules** or a **modular monolith** before any layer cake. These doctrines are tools for dependency direction — not a folder religion. If the team is <10 and the domain is still moving, layered ceremony usually loses to vertical slices.

## What each name means (short)

| Doctrine | Core idea | Typical rings / sides |
|----------|-----------|------------------------|
| **Hexagonal** | Domain at center; UI/DB/messaging are adapters behind ports | ports (interfaces) inward; adapters outward |
| **Onion** | Dependencies point inward; domain model at core | domain → application → infrastructure |
| **Clean Architecture** | Same dependency rule; use-cases/interactors explicit; entities independent of frameworks | entities → use cases → interface adapters → frameworks |

They are **cousins**, not three different religions. Pick one vocabulary per codebase.

## When they can be justified

| Signal | Maybe useful |
|--------|----------------|
| Multiple delivery mechanisms (HTTP, CLI, queue) over one domain | Hex ports |
| Need to swap infra (DB, bus) without rewriting rules | Ports/adapters |
| Large team needs a shared dependency rule | One documented onion/clean rule |
| Heavy test pyramid on domain without spinning frameworks | Inward dependencies |

## When they are a bad fit

| Signal | Prefer instead |
|--------|----------------|
| Early product, one UI, one DB | Feature modules / modular monolith |
| Every feature forced through identical layer folders | Vertical slices |
| “Repository interface + one SQL impl forever” | Concrete adapter until second impl exists |
| iOS/Android UI kits twisted into enterprise layers | [references/ios-modularization.md](references/ios-modularization.md) |
| Rust crate-per-layer explosion | [references/rust-workspace-boundaries.md](references/rust-workspace-boundaries.md) |

## Costs (pay them knowingly)

- More types/files before behavior exists
- Mapping DTOs at every boundary (boilerplate risk)
- Onboarding tax (“which layer does this go in?”)
- False safety: bad domain model stays bad inside a pretty ring

## If you use them — hard rules

1. **One** doctrine vocabulary in the repo; document in an ADR
2. Dependency rule enforced by structure or lint — not wiki only
3. **No** interface without a second real need (YAGNI on ports)
4. Application/use-case layer stays thin: orchestration, not a second domain
5. Frameworks outward; domain does not import web/DB frameworks
6. Pair with real boundaries (contexts), not only technical layers

## Mapping to OMP default architect

Still run default steps 0–8 (repo-fit, QA scenarios, diagrams, handoff). Layered doctrines only change **how you name candidates** in step 3–4 — they do not replace security, tenancy, observability, or integration refs.

## ADR hint

If adopting: one ADR “Dependency rule = hexagonal|onion|clean” with consequences and folder/crate examples. If rejecting after consult: optional short ADR “vertical slices over clean architecture” when the team was about to cargo-cult folders.
