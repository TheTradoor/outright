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
256 portfolio targets and 16 assets. Each cycle includes the target's active
legs plus one rotating discovery asset. Newly created portfolios are not
discovered automatically. Resolved-market payout accounts require a separate
planner and are rejected by this worker. The wallet terminal supports owner-signed
resolved close and receipt-claim actions, but it does not expire backing or
replace resolved-market operator progress. Global recovery uses committed state without oracle
accounts; it does not implement every recovery or wind-down instruction.

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
| `simulationRejected` | SBF rejected this attempt; inspect the error and oracle publisher |
| `submitted` | RPC returned the saved transaction signature |
| `unknown` | The send response did not establish the outcome |
| `pending` | No confirmed outcome yet |
| `confirmed` / `finalized` | RPC reported a successful transaction at that commitment |
| `failed` | A confirmed transaction failed; network fees may still apply |
| `expiredUnresolved` | Expired blockhash with no established outcome; worker stops |

One rejected simulation advances the bounded target cursor so it cannot starve
every other portfolio. A code, network, account identity, configuration, budget,
storage or RPC failure stops the process. Repair the cause and restart with the
same state directory. A restart reconciles a pending signature first.

## Receipts, fees and restart

The keeper writes its signature and reserves the estimated network fee before
broadcasting. It flushes the temporary file, atomically replaces `state.json`,
and flushes the directory. A send timeout never creates an automatic replacement
transaction. Unresolved receipts block all targets for this worker.

`feeBudgetLamports` is a cumulative cap for this journal, not a daily allowance.
It conservatively counts each signed attempt, including failed or unresolved
transactions. `maxFeeLamports` limits a transaction's estimated network fee;
`reserveLamports` preserves a minimum payer balance. This release requests no
priority fee. Insufficient fee capacity stops the worker before signing.

`state.json` contains the pending receipt, last result, cumulative budget,
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
full recovery exits, broader stress coverage and independent security review.
