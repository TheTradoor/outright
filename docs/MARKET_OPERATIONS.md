# Market keeper

The keeper submits bounded `PermissionlessCrank` instructions to the pinned
Percolator program. It supplies authenticated oracle accounts and a portfolio
target. The engine selects the maintenance action, which can include accrual,
portfolio refresh, liquidation or recovery work. The operator cannot choose a
replacement price or bypass the engine's risk rules.

This is a localnet/devnet operator client. No public Outright market or hosted
keeper is configured. It is not an oracle publisher, a portfolio indexer, a
market deployment tool, or a source of liquidity.

## Before running

Use Node.js 22.12 or newer on a POSIX host with a durable local filesystem. Install
the locked dependencies with `npm ci --prefix protocol --ignore-scripts`.

An operator needs an initialized deployment enrolled with
[profile.mjs](../protocol/profile.mjs), the exact portfolio addresses to service,
and the on-chain oracle accounts for each asset. The deployment profile pins
the source revisions, network, program bytecode and upgrade authority.

Use a dedicated test-network fee payer. Keep its keypair outside the repository,
with file mode `0600`. Do not use a trader, maker, oracle-authority or
upgrade-authority wallet. The keeper signs only the transaction fee payer; the
target portfolio owner does not sign a permissionless crank.

## Configuration

Create `protocol/keeper.local.json`. This file is ignored by Git. The values
below are descriptive placeholders, not a usable deployment:

```json
{
  "version": 1,
  "settleResolved": false,
  "deployment": "REPLACE_WITH_THE_COMPLETE_ENROLLED_PROFILE_OBJECT",
  "feePayer": "DEDICATED_FEE_PAYER_ADDRESS",
  "targets": [
    {
      "address": "PORTFOLIO_ADDRESS",
      "owner": "PORTFOLIO_OWNER_ADDRESS",
      "portfolioId": "ON_CHAIN_PORTFOLIO_ID_AS_A_DECIMAL_STRING"
    }
  ],
  "assets": [
    {
      "index": 0,
      "marketId": "ON_CHAIN_ASSET_MARKET_ID_AS_A_DECIMAL_STRING",
      "oracleMode": 1,
      "feeds": [
        {
          "id": "BASE58_OF_THE_CONFIGURED_32_BYTE_FEED_ID",
          "account": "CURRENT_ON_CHAIN_ORACLE_ACCOUNT",
          "owner": "ORACLE_PROVIDER_PROGRAM_ADDRESS"
        }
      ]
    }
  ],
  "intervalMs": 2000,
  "maxFeeLamports": "10000",
  "feeBudgetLamports": "5000000",
  "reserveLamports": "1000000"
}
```

Copy the complete enrolled profile object into `deployment`. Never include
private RPC credentials or key material. `portfolioId` and `marketId` bind the
current on-chain incarnations, so reusing an address or asset slot cannot
silently redirect the keeper.

The feed list must match the on-chain order. For Pyth, `id` is the base58 encoding
of the feed's 32 bytes, not a price-update account address. The provider program
owns `account`. Accepted owner IDs are generated from the pinned wrapper in
`protocol/upstream-contract.json`; do not infer them from a token symbol.
The SBF program verifies the provider data, feed identity, confidence,
freshness and observation ordering during simulation and again on execution.

Devnet assets must use external Hybrid oracle mode `1`, with one to three
feeds. Manual mode `0` with no feeds is allowed only on localnet. AuthMark and
EWMA-only assets are not supported by this operator release. The keeper does
not fetch Hermes messages or publish Pyth updates. An independent provider
publisher must keep the configured oracle accounts current.

Configure every asset held by the target portfolios. The current bound is
256 portfolio targets and 16 assets. In a live market each cycle includes the
target's active legs plus one rotating discovery asset. Newly created portfolios
are not discovered automatically. Global recovery uses committed state without
oracle accounts; it does not implement every recovery or wind-down instruction.

An owner forfeiture may leave a zero-exposure leg with retained loss weight.
The reader keeps that leg visible, allowing the keeper to continue from its
committed state. Releasing the obligation and finalizing global Recovery can
take separate transactions. A local two-asset SBF trace covers that transition,
the new authenticated owner-delay window and one exact principal payout through
the resolved planner. This does not establish settlement of every portfolio or
complete market teardown.

## Resolved settlement

Set `settleResolved` to `true` to service resolved markets. It defaults to false;
omitting it or setting false preserves the previous configuration hash. Enabling
it changes the configuration identity. Finish reconciling any pending receipt
before changing configuration or beginning a new journal and fee budget.

The resolved planner submits one `PermissionlessCrank` with one rotating
backing-asset hint and no oracle accounts. Include all assets whose backing may
need to expire, including assets with no remaining positions in a target. The
engine chooses the bounded close, backing expiry or payout continuation from
committed state. A successful transaction need not transfer tokens; `idle`
means no progress for that target and hint, not that the whole market is settled.

Account 0 is the verified portfolio owner without a required signature. The
transaction is signed by the configured fee payer. Before planning a transaction,
the keeper waits for `resolved_slot + force_close_delay_slots` when the delay is
nonzero. The program independently enforces the gate using Solana's Clock, so a
caller-supplied future slot cannot bypass it.

Payouts go only to the owner's canonical associated token account. The keeper
checks the mint pin, destination ownership, vault authority and recorded custody
in one confirmed snapshot. Frozen, delegated, close-authority-controlled and
native token accounts are rejected. The destination must already exist; this
worker does not spend SOL on account rent. The wallet terminal can create a
missing destination during an owner-signed settlement, or an operator can prepare
the canonical ATA with SPL Token tooling before starting the worker.

