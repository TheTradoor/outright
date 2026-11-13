# Wallet terminal

The terminal is a client for a configured Percolator deployment. It can create
a portfolio, deposit collateral, request an immediate maker trade with an
explicit price limit, withdraw when the engine permits it, and advance settlement
after the market resolves. It does not
deploy a market, provide a counterparty, or operate an oracle.

No public Outright market is configured. The shipped profile is `null`.
Localnet and devnet are supported; mainnet profiles are rejected by this release.

## Run it

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
npm run build --prefix protocol
python3 -m http.server 8080 --directory protocol/dist
```

Open `http://localhost:8080` in a browser with a Solana Wallet Standard wallet
supporting version 0 transactions and `solana:signTransaction`. On a phone,
use the wallet's browser. A wallet that can only sign and send in one operation
is not supported: the client needs to persist the signature before broadcasting.

The browser must support Web Crypto Ed25519, Web Locks and local storage.
Web Locks coordinate signing and receipt reconciliation across tabs. Private
keys remain with the wallet.

## Enroll a deployment

Build the pinned program from its recorded source. Deploy and initialize it
using an operator-controlled test environment. Supply the exact deployed
program, market and local build artifact to the read-only enrollment command:

```sh
node protocol/profile.mjs \
  --rpc https://api.devnet.solana.com \
  --cluster devnet \
  --program "$PROGRAM_ADDRESS" \
  --program-binary "$PROGRAM_BINARY" \
  --market "$MARKET_ADDRESS" \
  --wallet "$WALLET_ADDRESS" \
  --symbol TEST \
  --max-oracle-age-slots 20 > protocol/deployment.local.json
```

The variables must refer to an actual initialized deployment. The command
does not create accounts or sign transactions. It compares deployed bytecode
with the supplied artifact, checks collateral and vault bindings, and performs
a coherent account read. An arbitrary local artifact is not source verification;
the operator must retain the build's source revision, toolchain and binary hash.

Add every maker option together to enable trading:

```text
--maker-portfolio ADDRESS --maker-owner ADDRESS
--matcher-program ADDRESS --matcher-binary PATH --matcher-context ADDRESS
--fee-bps NUMBER --backing-fee-cap-bps NUMBER
```

The maker must already have funded collateral and unexpired on-chain consent
for the exact matcher tuple. A program address alone is not liquidity. Current
client instructions do not accept arbitrary matcher tail accounts.

`--fee-bps` is the taker's base trading fee cap. The pinned single-trade CPI
route charges the market's on-chain base fee to both counterparties, subject to
engine accounting, rather than charging the configured cap. Both the taker cap
and the maker's on-chain consent must cover the base fee. The taker cap also
cannot exceed the engine's maximum trading fee. The review displays the base
fee, taker cap and engine limit separately. Mark-movement fees can exceed the
base cap, up to the engine limit; backing fees have separate caps. These values
are not a fixed total-fee quote. Market rules determine fees at execution.

Load the generated profile through **Deployment settings**. For an operator's
hosted build, put it at `protocol/terminal/deployment.json` and rebuild. A profile
contains public addresses and public RPC access only. Never include API secrets
or wallet exports. Localnet profiles must use a loopback RPC address.

Optional `assets` entries bind display names to both the slot index and market
incarnation: `{"index":0,"marketId":"1","symbol":"SOL/USD"}`. Set a name only
after checking that the configured oracle represents that instrument. Without
metadata, the terminal displays an asset index.

## What is checked

Each snapshot checks the network genesis hash, deployed program bytecode and
upgrade authority, market identity, classic SPL mint configuration, vault ATA
and authority, portfolio provenance, and the wallet's collateral ATA. Program
code, market and account data are read at one confirmed RPC bank. A hash pin
detects a changed deployment; it does not make its code secure or prevent a
future upgrade.

This version accepts six-decimal classic SPL collateral. Token-2022 extensions,
native SOL accounts and other collateral scales are unsupported. A maker
verification failure blocks trades while valid custody actions remain available.

Portfolio creation also accepts an empty System account at the deterministic
address when it has already received SOL. Allocation, ownership assignment and
initialization execute atomically. Only missing rent is transferred; excess SOL
is not trading collateral. Other occupied accounts are rejected.

Every action receives a fresh snapshot and unsigned simulation before review.
Signing uses the exact reviewed message. The client rejects a modified message,
invalid signature, changed network, changed deployment, expired review and
expired blockhash before it broadcasts. After signing, it reads verified state
again, rebuilds the requested action and requires identical instruction bytes
and account metas. Changed maker consent, sequence bindings, oracle freshness,
market mode or required rent force a new review. SOL must still cover the reviewed
network fee and rent. State can still change between this check and execution,
so the program remains authoritative.

A change to the market base fee or engine fee limit during the wallet prompt
also requires a new review, even when the new fee is within existing consent.

## Confirmation and recovery

