# Wallet terminal

The terminal is a client for a configured Percolator deployment. It can create
a portfolio, deposit collateral, request an immediate maker trade with an
explicit price limit, withdraw when the engine permits it, advance recovery exits
with owner consent, and settle after the market resolves. It does not
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

## Connect and choose an account

Connection errors appear inside the wallet chooser, where the same wallet can
be selected again after its request settles. Connecting does not sign or send a
transaction.

Closing the chooser discards an unfinished connection result. A later approval
or rejection cannot attach that wallet or overwrite the current page feedback.
The wallet may still display its own prompt; dismiss it there if it remains open.
The terminal stays busy until that wallet request settles. Closing the chooser
does not revoke permissions already granted in the wallet.

The wallet must still be registered and compatible when its response arrives.
Only accounts returned by that connection and still authorized by the wallet
can be selected. Account authorization and network/signing support are checked
again when choosing from a list. If an account was removed or became
incompatible, reconnect to obtain current choices.

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

After any confirmed, finalized or failed transaction, the next action must use
a blockhash different from the saved transaction. This applies to portfolio
creation, deposits, withdrawals, trades, recovery and settlement, even when the
requested action or amount changes. A failed transaction can leave its sequence
bindings unchanged; re-signing the same message would reuse the earlier signature.
The check runs before simulation and again under the wallet lock before signing,
so it also covers reloads and a final receipt written by another tab. A rejected
retry preserves that receipt. Wait for a new blockhash and review the action
again; the client does not sign or send automatically. Declining a wallet prompt
before a signature is saved does not consume the blockhash.

There is no automatic re-signing, replacement deposit, or assumption that a
missing status means failure. If history remains unavailable after expiry,
the operator must reconcile the signature and portfolio state through a reliable
RPC. Keep the receipt; do not clear browser data to bypass this state.

Disconnects, unsupported wallet accounts and failed RPC reads clear actionable
market data. A late response cannot restore a disconnected session. Empty asset
lists still update balances and positions; expired or revoked maker consent
disables trade review.
If signature reconciliation fails because the RPC is unavailable, returns an
invalid status or the receipt cannot be saved, the terminal clears its old
market snapshot and disables wallet actions. The saved signature remains
visible and can be checked again. Successful reconciliation refreshes verified
account data before restoring actions. No transaction is replaced or resent.
Late simulation and reconciliation errors cannot overwrite the current wallet
session's message. A poll started for an earlier session cannot refresh its
replacement session after that old request completes.
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
leg with zero position basis can still carry loss weight. That leg and an
obligation from the immediately prior reset have zero live exposure and are shown
as pending cleanup. Neither means the portfolio has finished settlement.
Recorded PnL and capital are displayed separately. The UI
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

Recovery markets expose the eligible position exit described below. Resolved
markets use the settlement controls. A separate
[keeper client](MARKET_OPERATIONS.md) can perform bounded maintenance for
configured test-network portfolios. Broader recovery coverage, sustained oracle
publishing and hosted keeper services, market indexing and alerts remain
necessary before public release. The upstream
engine is unaudited research software; local test results do not make it suitable
for real funds.

## Recovery position exit

Select a position whose asset is in Recovery, whose market is in Recovery, or
whose side has a reset obligation accepted by the pinned engine. The terminal
offers **Review recovery exit** only for an eligible retained leg. An ordinary
live position must close through trading. The program decides final admission.

The owner must acknowledge that `ForfeitRecoveryLeg` can permanently discard
positive price and funding gains that have not been booked for the selected leg.
Losses still apply and can consume collateral. This is not an ordinary trade or
a withdrawal. One successful step may retain an obligation or require further
recovery; it does not establish that the portfolio or market is fully settled.

A retained obligation remains visible after refresh even when its effective
size is zero. Keeper continuations can release it once the engine permits,
finalize market Recovery and, with resolved settlement enabled, advance the
owner's payout after the configured delay. Cleanup and finalization may require
separate transactions. Check each confirmed result before proceeding.

Enter a positive **Shared-loss step budget** in collateral units. The client
encodes exact atoms in the upstream `b_delta_budget` field. This budget bounds
the shared-loss settlement work within the step. It does not cap price or
funding losses, collateral consumed, or positive gains forfeited. For example,
the SBF test uses a one-atom budget while applying a 50-atom price loss.

The instruction requires the owner signature and binds the portfolio ID,
position epoch and selected asset index. The client also pins the selected
asset's market ID. It simulates before review and hashes the complete market
and portfolio data, including accounting omitted from display fields. Any
change to either data buffer during signing requires a fresh review before
broadcast. The on-chain epoch rejects stale position consent. State can still
move after the final read and before execution; the step's effects follow the
engine at execution time.

After a submitted recovery step is reconciled, the next attempt requires a
different blockhash, including after a failed transaction or browser reload.
The client creates no token accounts and includes no token transfer in this
action. Refresh after confirmation and use the appropriate withdrawal or
resolved-settlement path once the engine permits it. Payout-halt repair,
complete market teardown and broader insolvency scenarios remain unfinished.

## Resolved-market settlement

Once a verified market is resolved, the terminal hides deposit and withdrawal
controls and offers owner-signed settlement actions:

- **Advance settlement** runs one bounded `CloseResolved` step. A successful
  transaction can advance accounting without transferring collateral. More
  steps or operator progress may still be required.
- **Claim additional payout** runs `ClaimResolvedPayoutTopup` when the recorded
  receipt rate and vault show an additional amount payable. It does not unwind
  positions or perform backing discovery.
- **Review account closure** prepares `ClosePortfolio` once the displayed
  balances, positions, locks and payout receipt permit a closure review. These
  preliminary checks do not establish that the account is empty. Simulation and
  execution must also accept its source domains, escrow and close-progress state.

The two payout actions use the verified owner's associated token account. If it does not
exist, the same transaction creates it, with rent shown before signing. The
legacy close instruction fee field is zero; the pinned wrapper uses its actual
market maintenance fee policy, which is included in review.

Receipt face value, amount already paid against that receipt, and additional
payout at the recorded rate are displayed separately. They exclude separate
capital payouts. Unpaid face value is not a withdrawal balance or a promise of
full repayment. The additional amount is rounded down with integer arithmetic
and capped by recorded vault custody; execution may observe a different state.
No receipt, no active positions or zero capital alone establishes completion.

The client simulates before review and hashes the complete market and portfolio
data. After signing, it reads and verifies those accounts again. Any change to
either data buffer requires a new simulation and review, including source
backing, close-progress records and accounting omitted from the display. This
can also require another review when a different user's transaction changes the
shared market. A later RPC bank or a rent top-up alone does not change this hash.
Identity, deployed code and custody checks still run independently.

A rejected submission closes the consumed review dialog and displays the error.
It does not automatically sign or send another transaction. Settlement instructions have no sequence
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

Account closure transfers every lamport held by the portfolio, including rent,
to the market account. It does not return SOL to the wallet or pay collateral.
The review names the portfolio and market destination before signing. The client
binds the instruction to the portfolio ID, sequence and position epoch and
rechecks complete accounting after signing. No token account is allocated.
A failed attempt requires a fresh blockhash before another closure review,
including after reload or a final receipt written by another tab.

Refresh after confirmation. An absent portfolio disables the settlement and
closure controls. The terminal does not offer portfolio creation in a resolved
market. A closed market retains a typed tombstone; its reader stops wallet
actions with a closed-market message instead of treating the account as a live
deployment. Final market closure is an authority operation described in the
[operator guide](MARKET_OPERATIONS.md#terminal-account-and-market-closure).
