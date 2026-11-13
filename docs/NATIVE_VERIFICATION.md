# Native integration verification

Local verification completed on 12 November 2026. These results apply to the
native integration change and the pinned sources below. They are not results
from a deployed market or an independent audit.

## Sources and toolchains

| Item | Revision or version |
| --- | --- |
| Outright base commit | `951c2f63fb66dacb841cec973e43172d45da892a` |
| Percolator engine baseline | `b22bef7d6122fd7d82680ce9859e8b77fd8ef656` |
| Percolator Solana wrapper | `b42fe017c2bc953778f90d0cb85cd1d426b6e783` |
| Node.js | 24.22.1 |
| Host conformance and engine tests | Rust 1.100.0 |
| Legacy SVM host fixture | Rust 1.95.0 |
| SBF builder | cargo-build-sbf 4.6.0 |
| SBF platform tools and target | v1.52, SBPF v0 |

The engine source, manifest, lockfile, specification, and Cargo configuration
match the engine baseline. The host exporter uses this checkout's engine. The
SBF wrapper uses the identical pinned upstream engine source. Its checkout was
clean before and after the test runner.

## Results

| Check | Result |
| --- | --- |
| `cargo test --locked` | 293 passed |
| `cargo test --locked --features fuzz` | 357 passed |
| `bash protocol/check.sh` | Source check and Rust contract comparison passed; 58 JavaScript tests passed |
| `bash protocol/svm/run.sh ../percolator-prog` | 3 SBF integration tests passed |
| Engine comparison with baseline | No differences |
| Revised documentation links and `git diff --check` | Passed |

The default and fuzz-feature runs overlap. Their counts are not additive.
The Rust exporter reproduces the checked-in instruction and account-layout
fixtures without changes.

The SBF tests cover initialization, deposit, open, partial reduction, close,
and withdrawal. Rejection cases cover stale sequence and position epoch,
incorrect portfolio and market identities, unauthorized ownership, excessive
withdrawal, and a missing counterparty signature. Each rejection is checked
against its exact error and failing instruction index, with unchanged market,
portfolio, and SPL accounts.

The bundled-transaction test first executes a deposit and then fails an
excessive withdrawal. The failure at the second program instruction confirms
that the first instruction ran. All observed account changes, including the
SPL transfer and portfolio sequence, roll back.

## Locally tested artifacts

| Artifact | SHA-256 |
| --- | --- |
| `percolator_prog.so` | `d2a05d0e9f578384e740db289f8539688cd0b36ab3ae848558fa24ab258257a4` |
| `auth_matcher.so` | `50e532267926e180f013200c1799e26127dd23dc150866cffd491424629ddf93` |

These hashes identify the local test binaries. They are not public deployment
addresses or a claim of reproducibility across build environments. The matcher
fixture was loaded but not executed by the initial three-test lifecycle. The
wallet-client extension below adds a CPI execution test.

The measured compute units were 27,874 for initialization, 38,098 for deposit,
126,785 for open, 138,387 for partial reduction, 123,193 for close, and 38,986
for withdrawal. These measurements describe this small fixed-price fixture,
not worst-case production limits.

## Remaining verification

Nonzero fees and funding, liquidation, insolvency, production matcher behavior,
and full recovery require additional
transaction coverage. Current-cluster compatibility, funded liquidity, wallet
extension testing, service recovery, and independent security review
remain release requirements. Full Kani verification was not run for this change.

## Wallet-client extension

Built on merged commit `5a1a24461317b8f7aa14f944d918456b03f0a0d3`, with the same
engine and wrapper pins. The extended suite passes the Rust contract comparison,
80 JavaScript regressions, five local SBF tests and the browser bundle build.

The new SBF cases execute seeded portfolio allocation with initialization,
then deposit and an atomic destination ATA creation plus withdrawal. Another
case checks a CPI fill with only the taker signing, rejection of an unacceptable
execution price and rejection after maker consent is revoked. Market and
portfolio readers are checked against the resulting program state.

