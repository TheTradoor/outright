# Native integration verification

Latest local verification completed on 13 November 2026: the source and Rust
contract checks and terminal build passed. The client now has 241 JavaScript
tests, including 18 DOM cases, and 13 SBF tests. A clean dependency install and
audit at the preceding revision reported zero vulnerabilities; this change
does not modify dependencies. These results do not come from a deployed market
or an independent audit. The preceding funding and liquidation work was merged
in [pull request #5](https://github.com/TheTradoor/outright/pull/5).

The sections below record the initial 12 November baseline and each subsequent
extension. Earlier test counts describe those revisions. See
[Resolved settlement and payout receipts](#resolved-settlement-and-payout-receipts)
for the latest coverage, and the preceding section for dependency changes.

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

Nonzero base fees, fractional funding and bounded partial liquidation now have
local SBF coverage, described below. Live Hybrid funding, mark-movement and
backing fees, liquidation stress cases, insolvency, production matcher behavior
and full recovery still require additional transaction coverage.
Current-cluster compatibility, funded liquidity, wallet
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

At this revision, `npm audit` reported three high-severity package entries
for one underlying advisory: [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).
The affected `bigint-buffer` 1.1.5 package entered through `@solana/spl-token`
and `@solana/buffer-layout-utils`. Disabling install scripts avoided building
its native binding but did not remove the advisory. The latest extension below
removes that dependency path. Script suppression remains the project default.
The audit's suggested downgrade to SPL Token 0.1.8 was not applied.

## Fee consent and confirmation integrity

Built on merged commit `b3b0e2ac563315e9bebc82cd074d50c736b08ed5`, retaining the
same engine and wrapper pins. On 13 November 2026, the Rust contract comparison,
174 JavaScript tests, nine SBF tests and terminal bundle passed locally.

The new SBF case executes the wallet planner with a 37 bps market base fee, a
50 bps taker base fee cap and 37 bps maker consent. This distinction matters:
the pinned single-trade CPI route charges the market base fee, not the caller's
fee-cap input. The client now compares both parties' consent with that on-chain
base fee. Review shows the current base fee, taker cap and engine fee limit
separately. A changed base fee or engine limit during signing requires review
again. Mark-movement fees can exceed the base cap; backing fees are separate.

At a fixed execution price of 150.000001, a 0.100001-unit fill charges 55,501
collateral atoms to each counterparty. Partial closes of 0.050000 and 0.050001
units charge 27,751 atoms each. Separate long and short cases also open and
close one micro-unit, charging one atom per fill. After each fill, tests compare
capital, insurance, aggregate capital, positions, vault and SPL token balances.
Withdrawals return the remaining capital; total observed token supply stays
unchanged. A taker cap below the base fee, a later failing instruction and a
withdrawal one atom above remaining capital must return exact errors and leave
market, portfolios, matcher context and tracked token accounts unchanged.

Wallet and keeper reconciliation reject malformed, stale or inconsistent
status responses without releasing the pending receipt. The wallet persists
its observed slot across reloads. Keeper block heights must be nonnegative safe
integers, and the last pre-signing snapshot cannot precede the fee estimate.
These tests use RPC fixtures, not a public validator.

Twelve DOM tests now cover the terminal, including a delayed startup profile
after manual selection and the distinction between base fee and cap in review.
The startup request is bounded, and a failed action read releases the wallet
action lock. Browser rendering, mobile behavior and wallet-extension execution
remain unverified. The dependency advisory was still open at this revision.

## Receipt slot recovery and wallet session changes

Built on local commit `f0dc09f7d5192778080e8aed88b6ee0da90bc9ac`, with the same
engine and wrapper pins. On 13 November 2026, the Rust contract comparison,
194 JavaScript tests, nine SBF tests and terminal bundle passed locally.
GitHub upload and CI were incomplete when this local run was recorded.

New regressions reproduce older account data after a page reload, even when
the saved transaction was confirmed, finalized or failed. Account reads and new
reviews now inherit both the receipt's response-bank slot and its landing slot.
Legacy final receipts retain their landing-slot bound. Invalid slot values are
rejected. Out-of-order account reads and a receipt write that completes after a
newer snapshot cannot move the client's slot bound backward.

The 15 DOM tests include actual client submission with deterministic fixture
signatures. They delay the send response, disconnect the wallet, and check a
successful response, a lost response and a failed receipt update. The old
receipt and error must not reappear in the disconnected interface. Reconnecting
the original account restores its saved signature without another broadcast.
Disconnecting does not cancel a signed transaction.

These additions covered receipt consistency and session behavior. Funding,
liquidation, recovery and the dependency advisory were not addressed by this
revision. The subsequent extension is recorded below.

## Funding, liquidation and classic SPL Token

Built on local commit `84bd5488d0a95c91111334dcec5da4720c5957f1`, retaining both
source pins and the SBF binary hashes recorded above. On 13 November 2026, a
clean install, the Rust contract comparison, 212 JavaScript tests, 11 SBF tests
and the terminal build passed locally. The JavaScript count includes 15 DOM
tests and 18 new token-format regressions. The synchronized GitHub source is
commit `522bc71e1c0b295a00bbd62233ecebc4abfe6379`; its tree matches the locally
tested tree exactly. GitHub results are linked in pull request #5. These tests
do not run on a public cluster.

### Funding settlement

The new SBF case supplies a controlled AuthMark premium in both directions and
compares one 24-slot settlement with two 12-slot settlements. A transfer of
2.962962936 collateral atoms charges the payer three atoms and records two
atoms of receiver PnL under the engine's rounding rules. Fractional carry avoids
charging four atoms when settlement is split. Both settlement orders are
exercised. Index values, capital, PnL, aggregate capital, insurance and SPL
custody are checked against the resulting program state.

A later failing instruction rolls the funding settlement back. Repeated cranks
at the same slot may refresh bookkeeping, but cannot collect funding again and
must reach the exact non-progress error. The receiver's recorded PnL is not a
tested withdrawal or payout. AuthMark is a local accounting fixture; this test
does not add AuthMark support to the devnet keeper or prove live Hybrid funding.

### Partial liquidation

The keeper planner is exercised for both a long and a short position with ten
units of collateral and 150 units of initial notional. Synthetic Pyth prices
move against each position through two bounded oracle updates. Permissionless
cranks recognize the loss and partially liquidate the unhealthy position.
Tests independently calculate the rounded liquidation fee and check remaining
exposure, capital, insurance, aggregate capital and the health certificate.

The trader's SPL custody and the peer portfolio stay unchanged during this
maintenance. A stale oracle rejects liquidation. A later failing instruction
rolls back both the refresh and liquidation attempts. A one-atom withdrawal
with the remaining active position returns `EngineStale` and changes no tracked
accounts, consistent with the pinned engine's withdrawal rule.

### Token dependency removal

The client now uses a small classic SPL Token reader and ATA instruction builder
in `protocol/src/token.mjs`. It uses native JavaScript `BigInt`, requires exact
82-byte mint and 165-byte account layouts, validates ownership and flags, and
rejects noncanonical option tags. Token-2022 is not supported.

The Rust conformance exporter packs mint and token-account fixtures with the
official `spl-token` 4.0.3 implementation. These include maximum u64 values,
values above JavaScript's safe integer range, optional authorities, native
reserve values and all account states. Associated-address and instruction
fixtures were generated with `@solana/spl-token` 0.4.15 before its removal.
The SBF suite also executes atomic ATA creation and withdrawal through the new
builder against the real SPL program in the local VM.

A clean `npm ci --prefix protocol --ignore-scripts` no longer installs
`@solana/spl-token`, `@solana/buffer-layout-utils` or `bigint-buffer`. The locked
dependency set returned zero npm advisories on 13 November 2026. This result
describes that audit query, not an independent security assessment.

Browser rendering, mobile behavior, wallet-extension execution, public-cluster
compatibility, live service operation, insolvency and complete recovery exits
remain unverified. No engine or wrapper source was changed.

## Resolved settlement and payout receipts

The adapter now exposes owner-signed `CloseResolved` and
`ClaimResolvedPayoutTopup` instructions. Their bytes are compared with the
pinned Rust encoder. Receipt and payout-ledger offsets are exported from the
same Rust types; the reader rejects malformed flags, hidden receipt state,
invalid face bounds, overpayment and inconsistent finalization.

Two additional SBF cases verify the new paths. The underfunded case adapts the
wrapper's INV-067 late-backing trace, constructing its market through public
instructions. The JavaScript close initially transfers 1,250 collateral atoms
and retains the partial receipt. An upstream public crank expires 500 atoms of
backing. The JavaScript receipt calculation and claim agree on that additional
500-atom payment, giving a total of 1,750. Claims before or after the additional
payment cannot pay twice. Bounded close continuations reach the fixture's full
terminal predicate without changing mint supply.

A wrong-owner destination rejects at instruction 2 with `InvalidTokenAccount`
and leaves complete market, portfolio and SPL accounts unchanged. A successful
claim followed by invalid instruction data rejects at instruction 3 and rolls
the payment back. In the second case, the wallet planner creates a missing ATA
and closes a flat resolved portfolio for 2,500,000 atoms. A later failure at
instruction 4 rolls back both ATA creation and settlement.

Host tests verify exact payout arithmetic beyond JavaScript Number precision,
vault caps, market-mode gates, disabled zero-due claims and changes while the
wallet is open. The terminal tests cover review text, receipt amounts, disabled
Recovery actions, empty asset lists and clearing settlement data on disconnect.

The local VM rejects a repeated identical transaction as already processed.
Unlike deposits and trades, settlement instructions carry no changing sequence
field. The client therefore requires a fresh blockhash for consecutive
settlement steps, using the durable receipt even after reload. A receipt written
by another tab also blocks reuse before the wallet prompt.

This establishes one underfunded resolved-market path, not general recovery.
The expiry step uses the upstream fixture; Outright's keeper still rejects
resolved targets. Asset Recovery forfeits, payout-halt recovery, multi-asset
insolvency stress, full teardown and live service operation remain open. Engine
and wrapper pins are unchanged. Browser/mobile rendering and real wallet
extensions have not been validated in this environment.
