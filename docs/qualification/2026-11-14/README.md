# Qualification evidence, 14 November 2026

These are local synthetic-program and DOM results, not production transactions.
The [repair checklist](../../REPAIR_CHECKLIST.md) records status and limitations.
`cu-results.json` identifies eight reproduced CU failures and a passing control;
`inv086.log` and `inv086-scenario.json` preserve the stateful mismatch.

## Reproduce the focused CU checks

Check out wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13` and sibling
matcher `60aac3a996d0264c47fbefe9a2625d6ee6fb6a47`. Install cargo-build-sbf
4.6.0 and Rust 1.95.0. Run these commands inside each respective checkout:

```sh
# Wrapper root, then each fixture directory:
cargo build-sbf --tools-version v1.52 --arch v0 -- --locked
# Repeat in tests/fixtures/auth_matcher and tests/fixtures/hostile_matcher.
# Repeat in the sibling ../percolator-match checkout.
```

From the wrapper root, execute `reproduce-focused-cu-harness.py` using its
absolute path in this evidence directory. It refuses a different wrapper
revision, original harness hash, engine dependency or generated output hash.
It creates one untracked harness and leaves tracked sources unchanged.

```sh
CARGO_BUILD_JOBS=1 cargo +1.95.0 rustc --locked --test outright_qualification_cu -- -C debuginfo=0 -C codegen-units=256
```

Run the generated executable under `target/debug/deps/` with a fully qualified
`test` value from `cu-results.json`, followed by `--exact --nocapture --test-threads=1`.
The binary hash suffix varies with the build environment. Eight selected cases
fail with exit 101. The 96-world authenticated-price control passes. The harness
registers 211 cases; this record does not claim a complete run of those cases.
The full original CU target failed to compile here after two SIGKILL
terminations; those are environment failures, recorded separately.

## Reproduce the stateful mismatch

```sh
CARGO_BUILD_JOBS=2 cargo +1.95.0 test --locked --test v16_program_stateful_fuzz --no-run
```

Run that executable with filter
`v16_program_reference_model_matches_deployed_public_sequence --nocapture --test-threads=1`.
The pinned upstream persisted seeds are retained. The included JSON is the
scenario emitted by the failing check, not an alternative or weakened assertion.
No one-atom tolerance was added.

## Client correction evidence

`native.log` records all 471 client/terminal/keeper checks plus source and Rust
conformance. `wallet-before.log` and `wallet-after.log` record two identical
DOM probes against the original and corrected terminal. The retained production
regression is `protocol/tests/wallet-adapters.test.mjs`, with 18 scenarios.

Program artifacts were built with platform-tools v1.52 and SBPF v0 for the
pinned legacy LiteSVM harness. Hashes are recorded in the checklist and JSON.
This does not establish current-cluster or real-wallet compatibility. No
production engine/wrapper code or upstream assertion was changed.
