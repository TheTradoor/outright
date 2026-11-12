# Native SBF integration tests

These tests execute the JavaScript client's instruction bytes and account metas
in LiteSVM against the pinned Percolator SBF program and SPL Token. The Rust
fixture invokes `driver.mjs` to construct instructions and read portfolio state.
Successful calls are checked against the resulting Rust-decoded position and
SPL account state.

## Coverage

- Allocate and initialize a portfolio, deposit 25 test USDC, open a 0.1 SOL
  bilateral position, reduce it by half, close it, and withdraw the collateral.
- Reject stale sequence and position-epoch bindings, a different portfolio ID,
  an unauthorized owner, an excessive withdrawal, a different market ID, and
  a bilateral trade without the maker's signature.
- Execute a deposit followed by a rejected withdrawal in the same transaction.
  The failure must occur at the withdrawal, and the earlier SPL transfer,
  portfolio sequence update, and market changes must all roll back.

Rejection tests assert the exact program error and failing instruction index.
They compare complete market, affected portfolio, and tracked SPL accounts
before and after rejection. Fee-payer SOL balances are excluded because failed
transactions can still incur fees.

## Run

Install Node.js 22 or newer, Rust 1.95.0, and `cargo-build-sbf` 4.6.0. The host
conformance exporter uses the repository's Rust 1.100.0. The pinned wrapper's
legacy Solana 1.18 test dependencies require the older host compiler.

```sh
rustup toolchain install 1.95.0 --profile minimal
cargo install cargo-build-sbf --version 4.6.0 --locked
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund

git clone https://github.com/aeyakovenko/percolator-prog.git ../percolator-prog
git -C ../percolator-prog checkout --detach b42fe017c2bc953778f90d0cb85cd1d426b6e783
bash protocol/svm/run.sh ../percolator-prog
```

The runner verifies that Outright's engine source is unchanged from its pinned
baseline. The SBF wrapper uses that same upstream engine revision. It also
requires the wrapper checkout to be at the exact revision with no tracked
changes. It builds the program and upstream authenticated-matcher fixture,
temporarily adds the Outright test, and removes that test file on exit. It
refuses an existing file at the temporary test path and alternate artifact-path
overrides.

The target is SBPF v0 with platform-tools v1.52, matching the pinned LiteSVM 0.1
fixture. `cargo-build-sbf` 4.6.0 defaults to v3, so `--arch v0` is explicit.
The tests use local keys and synthetic assets. No RPC credentials, wallet,
public deployment, or real assets are required.

Local results and binary hashes are recorded in
[Native integration verification](../../docs/NATIVE_VERIFICATION.md).

## Limits

The fixture uses a fixed price, zero funding, and zero trade fees. It does not
cover live oracle delivery, price shocks, liquidation, nonzero fees or funding,
matcher execution, keeper availability, or a wallet interface. The upstream
matcher program is loaded because the shared fixture requires it; that alone
is not matcher-execution coverage.

Local VM results do not establish current-cluster compatibility or approve a
production binary. Program deployment, funded liquidity, market limits, and
independent security review remain separate release requirements.

The `Native protocol` workflow checks source and host conformance. The
`Native SVM` workflow builds SBF and executes these tests. Both use read-only
repository permissions and do not deploy a program.
