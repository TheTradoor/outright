# Outright native client

The client connects a Solana wallet to the pinned Percolator program. It reads
market and portfolio state, plans transactions, simulates them, asks the wallet
to sign, submits the exact signed message, and reconciles its signature.

The engine and wrapper revisions are in [source-lock.json](source-lock.json).
The engine remains unchanged. This directory contains no Pppercolator terminal,
simulator, exchange client, or launchpad code.

## Build and verify

Use Node.js 22.12 or newer and the repository's pinned Rust toolchain:

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
bash protocol/check.sh
npm run build --prefix protocol
```

The terminal is built into `protocol/dist`. Serve that directory on localhost
or HTTPS. Its default deployment profile is `null`; it has no preconfigured
market and accepts no public deposits.

See [wallet terminal setup](../docs/WALLET_TERMINAL.md) for deployment profiles,
wallet requirements, transaction states, and current limits.

For a complete funded test environment, follow [Run a funded local market](../docs/LOCAL_MARKET.md).
The runner creates the validator, collateral, vault and maker, then writes the
terminal profile. Its RPC check exercises deposit, both trade directions and
withdrawal with a fixed synthetic TEST/USD price.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/instructions.mjs` | Exact instruction bytes, account metas and PDA derivations |
| `src/accounts.mjs` | Portfolio identity, sequences, positions, matcher consent and recorded accounting |
| `src/market.mjs` | Market, asset and oracle state; effective position quantities after ADL |
| `src/token.mjs` | Strict classic SPL Token layouts, associated addresses and idempotent ATA creation |
| `src/client.mjs` | Deployment verification, coherent snapshots, action planning and transaction lifecycle |
| `src/recovery.mjs` | Eligibility for an owner-reviewed Recovery leg exit |
| `terminal/` | Wallet Standard interface, transaction review and receipts |
| `profile.mjs` | Read-only enrollment of a deployment against local build artifacts |
| `localnet/` | Loopback-only validator bootstrap, funded synthetic market and RPC lifecycle check |
| `src/keeper.mjs`, `operator/` | Bounded oracle/portfolio crank, fee limits and durable receipts |
| `inspect.mjs` | Low-level read-only portfolio inspection |

## Supported actions

| Action | Scope |
| --- | --- |
| Create portfolio | Seeded system allocation and program initialization in one transaction |
| Deposit | Classic SPL Token collateral from the owner's associated token account |
| Withdraw | Engine-permitted withdrawal from a flat portfolio; creates a missing destination ATA atomically |
| Resolved settlement | Owner-signed bounded close steps and additional receipt payouts; creates a missing destination ATA atomically |
| Portfolio closure | Owner-reviewed removal of an empty resolved portfolio; transfers account SOL to the market, with no collateral payment |
| Market closure | Low-level single-collateral `CloseSlab` builder for the current market authority; not a hosted operator service |
| Recovery exit | Owner-signed forfeiture of unbooked leg gains with explicit consent and a bounded shared-loss step budget; no token transfer |
| Matcher trade | Immediate bounded-price CPI trade against a configured, funded maker |
| Bilateral trade | Low-level instruction builder; both owners must sign |
| Permissionless crank | Bounded localnet/devnet worker; resolved backing discovery and payouts require `settleResolved: true` and an existing owner ATA |

Amounts remain integer values. `parseUnits` rejects excess precision, scientific
notation, zero amounts, and SPL Token overflow. Displayed capital and recorded
PnL are not withdrawal quotes. A separate reduce-only action is not implemented.

## Evidence

The Rust exporter uses the upstream encoder, decoder, initializers and type
offsets. It also packs classic token fixtures with the official Rust SPL Token
implementation, independently of the JavaScript reader. Its output is compared
with the checked-in contract. JavaScript
regressions cover malformed state, changed deployments, wallet mutation,
simulation failure, lost RPC responses, pending transaction recovery and expiry.
All wallet actions require a blockhash different from the last saved transaction,
including after a confirmed failure, reload or another tab's receipt update.
The receipt remains available until a newly reviewed transaction is signed.
Settlement review binds the complete market and portfolio data. Changes to
accounting outside the display require a new simulation and explicit review
before this client sends. Terminal tests verify that rejected reviews close and
leave a new review available.
Keeper tests also cover missing portfolios before and after simulation. An
explicit RPC absence defers the target without signing or reserving a fee;
present accounts retain strict identity checks. CLI watch tests process the next
target and preserve pending receipts and duplicate protection across restart.

[SBF tests](svm/README.md) execute the JavaScript instructions and planner output
against the compiled wrapper and SPL Token. They cover the bilateral lifecycle,
atomic allocation and ATA creation, bounded CPI execution, revoked maker
consent, account-binding failures, fractional funding, bounded partial
liquidation, underfunded resolved settlement and rollback. The resolved fixture
checks a later payout after backing expires and rejects duplicate payment. A
separate trace runs discovery and payouts through the keeper planner without an
owner signature, including rejection of a forged slot before the close delay.
Both traces now continue through removal of every primary portfolio, a market
authority handoff, vault closure and a persistent market tombstone. They check
exact rent refunds, seven atoms of unbooked SPL surplus, rejected early closure,
stale bindings, wrong authorities, wrong destinations, rollback and repeat closure.
An insufficient-balance deposit trace funds the source through SPL Token, verifies
that the old message remains `AlreadyProcessed`, then executes the same deposit
with a fresh blockhash and checks one exact collateral transfer.
The Recovery exit case checks discarded unbooked gains, applied price losses,
stale consent, owner authorization, unchanged custody and transaction rollback.
A separate two-asset trace follows a retained zero-exposure obligation through
global Recovery, cleanup, finalization and one exact owner payout. The reader
preserves the obligation for wallet refresh and keeper continuation. The test
also verifies the owner-delay boundary, duplicate rejection and rent returned
to the market when the terminal target is removed.
Funding uses a controlled AuthMark fixture; the
operator's liquidation test uses synthetic Pyth observations. The CPI matcher
is an upstream test fixture. These are local execution tests, not public-cluster
validation. See the [verification record](../docs/NATIVE_VERIFICATION.md) for
exact coverage and remaining requirements.

The pending client transport also supports `mainnet-beta` with a pinned genesis,
explicit wallet chain and HTTPS RPC. The hosted deployment remains absent;
mainnet transport support does not enroll or launch a production market. See
[mainnet client transport](../docs/MAINNET_CLIENT.md) for verification and limits. The
[operator guide](../docs/MARKET_OPERATIONS.md) covers setup, simulation, sending,
fee limits and restart. Funded liquidity, provider oracle publishing, hosted
keeper operations, broader recovery and risk coverage, additional teardown configurations and independent review
remain public-release requirements.
