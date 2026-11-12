# Wallet terminal

The terminal is a client for a configured Percolator deployment. It can create
a portfolio, deposit collateral, request an immediate maker trade with an
explicit price limit, and withdraw when the engine permits it. It does not
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

Every action receives a fresh snapshot and unsigned simulation before review.
Signing uses the exact reviewed message. The client rejects a modified message,
invalid signature, changed network, changed deployment, expired review and
expired blockhash before it broadcasts. Market changes after simulation can
still cause the program to reject the transaction.

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
There is no automatic re-signing, replacement deposit, or assumption that a
missing status means failure. If history remains unavailable after expiry,
the operator must reconcile the signature and portfolio state through a reliable
RPC. Keep the receipt; do not clear browser data to bypass this state.

Receipts are local to the browser. They are not an indexer, tax record or complete
trade history. The chart contains observations collected during the current
session only. It does not fabricate historical candles, volume or funding rates.

## Position and execution limits

Effective exposure uses the pinned engine's conservative ADL rounding. A retained
obligation from the immediately prior reset has zero live exposure and is shown
as pending cleanup. Recorded PnL and capital are displayed separately. The UI
does not calculate a withdrawable balance from their sum.

Trades execute immediately through the configured matcher. They may fill
partially and do not become resting orders. There is no reduce-only instruction
in this client. An opposite trade is not guaranteed to close a position if other
transactions change the position first. The terminal therefore has no one-click
close, liquidation-price estimate or leverage slider.

Resolved and recovery markets are read-only in this release. Permissionless
cleanup, recovery payout operations, sustained oracle and keeper services,
market indexing and alerts remain necessary before public release. The upstream
engine is unaudited research software; local test results do not make it suitable
for real funds.
