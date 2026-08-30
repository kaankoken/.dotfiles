# Rust workspace boundaries (system level)

Crate graph and API surface. Not clippy lints or idiomatic impl — that's `stack-rust`.

## Default stance

**Virtual workspace**, small crates by **feature/bounded context**, not by Clean Architecture layer folders. Prefer `resolver = "3"` workspaces when matching user/repo norms.

## Crate roles

| Role | Example | Public API |
|------|---------|------------|
| Binary | `foo-cli`, `foo-service` | none / minimal |
| Domain | `foo-core` | stable types + traits |
| Adapters | `foo-db`, `foo-http` | impls behind traits or thin facades |
| Shared | `foo-common` | carefully — avoid dumping ground |
| FFI | `foo-ffi` / `cdylib` | explicit C/ABI surface |

## Graph rules

1. **Acyclic** crate deps; cycles = merge or introduce a smaller shared crate
2. Domain crates do **not** depend on HTTP/DB frameworks
3. Binaries compose adapters; domain stays testable without Tokio runtime if practical
4. `pub` is a promise — prefer `pub(crate)` until an external need exists
5. Feature flags: boundary for optional heavy deps; don't explode combinatorial matrix

## API stability

| Surface | Stability bar |
|---------|----------------|
| Internal workspace crates | move fast; semver soft |
| Published crates | semver hard; changelog |
| FFI / plugin ABI | hardest — version explicitly |

## FFI / embedding edges

- One crate owns `#[no_mangle]` / ABI; rest stays safe Rust
- Document ownership of buffers and thread requirements
- Prefer opaque handles over exposing Rust layouts

## Decision tree

```text
One binary, tiny domain?
  └─ 1–3 crates OK
Multiple binaries or services?
  └─ shared core + per-bin adapters
Need WASM / mobile / C# host?
  └─ isolate FFI crate early
```

## Related

- Integration across processes: [references/integration-patterns.md](references/integration-patterns.md)
- Stack depth: `stack-rust` on demand
