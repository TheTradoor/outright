# Development and verification

## Requirements

Use Git and [rustup](https://rustup.rs/). The repository selects Rust 1.100.0
through [rust-toolchain.toml](../rust-toolchain.toml); rustup installs it when
needed. Dependencies are locked in `Cargo.lock`.

Run commands from the repository root. The inherited `.cargo/config.toml`
sets the stack size used by the engine tests.

## Runtime tests

```sh
cargo test --locked
cargo test --locked --features fuzz
```

The default suite covers the engine's runtime tests. The `fuzz` feature adds
the gated reference-model, property and arithmetic tests. This is a finite
test run, not an ongoing fuzzing service.

[Engine tests](../.github/workflows/engine.yml) runs both commands as separate
jobs for pushes, pull requests and manual workflow runs. Jobs use a read-only
repository token and do not deploy programs or access wallet keys.

## Proofs

The upstream Kani harnesses and runners are retained. See [ENGINE.md](../ENGINE.md)
for setup and commands. Kani is not part of the default GitHub Actions workflow.
The upstream guide's proof inventory is not a record of checks run by Outright.

When reporting a proof result, include the source revision, verifier version,
feature flags, harness selection and result. Runtime tests and Kani checks must
be reported separately.

## Native integration

The native adapter and transaction fixture have not yet been imported. Earlier
integration work exists separately, but its results must not be presented as a
test of this repository. Importing it requires fresh conformance checks and
transaction tests against the revisions in [UPSTREAM.md](UPSTREAM.md).

There is no application server, wallet connection command or deployment command
in this checkout. Those instructions will be added with the corresponding code.

## Reviewing documentation

Check that commands work from the documented directory, local links resolve,
source links use the intended revision, and feature claims match the current
code. Keep completed work separate from the acceptance criteria in
[PRODUCT.md](../PRODUCT.md).

Do not publish credentials, generated test accounts, private keys or RPC URLs
containing access tokens in examples or logs.
