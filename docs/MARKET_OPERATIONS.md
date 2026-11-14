# Market keeper

The keeper submits bounded `PermissionlessCrank` instructions to the pinned
Percolator program. It supplies authenticated oracle accounts and a portfolio
target. The engine selects the maintenance action, which can include accrual,
portfolio refresh, liquidation or recovery work. The operator cannot choose a
replacement price or bypass the engine's risk rules.

The client includes mainnet transport support as well as localnet/devnet
operation. [Transport validation](MAINNET_CLIENT.md) is not production enrollment.
No public Outright market or hosted
keeper is configured. The worker can discover portfolios in its enrolled market;
it is not an oracle publisher, a historical transaction indexer, a
market deployment tool, or a source of liquidity.

## Before running

Use Node.js 22.12 or newer on a POSIX host with a durable local filesystem. Install
the locked dependencies with `npm ci --prefix protocol --ignore-scripts`.

An operator needs an initialized deployment enrolled with
[profile.mjs](../protocol/profile.mjs), the exact portfolio addresses to service,
and the on-chain oracle accounts for each asset. The deployment profile pins
the source revisions, network, program bytecode and upgrade authority.

Use a dedicated fee payer for the enrolled network. Keep its keypair outside the repository,
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

For Pyth Core feeds, the [read-only oracle inspector](ORACLE_OPERATIONS.md)
checks the provider account and Solana Clock before market enrollment. Its
output includes the exact base58 feed ID needed here. Inspection does not
publish prices or approve the market's risk parameters.

Public-network assets must use external Hybrid oracle mode `1`, with one to three
feeds. Manual mode `0` with no feeds is allowed only on localnet. AuthMark and
EWMA-only assets are not supported by this operator release. The keeper does
not fetch Hermes messages or publish Pyth updates. An independent provider
publisher must keep the configured oracle accounts current.

Configure every asset held by the target portfolios. The current bound is
256 portfolio targets and 16 assets. In a live market each cycle includes the
target's active legs plus one rotating discovery asset. Static configurations
service only their listed targets. The optional portfolio discovery mode below
admits new targets between complete sweeps. Global recovery uses committed state without
oracle accounts; it does not implement every recovery or wind-down instruction.

An owner forfeiture may leave a zero-exposure leg with retained loss weight.
The reader keeps that leg visible, allowing the keeper to continue from its
committed state. Releasing the obligation and finalizing global Recovery can
take separate transactions. A local two-asset SBF trace covers that transition,
the new authenticated owner-delay window and one exact principal payout through
the resolved planner. This does not establish settlement of every portfolio or
complete market teardown.

## Automatic portfolio discovery

An operator can replace the explicit target list with these two fields in the
same configuration. All deployment, oracle, fee-payer and budget fields remain
required:

```json
{
  "targets": [],
  "discovery": { "mode": "programAccounts", "maxTargets": 256 }
}
```

Discovery is opt-in and scoped to the enrolled program and market. The RPC must
support `getProgramAccounts` with context, filters, zero-length data slices and
`minContextSlot`. The worker filters by the generated portfolio length, header
and market address. It then reads complete accounts in batches of at most 64,
with the pinned program, ProgramData and market in each batch. It verifies
program bytes and authority, market identity, portfolio ownership, owner
provenance and nonzero portfolio ID. RPC filters alone cannot admit an account.
Malformed accounts, duplicate addresses or IDs, changed program bytes, stale
banks and an overflow above `maxTargets` stop the worker before signing.
The worker never silently enrolls the first part of an oversized result.

The validated targets are sorted and saved in the existing durable journal.
Each target is visited for every configured discovery asset before the next
scan. Restart resumes that saved sweep. An unresolved transaction is reconciled
before any scan, even if the enumeration endpoint is unavailable. New targets
do not reset reserved fees, the last submitted blockhash or the receipt.
Existing static configurations retain their previous configuration hash and
behavior when `discovery` is omitted.

An empty verified scan returns `noTargets` and spends no transaction fee. An
account that closes between enumeration and its full read is omitted. An
account that disappears during a saved sweep returns `portfolioMissing`; a
changed owner or portfolio ID during that sweep stops the worker. A later scan
may enroll a newly created incarnation after full verification. Missing accounts
and empty scans do not establish payout, settlement or completeness.

The scan is not an atomic snapshot across all batches, and RPC enumeration is
not a cryptographic proof that every portfolio was returned. Returned banks
must advance monotonically, and the usual fresh account/program checks still
run before each signature. New accounts wait for the next complete sweep; its
duration depends on target and asset counts, polling, RPC latency and receipt
confirmation. Size and monitor those bounds for the market's maintenance
requirements. This worker does not provide a latency or availability guarantee.

The CLI limits each decoded HTTP response to 16 MiB and each request to 15
seconds. It cancels oversized responses and does not print provider error bodies.
An RPC that cannot serve the filtered scan stops discovery; the worker does not
switch providers or reuse an unverified partial response.

Enabling discovery changes the configuration identity. Follow the configuration
change procedure below after resolving all pending receipts. Do not delete the
old journal or use a new budget merely to bypass a pending transaction or spent
fee cap. Hosted operation, provider completeness monitoring, response-time
targets and production outage acceptance remain open under OPS-02.

## Missing portfolio targets

A configured portfolio can disappear after its owner closes it. If a coherent
RPC snapshot returns an explicit `null` for that address, the keeper reports
`deferred` with reason `portfolioMissing` and advances to the next target.
This also applies when the account disappears between simulation and the final
read before signing. No transaction is signed and no network fee is reserved
for the deferred step.