RPC and wallet-failure regressions use deterministic test doubles. They check
persistence before send, ambiguous responses after broadcast, reload recovery,
message mutation, invalid signatures and refusal to repeat an unresolved action.
They do not establish public-cluster or wallet-extension compatibility.

## Keeper extension

Built on merged commit `f23fffd5b133699be4783861d5e9cdfdcd368a70`, retaining the
same engine and wrapper pins. On 13 November 2026, the Rust contract check,
109 JavaScript tests, seven local SBF tests and terminal build passed locally.

Two SBF cases exercise the keeper planner. One commits a newer synthetic Pyth
observation without the portfolio owner's signature, verifies that a forged
caller slot cannot advance beyond the SVM Clock, and checks unchanged SPL
token balances. The other rejects stale observations, a wrong feed, excessive
confidence and an incorrect provider owner, with exact error assertions and
byte-for-byte market, portfolio and custody rollback checks.

Operator regressions cover durable write failure, interrupted workers,
concurrent cycles, changed source/account bindings, fee exhaustion, ambiguous
broadcast, expiry and reconciliation after restart. A CLI integration test
uses a local JSON-RPC server and two processes: the first signs and submits;
the second reconciles the saved signature without a second broadcast. This
server is a deterministic RPC fixture, not a public cluster.

Live provider publishing, a funded public deployment, hosted service recovery,
portfolio discovery and full wallet-extension validation remain unverified.


## Portfolio allocation and terminal recovery

Built on merged commit `4dcc76ef156b69f3cf032a613581da37bd011c5e`, retaining the
same engine and wrapper pins. Verification on 13 November 2026 covers the Rust
contract comparison, 141 JavaScript tests, eight SBF tests and terminal bundle.

The new SBF case funds the deterministic portfolio address from another wallet
before creation. It verifies atomic allocation and initialization with less
than, exactly and more than the required rent. A later duplicate initialization
must fail with `AlreadyInitialized` and roll back allocation, rent, market and
tracked token-account changes. Excess SOL remains outside trading collateral.

Client regressions change matcher bytecode, consent, oracle freshness, market
mode, portfolio sequence, fee-payer balance and account allocation while the
wallet prompt is open. Changed instructions or invalid state must prevent
broadcast. Additional cases reject malformed RPC slots and block heights and
preserve the action captured before asynchronous work begins.

Ten DOM tests run the actual terminal HTML and module under jsdom with fixture
wallets and RPC data. They cover disconnects, unsupported accounts, a late RPC
response, RPC failure and recovery, empty asset lists, revoked and expired maker
consent, stale receipt text and multi-wallet unregistration. This is Node-based
DOM coverage. It does not test rendering, mobile behavior or a wallet extension.

### Dependency review

The Solana web3.js dependency uses an exact `jayson` 5.0.0 override. Its browser
JSON-RPC interface retains the SDK's request/callback API and uses Web Crypto
for request identifiers. The CLI integration test exercises this path through
an actual local HTTP server, including restart reconciliation. The override
removes the old `uuid` and `stream-json` dependency paths. The terminal bundle
also builds with this dependency set.

The remaining `npm audit` result contains three high-severity package entries
for one underlying advisory: [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).
`bigint-buffer` 1.1.5 has no published official fix. It enters through
`@solana/spl-token` and `@solana/buffer-layout-utils`. The reported overflow is
in the native binding. A clean `npm ci --ignore-scripts` installs no native
binding, and `protocol/.npmrc` makes script suppression the project default.
The browser bundle uses the package's JavaScript implementation. Account readers
also validate exact SPL account sizes before decoding fixed-width integers.

These measures do not remove the advisory or constitute a patched dependency.
A previously built native binding can remain after `npm install`; use a clean
`npm ci --ignore-scripts`, and do not rebuild the optional binding. Resolve or
independently review this dependency before a public release. The audit's
suggested downgrade to SPL Token 0.1.8 is not an API-compatible repair and was
not applied.
