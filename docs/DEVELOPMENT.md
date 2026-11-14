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

The [native client](../protocol/README.md) includes instruction builders, a
portfolio reader, a Rust conformance exporter, and local SBF tests. Install
Node.js 22.12 or newer, then run from the repository root:

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
bash protocol/check.sh
```

The source check rejects engine changes relative to the recorded baseline.
The exporter links this checkout's engine and the pinned wrapper, then compares
instruction bytes and account layouts with `protocol/upstream-contract.json`.
The client tests also cover integer precision, invalid input, account identity,
signer requirements, and PDA derivation.

The [SVM fixture guide](../protocol/svm/README.md) lists its additional toolchains
and execution scope. Its runner builds the wrapper at the pinned revision and
executes the JavaScript instructions against SBF. Host tests and SVM tests run
in separate GitHub Actions workflows.

Build the [wallet terminal](WALLET_TERMINAL.md) with
`npm run build --prefix protocol`. It verifies an enrolled mainnet, devnet or localnet
deployment and supports reviewed wallet transactions. The
[keeper](MARKET_OPERATIONS.md) simulates by default; sending requires an explicit
flag and a dedicated fee payer for the enrolled deployment. The account inspection and profile
enrollment commands remain read-only. There is no hosted quote service, public
market or deployment command in this checkout.

## Reviewing documentation

Check that commands work from the documented directory, local links resolve,
source links use the intended revision, and feature claims match the current
code. Keep completed work separate from the acceptance criteria in
[PRODUCT.md](../PRODUCT.md).

Do not publish credentials, generated test accounts, private keys or RPC URLs
containing access tokens in examples or logs.
