# Native SBF integration tests

These tests execute the JavaScript client's instruction bytes and account metas
in LiteSVM against the pinned Percolator SBF program and SPL Token. The Rust
fixture invokes `driver.mjs` to construct instructions and read portfolio state.
Successful calls are checked against the resulting Rust-decoded position and
SPL account state.

## Coverage

- Allocate and initialize a portfolio, deposit 25 test USDC, open a 0.1 SOL
  bilateral position, reduce it by half, close it, and withdraw the collateral.
- Recover a seeded address prefunded by another wallet, allocating only an empty
  System account and charging only the missing rent. Check exact-rent and surplus
  balances, and atomic rollback when a later instruction rejects initialization.
- Reject stale sequence and position-epoch bindings, a different portfolio ID,
  an unauthorized owner, an excessive withdrawal, a different market ID, and
  a bilateral trade without the maker's signature.
- Execute a deposit followed by a rejected withdrawal in the same transaction.
  The failure must occur at the withdrawal, and the earlier SPL transfer,
  portfolio sequence update, and market changes must all roll back.
- Settle nonzero funding in both directions, once after 24 slots or twice after
  12 slots. Check fractional carry, exact index values, capital and PnL,
  settlement rollback and repeated cranks without a second charge.
- Refresh and partially liquidate unhealthy long and short positions through
  the keeper planner with synthetic Pyth data. Check rounded fees, remaining
  exposure, health, custody, stale-oracle rejection and transaction rollback.
- Settle an underfunded resolved market through the JavaScript close and claim
  instructions. Preserve a partial payout receipt, release expired backing
  through the upstream public crank, and pay the remaining available amount
  exactly once. Reject another owner's destination and roll back a successful
  payout when a later instruction fails.
- Execute the wallet planner's resolved close with atomic ATA creation. A later
  instruction failure must roll back the new ATA, custody and accounting.
- Execute the resolved keeper planner with a dedicated fee payer and an existing
  owner ATA. Check initial payout, backing discovery, the later payout, wrong
  destinations and rollback without the owner's signature. A forged caller slot
  cannot bypass the program's authenticated permissionless-close delay.

Rejection tests assert the exact program error and failing instruction index.
They compare complete market, affected portfolio, and tracked SPL accounts
before and after rejection. Fee-payer SOL balances are excluded because failed
transactions can still incur fees.

## Run

Install Node.js 22.12 or newer, Rust 1.95.0, and `cargo-build-sbf` 4.6.0. The host
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

An optional second argument filters test names, for example:

```sh
bash protocol/svm/run.sh ../percolator-prog fractional_funding
```

Omit the filter for full verification.

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

The original trading fixtures use fixed prices and zero funding. One CPI lifecycle
uses a 37 bps on-chain base fee with a 50 bps taker cap, verifies fees on both
counterparties, and checks rounding through partial closes and one-micro-unit
positions in both directions. Failed transactions must roll back fees,
insurance, positions, matcher context and custody changes.
Additional keeper cases advance an authenticated synthetic Pyth observation and
reject stale, wrong-feed, excessive-confidence and wrong-owner data, checking
rollback. A forged caller slot cannot advance beyond the SVM Clock.
The nonzero funding case uses a controlled AuthMark premium. AuthMark is not
accepted by the devnet keeper; this fixture checks accounting through the
low-level JavaScript instruction builder. The liquidation case uses the keeper
planner and synthetic Hybrid Pyth observations. It covers bounded partial
liquidation, not every insolvency or recovery path. A retained active position
must still prevent withdrawal under the pinned engine's rule.

The suite does not cover live oracle delivery, live Hybrid funding,
mark-movement or backing fees, full recovery, production matcher behavior,
hosted keeper availability or wallet-extension compatibility.

The resolved fixtures adapt the pinned wrapper's INV-067 late-backing trace.
Every economic transition uses public instructions. The wallet case uses an
upstream backing-discovery step; the keeper case executes the JavaScript planner
for discovery and payouts. The operator path is opt-in and services configured
targets and asset hints only. Asset Recovery forfeits, general insolvency stress
and complete market teardown remain outside this client's coverage.

Local VM results do not establish current-cluster compatibility or approve a
production binary. Program deployment, funded liquidity, market limits, and
independent security review remain separate release requirements.

The `Native protocol` workflow checks source and host conformance. The
`Native SVM` workflow builds SBF and executes these tests. Both use read-only
repository permissions and do not deploy a program.

The suite also runs the wallet planner's seeded portfolio creation and atomic
ATA withdrawal against SBF. The authenticated matcher fixture is exercised by
a bounded CPI fill, price-limit rejection and revoked-consent rejection. This
fixture is not a production liquidity model.