Absence does not prove that a portfolio settled or paid out. The target stays in
the configured rotation and is checked again on later cycles. If it returns,
its program ownership, owner, market and portfolio ID must still match the
original pins. A recreated account with a new portfolio ID stops the worker
for configuration review. Empty, malformed or incorrectly owned accounts are
not treated as missing.

Program, network, market, payer and applicable oracle/custody checks still run
before deferral. The observed bank floor, cursor, fee budget and last submitted
blockhash survive restart. An unresolved receipt is reconciled before any target
lookup; an absent target cannot clear that receipt or authorize a replacement.
After confirming closure from transaction history, remove obsolete targets
through the configuration-change procedure below.

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
destination that disappears or a payout halt observed during the final account
read also defers the target, even if its simulation succeeded. The newer bank
floor and next target are saved before continuing; no signature, reserved fee
or send attempt is created for that step. The worker does not repair a halt.
Market-mode and settlement-policy changes are checked before deferral. Code,
network, invalid custody, changed account identities and unexpected RPC errors
still stop the worker for review.

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

After reviewing the enrolled configuration and simulated results, run the
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
| `deferred` | Missing portfolio, owner delay, missing payout ATA or payout halt; inspect `reason` |
| `noTargets` | Verified discovery returned no current targets; no signature or transaction fee, not proof of settlement |
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

## Service health

The CLI writes private health observations beside the transaction journal.
[Keeper health and host setup](KEEPER_HOSTING.md) describes the read-only check,
receipt and sweep time limits, retained failure counts and Linux service templates.
A running process alone is insufficient evidence of maintenance progress.

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
Live and resolved CLI watch cases start with a missing target, continue to a
second portfolio, stop cleanly after submission and reconcile on restart. A
later missing-target pass preserves duplicate protection and the fee budget.
Two additional resolved watch cases change the payout destination or halt state
after simulation. They defer, continue to an eligible target, stop gracefully,
and reconcile the saved transaction after restart without another send. Unit
cases verify the persisted bank floor, zero signing and fee reservation on the
deferred step, and rejection of settlement-policy changes that introduce a new
owner delay. All six new scenarios fail against the preceding implementation.

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
broader recovery and stress coverage, additional teardown configurations and independent security review.

Discovery regressions cover account addition between sweeps, restart fairness,
pending-receipt recovery during enumeration failure, fee-budget and duplicate
protection, malformed and stale responses, incarnation changes, overflow,
bounded batches, journal failure and corruption. Live and resolved CLI tests
exercise discovery through HTTP and recover the signed receipt in a second
process without another broadcast. The current-validator lifecycle also requires
the real RPC to find the maker before trader initialization, find both accounts
after the lifecycle, and reject an undersized discovery limit. This remains a
synthetic local market; production oracle and host acceptance are separate.

## Terminal account and market closure

The wallet terminal supports owner-reviewed `ClosePortfolio` after resolved
settlement. The program requires an empty portfolio, including source domains,
close progress, escrow and payout receipts. Zero displayed capital alone is not
sufficient. The instruction binds its portfolio ID, sequence and position epoch.
Every lamport in the closed portfolio goes to the market slab. No collateral
transfer or wallet rent refund occurs in that step.

The keeper does not sign account or market closure. After every portfolio has
settled and been removed, the current market authority can use the low-level
`closeSlab` instruction builder. The single-collateral account layout is:

| Position | Account | Permission |
| --- | --- | --- |
| 0 | Current market authority and SOL refund destination | Signer, writable |
| 1 | Market slab | Writable |
| 2 | Primary collateral vault | Writable |
| 3 | Derived vault authority | Read-only |
| 4 | Current authority's collateral token destination | Writable |
| 5 | Classic SPL Token program | Read-only |
| 6 | Primary collateral mint | Writable |

Read the current authority epoch from
`market.assets[0].control.authority_epoch` in a freshly verified snapshot. The
Rust exporter supplies its offset. Do not reuse an epoch after an authority
handoff. `buildInstruction` accepts `closeSlab`, arguments `{ authorityEpoch }`
and accounts `{ owner, market, vault, userToken, mint }`; `owner` is the current
market authority. It derives the vault authority and fixes the token program.
This builder creates an instruction only. It does not verify a deployment,
create the destination token account, simulate, sign, submit or reconcile it.
Those checks remain required for an operator submission.

`CloseSlab` can advance a bounded scan without closing the market. Follow the
confirmed state after each step. Any retry, including after a failed attempt,
needs a fresh blockhash and a newly reviewed transaction. Do not equate a
successful signature with completed teardown. Only the typed closed-market
record and the closed vault establish that endpoint.

At final closure, the wrapper sweeps unbooked SPL surplus to the current
market authority's token destination. Booked, claim-free residue can instead
be burned under the engine's terminal rules; the mint must be writable for
that case. These are distinct from unpaid user claims. The primary vault closes,
and its rent plus the market's excess rent goes to the current market authority.
The market retains its closed header and exactly that header's rent exemption.

The local underfunded fixtures now complete this sequence after paying the owner
1,750 atoms across two payouts. They remove every primary portfolio, hand off the
market authority publicly and close with seven donated, unbooked collateral
atoms. Those seven atoms and the exact rent refund reach the new authority.
Unpaid receipts, remaining portfolios, stale bindings, incorrect authorities and
wrong token destinations reject; transaction failures roll back changes. The
wallet planner also removes its seeded portfolio without allocating an ATA.

This coverage is for the pinned single classic-SPL-collateral fixture. Native SOL
residue handling and dual-collateral closure are not supported by this builder.
The tests do not establish closure for every insurance, provider, payout-halt or
large bounded-scan configuration. Automated operator signing and public-cluster
teardown remain unverified.
