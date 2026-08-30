# iOS modularization (system level)

App **module boundaries**, not SwiftUI style or Axiom code-review rules. Implementation depth → `stack-ios` / Axiom packs.

## When to read

Multi-feature app, SPM graph pain, slow builds, wanting feature teams without a ball-of-mud target.

## Default stance

**Feature modules + thin app shell.** Avoid enterprise layer cakes (see default architect anti-patterns; layered doctrines only via `/architect-layered`).

## Boundary types

| Module kind | Contains | Depends on |
|-------------|----------|------------|
| `App` | composition root, DI, navigation host | features, shared kits |
| Feature | one user-facing capability | shared domain/UI kits only |
| Domain kit | models, pure logic | little/nothing UI |
| UI kit | design system, shared components | foundation only |
| Platform | networking, persistence adapters | external SDKs |

**Rule:** features do not import other features. Cross-feature → app coordinator, event, or deep-link contract.

## SPM / Xcode graph hygiene

- Acyclic graph; no “Utils” mega-target everything imports
- Binary size & build: prefer smaller targets; watch umbrella imports
- App extensions / widgets: explicit shared frameworks; no silent app-target coupling
- Test targets next to modules they prove

## Navigation & state ownership

- Navigation graph owned at shell or dedicated coordinator module
- Feature state stays inside feature unless intentionally shared
- Deep links: route table at shell → feature entry points

## Data & concurrency (architectural)

- Persistence ownership clear (who migrates schema?)
- MainActor boundaries documented at module API, not ad-hoc
- Background work: explicit services, not random `Task` in views across modules

## Decision tree

```text
Single small app, one team?
  └─ few modules or even one target OK until pain
Multiple features or teams?
  └─ feature modules + shared kits
Need App Clip / extension / watch?
  └─ extract shared kits early; keep features out of extension targets
```

## Related

- Handoff to build: [assets/planning/architecture-handoff.md](assets/planning/architecture-handoff.md)
- Stack depth: path-load `stack-ios` skill on demand
