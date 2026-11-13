# Native integration verification

Latest local verification completed on 14 November 2026 (UTC+7): the source and Rust
contract checks and terminal build passed. The client now has 452 JavaScript
tests, including 61 terminal DOM scenarios, and 17 SBF tests. A clean dependency install and
audit at the preceding revision reported zero vulnerabilities; this change
does not modify dependencies. These results do not come from a public market
or an independent audit. The preceding funding and liquidation work was merged
in [pull request #5](https://github.com/TheTradoor/outright/pull/5).

The sections below record the initial 12 November baseline and each subsequent
extension. Earlier test counts describe those revisions. See
[Trader onboarding](#trader-onboarding)
for the latest coverage. Earlier sections record settlement and dependency changes.

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
The original wallet fixture uses the upstream expiry step; the keeper extension
below replaces that step with the client planner. Asset Recovery forfeits, payout-halt recovery, multi-asset
insolvency stress, full teardown and live service operation remain open. Engine
and wrapper pins are unchanged. Browser/mobile rendering and real wallet
extensions have not been validated in this environment.

## Resolved keeper and restart protection

The keeper can service a resolved market when `settleResolved` is enabled. It
supplies one rotating asset hint, no oracle accounts, and the verified owner's
canonical payout ATA. The owner account is not marked as a signer. Mint and
token-account checks are shared with the wallet client; the resolved destination
also rejects delegates and close authorities. The close delay comes from the
pinned Rust wrapper layout. The engine's code and account layout are unchanged.

The fourteenth SBF case executes the keeper planner against the INV-067
underfunded fixture. A separate fee payer creates the test owner's ATA during
setup. The keeper then pays 1,250 atoms, discovers 500 atoms of expired backing
and pays that additional amount without the owner's signature. The total remains
1,750 after repeated settlement attempts and final close continuations. Wrong
destinations reject with `InvalidTokenAccount`; a later rejected instruction
rolls back the payout. A forged caller slot before the permissionless-close
delay rejects with `ExpectedSigner` and leaves tracked state unchanged.

Host tests cover the explicit opt-in, unchanged default configuration hashes,
missing live oracle accounts after resolution, pinned asset identity, owner
delay, missing ATA, payout halt and cursor progress. Invalid destination or vault
ownership, token mint, delegates, close authority, frozen state, insufficient
custody and changed mint configuration all prevent signing. A custody, policy or
mode change after simulation also stops submission.

The keeper now persists its last submitted blockhash separately from the last
displayed result. A repeat blockhash yields `waitingForBlockhash`, without
reserving another fee. Restart, dry-run and deferred-target tests exercise this
guard, including older v1 journals. Both live and resolved CLI cases use a local
JSON-RPC server and three independent processes: submit, reconcile, then refuse
to submit the same blockhash again. Those RPC fixtures do not execute SBF; the
separate SBF case establishes the program transition.

The worker does not create payout accounts or spend account rent. It defers
missing ATAs and payout halts without starving other configured targets. Full
market discovery, asset Recovery exits, payout-halt repair, market teardown,
multi-asset insolvency stress and hosted operation remain unfinished. There is
still no public deployment or independent audit.

## Owner-reviewed Recovery exits

The wallet planner and terminal now expose `ForfeitRecoveryLeg` for an eligible
retained position. The wire fixture comes from the pinned Rust encoder and
includes a large portfolio ID, the maximum position epoch and a full-width
shared-loss budget. The client requires explicit forfeiture consent, binds the
selected asset incarnation and rejects active live exposure. The terminal keeps
ordinary trading and settlement controls separate from the Recovery action.

The new SBF test creates deterministic portfolios through System and program
instructions, deposits 1,000 atoms for each counterparty, opens ten units at 100,
and advances the mark to 105 through a public crank on another portfolio. Neither
trader has refreshed that price change. After public asset shutdown, the planner
discards the winner's 50-atom unbooked gain and applies the loser's 50-atom loss.
The resulting capital is 1,000 and 950 atoms. Both actions use a one-atom B-loss
budget, demonstrating that it does not cap price losses. The actions transfer no
tokens and preserve mint supply.

Live exposure, the wrong owner and a stale position epoch reject with exact
program errors. A later invalid instruction rolls back the forfeiture and all
tracked financial state. A successful step increments the position epoch;
replaying the earlier consent with a fresh blockhash rejects. These tests do not
claim that a forfeiture completes the market's Recovery process.

RPC tests cover admission, explicit consent, asset identity, exact amount
encoding, unchanged instruction custody, reconciliation and duplicate prevention
after a failed transaction and client reload. The complete market and portfolio
data are hashed during review and checked again after signing, so changes in
accounting omitted from UI projections also invalidate review. State can still
change after that read and before execution.

The 21 DOM cases include Recovery consent, loss-budget wording, disconnect
cleanup and suppression of forfeiture for ordinary live positions. A profile
with unsupported collateral decimals is rejected without replacing the active
profile. Six-decimal classic SPL collateral remains the only supported scale.
These are DOM tests, not browser rendering or wallet-extension verification.

Payout-halt repair, broader multi-asset insolvency, complete teardown, hosted
services and public-cluster validation remain open. Engine and wrapper pins are
unchanged; no public funds or deployment are involved in these tests.

## Retained obligations and Recovery finalization

Built on merged commit `68cd6f08bdc0103f63589e6266964b25b8a3db43`.
An SBF regression reproduced a client failure after a successful owner forfeiture:
the program retained an active leg with zero position basis and positive loss
weight, but `readPortfolio` rejected it as an invalid position. The exposure
reader independently rejected zero basis in the current side epoch. Together
these checks prevented wallet refresh and keeper continuation for valid state.

The reader now admits retained obligations and checks the pinned engine's
static active-leg bounds. Loss weight, shared-loss remainder, the B epoch and
price/funding snapshots are read at Rust-exported offsets. Nonzero loss weight,
its exposure-derived lower bound, the scale limits and epoch consistency remain
required. The terminal displays zero effective exposure as **Pending cleanup**;
it does not treat the leg as absent or the portfolio as settled.

The new SBF trace adapts upstream INV-071 for both long and short target legs:

1. Create deterministic wallet portfolios, deposit 2,012 collateral atoms across
   four actors and trade two assets through public instructions.
2. Move the second asset's authenticated mark, shut down both assets and use
   the wallet planner to forfeit the target, its peer and a debtor's legs.
3. Read and display the target's retained zero-basis obligation. Attempting to
   remove its account rejects without changing tracked financial state.
4. Expire the debtor's bounded close. The keeper planner triggers global
   Recovery, then releases the target's obligation in a separate transaction.
   A later instruction failure rolls back that cleanup. A successful cleanup
   advances the position epoch without changing token custody.
5. Finalize Recovery in a later crank. The authenticated Clock sets the resolved
   slot and starts a fresh five-slot owner window; frozen asset clocks stay fixed.
6. Reject a forged early payout slot. At the real deadline, pay exactly 1,000
   atoms to the owner's verified ATA, leave 1,012 atoms in the vault and reject
   another payout with `EngineNonProgress` and unchanged tracked state.
7. Close the terminal target through the upstream owner instruction. Its rent
   moves to the market slab; mint supply is unchanged throughout the trace.

RPC tests exercise the same retained shape in both market and asset Recovery,
DrainOnly and active-side states, including malformed accounting rejection.
Keeper tests cover submission and pending-receipt duplicate prevention. The DOM
suite checks both sides display zero exposure with pending cleanup and require
fresh forfeiture consent. The full local suites and contract check pass.

This establishes one target's payout after global Recovery. Other portfolios
still require settlement; it does not prove complete market teardown or general
insolvency liveness. Payout-halt repair, broader stress coverage, hosted services,
wallet-extension and mobile testing, public-cluster validation and independent
security review remain open. No engine or wrapper source was changed.

## Missing keeper targets

Built on merged commit `1a1290aefe96d17797cd9eea23f678d80b6118cb`.
Six regression cases reproduced the keeper stopping when a configured
portfolio returned `null`: before the initial read or after simulation, in live,
Recovery and resolved markets. The strict portfolio reader treated absence as
an ownership error, preventing subsequent targets from being serviced.

The snapshot reader now represents explicit RPC absence as `portfolio: null`.
The planner defers that target, and the worker does the same if the final read
finds it absent. It durably advances the cursor and minimum observed slot without
signing, reserving fees or clearing any pending transaction. Program and account
validation still runs for the rest of the snapshot. Present but malformed
accounts continue to reject.

The new tests cover all six failure cases and processing the next target after
restart, simulation-only operation without a signer, a returning original
incarnation, rejected new incarnations and owners, empty accounts, malformed RPC
arrays, stale banks, and network/program/market/payer/mint/vault failures.
Pending signatures must reconcile before reading targets, and deferral cannot
erase the last submitted blockhash or cumulative fee reservation.

Two local JSON-RPC tests run the actual CLI with `--watch`, one in live mode and
one in resolved mode. Each emits a missing-target deferral, submits only for the
second target, handles `SIGTERM` cleanly, reconciles the durable receipt in a new
process and retains duplicate protection after another missing-target cycle.
The client suite has 334 passing tests, including the existing 22 terminal DOM
scenarios. All 16 existing SBF tests, the Rust contract comparison, source-pin
check and terminal build also pass.

These tests exercise the operator process against deterministic RPC fixtures.
They do not establish hosted keeper uptime or public-cluster behavior. An absent
account is not evidence of settlement completion. Engine and wrapper source,
instruction bytes, dependency versions and the journal schema are unchanged.

## Complete settlement review

The previous client compared settlement display fields after the wallet signed.
It omitted other accounting consumed by the engine. Ten failing regressions
reproduced that gap for both `CloseResolved` and `ClaimResolvedPayoutTopup`:
changes to market insurance, total capital, portfolio cancel-deposit escrow,
close residual and source backing passed the old check. The portfolio offsets
come from the pinned Rust types. These are isolated RPC-fixture mutations, not
proof that the mutated ledgers are valid engine transitions.

Both settlement actions now use the same complete market and portfolio data
hash as Recovery review. The client revalidates the deployment and accounts
after signing and refuses to send if either data buffer changed. No transaction
receipt is written on these rejection paths. The consumed review cannot be
reused; a new simulation and explicit review can proceed. The snapshot field is
now named `accountingStateHash`, replacing `recoveryStateHash`.

Nineteen additional JavaScript tests cover the omitted fields, the existing
receipt/rate/custody/fee comparisons for additional claims, unchanged accounting
at a later RPC bank, and two terminal rejection paths. The terminal closes a
consumed review after a submission error so the error and a new review are
accessible. Both controls were tested through the actual terminal module with a
local deterministic Wallet Standard fixture. The full suite has 353 passing
tests, including 24 terminal DOM scenarios. All 16 SBF lifecycle tests, the Rust
contract comparison, source checks and terminal build also pass.

The stricter comparison can require another review when any transaction changes
the shared market, including activity by a different user. RPC context-slot
advancement or account rent funding alone does not change the accounting hash.
This is a pre-broadcast check, not an execution-time state lock: the program
remains authoritative after the client sends. Engine and wrapper source pins,
payout arithmetic and instruction encodings are unchanged. Public-cluster
operation, real browser/mobile-wallet testing, complete market teardown and
independent review remain open.

## Resolved account and market closure

The wallet now offers `ClosePortfolio` in resolved markets after preliminary
checks of displayed balances, claims, positions and locks. The engine simulation
must also permit the complete account state. Review explains that every account
lamport, including rent, moves to the market slab. No token transfer or ATA
creation is included. The instruction binds portfolio ID, owner sequence and
position epoch, and the client rechecks complete accounting after signing.

The adapter also provides a low-level single-collateral `CloseSlab` builder.
Instruction bytes for both operations match fixtures emitted by the pinned Rust
encoder. The market reader exposes the authority epoch from Rust-exported
control-sequence offsets. It recognizes the Rust-generated closed-market
header, verifies its program owner and header, and stops wallet actions with an
explicit closed-market message.

Both existing underfunded SBF traces now finish the primary market after the
initial 1,250-atom payout and the later 500-atom payment. JavaScript instructions
remove every primary portfolio. An outstanding partial receipt rejects removal,
and the remaining terminal portfolio prevents early market closure. All three
portfolio bindings, the market authority epoch, ownership and payout destination
are tested against exact program errors. Later invalid instructions roll back
portfolio removal and final vault closure, including their rent movements.

After a public market-authority handoff, seven unbooked collateral atoms are
transferred into the empty vault through SPL Token. Final closure sends exactly
those seven atoms to the new authority, closes the vault, refunds its rent plus
the market's excess rent, and retains the closed-market header at its canonical
rent exemption. The owner's 1,750-atom payout and mint supply remain unchanged.
Repeating the closure with a fresh blockhash cannot change tracked accounts.
The wallet planner's seeded-portfolio case also executes its new account-closure
plan after settlement and checks the exact SOL transfer to the market.

There are 381 passing JavaScript tests, including 26 terminal DOM scenarios.
The two additional DOM cases cover account-closure review and refresh after
removal, and disabled wallet actions after market closure. Client tests cover
simulation rejection, incomplete state, changed accounting during signing,
strict bindings, missing ATAs and malformed closed headers. The 16 SBF tests,
Rust contract comparison, source checks and terminal build pass.

This establishes complete teardown for two paths through one underfunded
single-collateral fixture, not every terminal accounting configuration. Booked
residue burning, native or dual collateral, payout-halt repair, large scans,
real browser/mobile wallets, public-cluster operation and independent review
remain outside this verification.

## Wallet retries after a final result

Built on merged commit `97a6baffdb9a24d9c1072fd5d944437d7d3cb188`, with unchanged
engine, wrapper and dependency pins. The fresh-blockhash rule now applies to
every wallet action. Previously, portfolio creation, deposit, withdrawal and
trade could review and sign the same message again after a confirmed failure.
Failed execution does not advance the portfolio's sequence bindings, so the
second attempt could reuse the earlier signature and its cached result.

The durable receipt is checked before simulation and again under the wallet
lock before signing. Rejection preserves the original receipt and does not
prompt the wallet or broadcast. The policy also requires a new blockhash after
success and for a changed request. A wallet rejection before receipt persistence
does not consume a blockhash. There is no automatic replacement or re-signing.

Fifteen client regressions cover the four ordinary actions after confirmed
failure, lost send responses followed by reconciliation, reload, final receipts
written by another tab, successful confirmation and wallet rejection. Fourteen
failed against the previous client; the wallet-rejection control already passed.
The additional terminal DOM case preserves a failed deposit's receipt, displays
the blockhash wait and opens a new review only after the RPC advances. These RPC
fixtures check client behavior and do not execute the engine.

A separate SBF trace starts with ten collateral atoms and requests an eleven-atom
deposit. The pinned wrapper returns `InvalidTokenAccount` from its source-balance
check, leaving financial state unchanged. An SPL transfer adds the missing atom.
The identical deposit still returns `AlreadyProcessed`; advancing the blockhash
permits one eleven-atom transfer into the vault and portfolio capital. Repeating
that successful message also returns `AlreadyProcessed`. Mint supply and all
tracked financial accounts are checked. Fee-payer SOL is excluded from rollback
comparisons because failed transactions can incur fees.

Verification passes 397 JavaScript tests, including 27 terminal DOM scenarios,
17 SBF tests, the Rust contract comparison, source checks and the terminal build.
This covers a local runtime retry path and client safeguards, not public RPC
reliability, browser-extension compatibility or an independent security review.

## Wallet session changes during reconciliation

Built on merged commit `3d686a4e602a41cef6d2cedd5c6ef636e4f01d99`. An error from a
pending simulation or signature lookup could overwrite the message for a wallet
that had already disconnected. A reconciliation failure could also leave the
previous market snapshot and its action controls visible.

The terminal now binds action errors and polling continuations to the wallet
session that started them. A current-session reconciliation failure clears
actionable market data and closes any review, while retaining the visible
signature and durable receipt. A later successful reconciliation reads verified
account data again before restoring controls. It does not replace or resend a
transaction. A completed request from an old session cannot clear or refresh
the replacement session.

Eight added DOM scenarios cover late simulation success and failure, late
confirmation success and failure, unavailable and malformed status responses,
receipt-write failure, and an obsolete background poll. The recovery cases keep
the original signature, restore verified data when the RPC/storage recovers,
and assert that no additional transaction is sent. Seven of these scenarios
fail against the previous terminal; the late-confirmation success control
already passes. The fixture executes the terminal module and the real client
reconciliation method with deterministic RPC, wallet and storage adapters.

Local source checks, Rust contract comparison, the terminal build and all 405
JavaScript tests pass, including 35 terminal DOM scenarios. The 17-case SBF
suite and the code it exercises are unchanged; its last local run is recorded
in the preceding wallet-retry section. No engine, wrapper, dependency, account
layout or transaction instruction changed. These results do not establish
browser-extension, mobile-wallet or public-cluster compatibility.


## Wallet selection lifecycle

Built on merged commit `69c6625e40b390c65d59874fde1b39ec3294b486`. A pending
connection could attach a wallet after the chooser had closed or the wallet had
unregistered. A connect result or account-choice button could also retain an
account whose authorization or signing support had been removed. Connection
errors were written behind the still-open modal dialog.

Selection work is now scoped to the current chooser and deployment profile.
The terminal ignores responses after the chooser closes, checks that the wallet
remains registered and compatible, and intersects the connection result with
currently authorized accounts. A later account choice resolves the current
account object and repeats its support checks. Errors appear inside the chooser
with an alert role, and retry clears the error. Closing the chooser does not
cancel the wallet provider's own prompt or revoke permissions already granted.
The outstanding connection still holds the terminal busy until it settles.

Eight additional DOM cases cover rejection and retry, delayed approval and
rejection after closing the chooser, unregistration during connection, removed
accounts in a connect result, lost authorization or signing support while an
account list is open, and a valid replacement account object. Seven fail against
the preceding terminal; the valid-account control already passes. No connection
case broadcasts a transaction. The fixture runs the actual terminal module with
deterministic Wallet Standard, DOM and RPC adapters.

Source checks, Rust contract comparison, the terminal build and all 413
JavaScript tests pass, including 43 terminal DOM scenarios. The 17-case SBF suite,
engine, wrapper, account layouts, instruction builders and dependency pins are
unchanged. These results do not establish compatibility with a real wallet
extension, a physical mobile device or a public cluster.


## Submission progress and receipt recovery

Built on merged commit `e919ff97796b2ce10f8256c25fa528bcbd19fbb7`. The review's
cancel control remained available while signing, revalidation or sending was
pending even though closing that dialog did not cancel the operation. A second
receipt write could also fail after broadcast, leaving the terminal displaying
no transaction or an earlier transaction instead of the already saved signature.

The review now disables its cancel control, close form and Escape during
submission, and displays the wallet and verification/submission phases. The
wallet can reject an unapproved request. Pre-signing cancellation still works.
The terminal closes a consumed review on failure, then reads the durable
pending receipt before releasing controls. A recovered signature remains
visible while stale actionable data is cleared. If receipt reads also fail,
**Receipt unavailable** replaces the misleading empty receipt state. A later
refresh can restore the receipt, and reconciliation does not send again.
Recovery responses remain scoped to their originating wallet session.

Six additional DOM scenarios cover dismissal guards across signing,
revalidation and send, acknowledged and lost send responses followed by a
status-write failure, unreadable receipt storage, replacement of an older final
receipt, and a delayed receipt lookup after wallet disconnect. All six fail
against the preceding terminal. The recovery cases use the real client,
deterministic signatures and RPC/storage adapters, preserve one send attempt,
and recover confirmation without a second send. The dismissal case also checks
pre-sign cancellation and duplicate-click rejection.

Source checks, Rust contract comparison, the terminal build and all 419
JavaScript tests pass, including 49 terminal DOM scenarios. The 17-case SBF
suite, engine, wrapper, account layouts, transaction instructions and dependency
pins are unchanged. These are not real-wallet, physical-mobile, public-cluster
or independent-security-audit results.

## Cross-tab receipt consistency

Built on merged commit `7d4effda174c31450315c6a530ea07ab96ebabca`. Another tab
could advance a transaction receipt while an account snapshot was in flight.
The older response could still become actionable, and the terminal could pair
it with the newer receipt. A separate race after a submission error could hide
the saved signature if another tab had already confirmed or failed it.

The client now rereads the receipt after account RPC reads and applies its
minimum and landing slots before returning a snapshot. The terminal also checks
the receipt read used for display before rendering balances or enabling actions.
A newer receipt remains visible while stale balances are cleared; refreshing
with a sufficiently recent response restores the controls. Submission recovery
uses the latest validated receipt, including final results, while the existing
pending-transaction gate continues to block only unresolved receipts.

Four client regressions share one durable journal between separate client
instances and advance pending, confirmed, finalized or failed receipts while
holding an older account read. Four terminal regressions cover a later display
receipt and recovery after another tab confirms, finalizes or fails a submitted
transaction. All eight fail against the preceding implementation and pass after
the fix. They preserve the original signature and do not send another transaction.
The prior delayed-recovery test now holds the complete receipt read and continues
to verify that an obsolete result cannot restore a disconnected wallet session.

The source checks, Rust contract comparison, terminal build and all 427
JavaScript tests pass, including 53 terminal DOM scenarios. Engine, wrapper,
transaction instructions, account layouts, dependency pins and the 17-case SBF
suite are unchanged. These deterministic tests do not establish real-wallet,
physical-mobile or public-cluster compatibility, or replace an independent audit.

## Keeper deferral after simulation

Built on merged commit `0a9c701658f27eb3a86767dd42649cee45b0aa71`. A resolved
target's payout account can disappear, or its market can halt payouts, while the
keeper simulates a transaction. The final read detected those conditions but
let the planner's deferral escape as an error, stopping CLI watch and preventing
it from checking subsequent targets.

The final planning step now handles the same explicit deferral conditions as
the initial step. It durably saves the newer bank floor and advances the target
cursor without signing, reserving a fee or broadcasting. Market-mode and
settlement-policy comparisons run first, so changes that introduce a new owner
delay remain fatal errors. Invalid custody, deployment and account bindings
retain their existing checks. A payout halt is observed, never repaired by this
worker.

Two unit scenarios reproduce the post-simulation payout changes, verify zero
signatures and reserved fees, reject an older bank after restart, then resume
with one submitted transaction and preserved duplicate protection. Two real CLI
watch processes use a local JSON-RPC fixture to defer, continue to an eligible
target, stop cleanly and reconcile on restart without resending. Two additional
scenarios ensure changes to the force-close delay or resolution slot are
reported as settlement-policy errors rather than ordinary deferrals. All six
new tests fail against the preceding implementation. The full keeper suite
passes 100 tests.

The source checks, Rust contract comparison, terminal build and all 433
JavaScript tests pass, including the unchanged 53 terminal DOM scenarios.
Engine, wrapper, instruction builders, account layouts, dependency pins and the
17-case SBF suite are unchanged. These local RPC and process tests do not prove
public-cluster compatibility, hosted keeper uptime, real-wallet or physical
mobile behavior, or replace an independent security audit.

## Funded local validator

[PR #19](https://github.com/TheTradoor/outright/pull/19) adds a loopback-only
market runner and a separate current-validator CI gate. It builds SBPF v3 with
cargo-build-sbf 4.6.0 and platform-tools v1.58, then uses Agave 4.4.1 with its
default feature set. The older 17-case LiteSVM suite remains a separate gate.
The engine and wrapper source pins are unchanged.

The runner verifies program bytes, finalizes its two disposable local programs,
creates six-decimal test collateral, the market and vault, and funds a maker
with 10,000 TEST. It writes a terminal profile and continuously publishes a
fixed synthetic TEST/USD price. Initial and maintenance margin are 100%; base
fees and funding are zero. It is not a live oracle or production market maker.

The RPC lifecycle gate checks portfolio creation, deposit of 100 TEST, rejection
of an oversized deposit, one long and one short round trip, and withdrawal of
100 TEST. It asserts the confirmed positions, final token balances, maker
capital, unique signatures and successful transaction records. The public
lifecycle report is printed in the CI log. A generated signer exercises the
native client; this is separate from browser-extension testing.

Ten setup tests cover official loader identity, exact code and authority pins,
Rust/SPL instruction encoding, local-only endpoints, private and exclusive
receipt storage, symlink rejection, pending-signature reconciliation and failed
or unresolved sends. The loader regression reproduces the first setup failure
against the earlier runtime. The complete local check passes 443 JavaScript
tests, including the unchanged 53 terminal and 100 keeper cases, with source
checks and Rust contract comparison.

The workspace cannot start Agave because its kernel restrictions deny
`io_uring`. Validator execution is therefore checked on the Ubuntu CI runner;
the PR records the exact run and outcome. The validator release archive is
pinned by SHA-256 in the workflow. These checks do not establish public-cluster
compatibility, hosted service uptime, mobile-wallet behavior or independent
security review. Follow [the local market guide](LOCAL_MARKET.md) to reproduce
the environment.

## Upstream accounting update

The 14 November 2026 (UTC+7) update merges the upstream engine through
`a712af767eeb217876a3d3c50e3849b60ea54462` and pins the corresponding wrapper
`357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`. All upstream commits and authors are
retained. Engine source, specification and tests match the new baseline.

Host validation passed 371 default engine tests, 439 fuzz-feature tests and
443 JavaScript tests. The engine suites overlap. Rust conformance reproduced
the checked-in contract exactly; compared with the preceding release, only the
engine and wrapper revision fields changed. Account layouts and instruction
bytes did not change. Cargo updated only the wrapper pin in the host lockfile.

The update includes upstream backing-expiry, lien-credit, loss-domain and
resolved-close fixes. [Upstream sources](UPSTREAM.md) records the affected
issues. The matching wrapper reports nine deliberately failing tests in its
broader gates; Outright's passing checks do not supersede those findings or
constitute independent review. The [mainnet release requirements](MAINNET_RELEASE.md)
separate verified application behavior from the prerequisites for public funds.

## Trader onboarding

The default trader page now loads the official public profile automatically.
It reports loading, an unopened market, a failed request or an available test
market. A retry never overlaps another request. Wallet connection stays disabled
until a supported profile is loaded; choosing Connect wallet then opens the
wallet chooser directly. Settings and file imports require explicit operator
mode and cannot be triggered from the normal trader page.

Eight new DOM scenarios exercise absent configuration, HTTP and network errors,
invalid JSON, mismatched source identities, unsupported mainnet profiles,
oversized bodies, request timeout, duplicate retries and eventual success.
The existing 53 scenarios continue to cover manual-profile races, wallet
lifecycle, transaction review, receipts and recovery. All 452 native tests and
the Rust contract comparison pass. The terminal bundle builds successfully.

The hosted deployment profile remains `null`. This change removes operator
setup from the trader flow; it does not create an on-chain market or change the
networks accepted by the client. DOM tests use deterministic fixtures and do
not establish physical-phone or wallet-extension compatibility.


## Wallet adapter and optional chart failures

The terminal now isolates malformed Wallet Standard registrations so one broken
adapter cannot prevent choosing a compatible wallet. Missing canvas support
shows a chart-unavailable message while market and account reads continue.
Invalid connect results remain recoverable in the chooser.

Event subscription errors roll back local authorization. A failing unsubscribe
cannot interrupt disconnect, and callbacks from an earlier subscription cannot
reset a later session, including reconnection to the same wallet. A synchronous
disconnect during subscription cannot complete wallet selection.

Eighteen additional DOM scenarios cover these cases and chart recovery. The
complete native command passes **471 tests**, with zero failures or skipped
tests, source checks and exact Rust conformance. The three affected terminal
suites pass 82 tests including harness parents; they exercise 79 DOM scenarios.
This is automated fixture evidence, not a real wallet or physical-device run.

The [repair checklist](REPAIR_CHECKLIST.md) separately records the current
application corrections, previous passing CI runs, upstream-wide qualification
results and unfinished production acceptance. No engine arithmetic, oracle
freshness rule, source pin or supported-network policy is changed by the wallet
correction.