| State | Meaning |
| --- | --- |
| Signature saved | Signed transaction recorded locally before the send attempt |
| Sent or pending | No confirmed result yet |
| Confirmed or finalized | RPC reports the corresponding on-chain commitment |
| Failed | A confirmed transaction returned an error; network fees may still apply |
| Unknown | The send response did not establish an outcome |
| Expired, unresolved | The blockhash expired but the RPC has not established the result |

Pending and unresolved records block new actions for the same wallet and
market, including after reload. Reconciliation searches signature history.
Its response bank cannot precede the last observed slot. A transaction's landing
slot cannot exceed that response bank. Malformed responses leave the receipt
pending and do not permit a replacement transaction.
Account reads also restore the receipt's slot bound after reload, including
confirmed, finalized and failed receipts. Older receipts without a stored
response-bank slot use their recorded landing slot. An older RPC bank cannot
populate the portfolio or produce a new review. Concurrent account reads and
receipt updates cannot lower a slot already observed by the client.
There is no automatic re-signing, replacement deposit, or assumption that a
missing status means failure. If history remains unavailable after expiry,
the operator must reconcile the signature and portfolio state through a reliable
RPC. Keep the receipt; do not clear browser data to bypass this state.

Disconnects, unsupported wallet accounts and failed RPC reads clear actionable
market data. A late response cannot restore a disconnected session. Empty asset
lists still update balances and positions; expired or revoked maker consent
disables trade review.
A delayed startup profile cannot replace a profile already selected manually.
Disconnecting does not cancel a transaction already signed or sent. Its receipt
remains associated with the original wallet and market. Late submission results
and storage errors cannot overwrite the disconnected session's display;
reconnect the original account to inspect and reconcile its saved signature.

Receipts are local to the browser. They are not an indexer, tax record or complete
trade history. The chart contains observations collected during the current
session only. It does not fabricate historical candles, volume or funding rates.

## Position and execution limits

Effective exposure uses the pinned engine's conservative ADL rounding. A retained
obligation from the immediately prior reset has zero live exposure and is shown
as pending cleanup. Recorded PnL and capital are displayed separately. The UI
does not calculate a withdrawable balance from their sum.

The pinned engine requires a portfolio to have no active position legs before
withdrawal. A partial liquidation can restore health while leaving a position
open; it does not make the remaining capital withdrawable. Transaction
simulation must still accept a withdrawal before the wallet is asked to sign.

Trades execute immediately through the configured matcher. They may fill
partially and do not become resting orders. There is no reduce-only instruction
in this client. An opposite trade is not guaranteed to close a position if other
transactions change the position first. The terminal therefore has no one-click
close, liquidation-price estimate or leverage slider.

Recovery markets remain read-only in the wallet terminal. Resolved markets use
the settlement controls below. A separate
[keeper client](MARKET_OPERATIONS.md) can perform bounded maintenance for
configured test-network portfolios. Full recovery payouts, sustained oracle
publishing and hosted keeper services, market indexing and alerts remain
necessary before public release. The upstream
engine is unaudited research software; local test results do not make it suitable
for real funds.

## Resolved-market settlement

Once a verified market is resolved, the terminal hides deposit and withdrawal
controls and offers two owner-signed actions:

- **Advance settlement** runs one bounded `CloseResolved` step. A successful
  transaction can advance accounting without transferring collateral. More
  steps or operator progress may still be required.
- **Claim additional payout** runs `ClaimResolvedPayoutTopup` when the recorded
  receipt rate and vault show an additional amount payable. It does not unwind
  positions or perform backing discovery.

Both actions use the verified owner's associated token account. If it does not
exist, the same transaction creates it, with rent shown before signing. The
legacy close instruction fee field is zero; the pinned wrapper uses its actual
market maintenance fee policy, which is included in review.

Receipt face value, amount already paid against that receipt, and additional
payout at the recorded rate are displayed separately. They exclude separate
capital payouts. Unpaid face value is not a withdrawal balance or a promise of
full repayment. The additional amount is rounded down with integer arithmetic
and capped by recorded vault custody; execution may observe a different state.
No receipt, no active positions or zero capital alone establishes completion.

The client simulates before review and rechecks identity, receipt values, payout
rate, custody, positions and the maintenance fee policy after signing. A changed
review requires another simulation. Settlement instructions have no sequence
argument, so the next step must use a blockhash different from the previous
saved transaction. This prevents an old signature from being mistaken for a
new continuation, including after a reload or another tab's confirmation.
The program's execution checks remain authoritative after the client recheck.

Refresh after each confirmed step. A zero-due claim is disabled; an accounting
close can still be necessary. The terminal does not declare a portfolio fully
settled or automatically repeat transactions. Expiring backing, resolving
engine payout halts, asset Recovery forfeits and market teardown still require
operator tooling. The keeper now supports backing discovery and bounded resolved
settlement when configured with `settleResolved: true`. It requires an existing
owner payout ATA and waits for the program's permissionless-close delay. Payout
halts, asset Recovery forfeits and account teardown remain outside that worker.
