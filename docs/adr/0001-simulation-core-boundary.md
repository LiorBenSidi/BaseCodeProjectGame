# ADR 0001: The simulation core is a replaceable module

**Status:** accepted

## Context
Client-side prediction only works if the client and the server run **identical, deterministic** movement
and collision code. That code (`src/shared/`) is also the most CPU-sensitive part of the game and the
part most likely to be worth rewriting in C++ (compiled to WebAssembly) if profiling ever shows a need.

We are not moving to C++ now: the stack Base Code documents as supported is web / full-stack JS, and a
rewrite before measuring would be speculative.

## Decision
`src/shared/` is the **simulation core**. Its public surface is exactly:

`stepPlayer`, `aimDir`, `playerBox`, `rayAabb`, `castRay`, the constants, and `MAP`.

Rules that keep it swappable:
1. The core has **no imports** from `src/server` or `src/client`, and no I/O, clock, or randomness.
2. Nothing outside `src/shared` reaches into its internals; callers use only the surface above.
3. **`docs/SPEC.md` (sections 1-4) is the conformance contract.** A replacement (C++/WASM or anything else)
   is accepted when it passes the same `tests/unit/{map,movement,hitscan}.test.js` unchanged.
4. Performance claims need a measurement first (`node --cpu-prof`, tick-time logging), recorded in
   `docs/` before any rewrite starts.

## Consequences
- A future C++/WASM core is a drop-in behind the same functions; the server and client do not change.
- If a WASM core is added, the C/C++ security tooling from the secure-programming course applies to it:
  AddressSanitizer/UBSan builds, a fuzzer on any parsing, and CodeQL with `import cpp`.
- We accept slightly less freedom in `src/shared` (no convenience imports) in exchange for that option.