Owner delay, a missing destination and an engine payout halt return `deferred`
with `ownerDelay`, `payoutAccountMissing` or `payoutHalted`. They consume no
transaction fee and advance the cursor so another target can be serviced. A
policy or account change discovered after simulation prevents signing. Code,
network, invalid custody and unexpected RPC errors stop the worker for review.

This path does not create markets, resolve a live market, cure an engine payout
halt, forfeit asset Recovery legs or close portfolio and market accounts. Those
operations remain separate. Provider data is not needed after resolution, but
the existing asset identities and valid keeper configuration are still required.

## Simulate first

```sh
node protocol/operator/keeper.mjs \
  --config protocol/keeper.local.json \
  --state-dir protocol/operator-state
```

This command reads and simulates one crank. It does not load a keypair, sign or
broadcast. Add `--watch` to poll the configured targets. A successful simulation
does not establish that the same transaction will succeed later.

After reviewing the configuration and simulated results, run the test-network
worker with an explicit send flag:

```sh
node protocol/operator/keeper.mjs \
  --config protocol/keeper.local.json \
  --state-dir protocol/operator-state \
  --send --keypair /secure/outright-keeper.keypair.json \
  --watch
```

The output is one JSON record per cycle. Forward stdout and stderr to the
operator's existing log collector. SIGINT/SIGTERM finish the current cycle and
then stop; they do not interrupt a durable write halfway through.

| Result | Meaning |
| --- | --- |
| `simulated` | Valid simulation; default mode signed nothing |
| `idle` | SBF returned its exact non-progress error; no fee was spent |
| `deferred` | Owner delay, missing payout ATA or payout halt; inspect `reason` |
| `waitingForBlockhash` | RPC returned the last submitted blockhash; no new signature or fee |
| `simulationRejected` | SBF rejected this attempt; inspect the error and oracle publisher |
| `submitted` | RPC returned the saved transaction signature |
| `unknown` | The send response did not establish the outcome |
| `pending` | No confirmed outcome yet |
| `confirmed` / `finalized` | RPC reported a successful transaction at that commitment |
| `failed` | A confirmed transaction failed; network fees may still apply |
| `expiredUnresolved` | Expired blockhash with no established outcome; worker stops |

One deferred target or rejected simulation advances the bounded target cursor so it cannot starve
every other portfolio. A code, network, account identity, configuration, budget,
storage or RPC failure stops the process. Repair the cause and restart with the
same state directory. A restart reconciles a pending signature first.

## Receipts, fees and restart

The keeper writes its signature and reserves the estimated network fee before
broadcasting. It flushes the temporary file, atomically replaces `state.json`,
and flushes the directory. A send timeout never creates an automatic replacement
transaction. Unresolved receipts block all targets for this worker.

The journal retains the last submitted blockhash independently of the last
displayed result. A new signing attempt waits for a different blockhash, including
after restart, a dry run or a deferred target. This prevents consecutive crank
steps from receiving the same signature and reusing an old confirmation. Older
v1 journals import this value from their saved pending or final receipt.

`feeBudgetLamports` is a cumulative cap for this journal, not a daily allowance.
It conservatively counts each signed attempt, including failed or unresolved
transactions. `maxFeeLamports` limits a transaction's estimated network fee;
`reserveLamports` preserves a minimum payer balance. This release requests no
priority fee. Insufficient fee capacity stops the worker before signing.

`state.json` contains the pending receipt, last submitted blockhash, last result, cumulative budget,
minimum observed slot and target cursor. It is not a complete transaction
history. Preserve JSON logs and reconcile authoritative results through RPC.
Do not delete state or start another worker with a different directory to get
around a pending receipt or exhausted budget.

The process holds an exclusive `keeper.lock`. A second worker fails immediately.
A crash leaves the lock in place. Check the recorded PID and ensure the old
process is stopped, inspect `state.json`, then remove only `keeper.lock` and
restart against the same journal. Do not automatically remove a lock based on
age. A failed durable write also leaves the lock for operator inspection.

The complete normalized configuration is bound to the journal. Reconcile any
pending receipt using the original configuration before enrolling a changed
configuration. Keep the old journal as evidence. A new journal starts a new fee
budget, so treat that as an explicit operator action.

## Verification and release limits

`npm test --prefix protocol` covers RPC failures, changed program and account
identities, fee limits, locking, durable storage and receipt reconciliation.
The CLI is exercised over a local JSON-RPC test server, including a second
process that recovers the first process's receipt without sending again.

`bash protocol/svm/run.sh ../percolator-prog` executes the keeper planner's
instruction against the pinned SBF wrapper. It checks authenticated Pyth
progress, the Clock boundary, read-only oracle metas, and rejection rollback
for stale data, wrong feed IDs, excessive confidence and incorrect ownership.
It also moves synthetic Pyth prices against long and short positions, then
checks loss recognition, bounded partial liquidation, rounded fees, remaining
exposure and custody. Stale evidence and later failing instructions must leave
the affected state unchanged. The separate funding fixture uses AuthMark and
the low-level instruction builder; it does not change the operator's accepted
oracle modes.
Those provider accounts are synthetic local fixtures. The tests do not prove
live Pyth publishing, public-cluster compatibility or hosted-service uptime.

Public release still requires reproducible deployment, a running provider
publisher, funded maker liquidity, portfolio discovery/indexing, monitoring,
broader recovery and stress coverage, complete market teardown and independent security review.
