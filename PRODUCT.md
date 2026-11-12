# Outright product requirements

Outright will provide perpetual futures trading on Solana using the Percolator
risk engine. The application must follow the engine's accounting and risk rules
and expose the resulting state clearly to traders.

The initial market candidate is SOL with USD pricing and USDC collateral.
Margin requirements, leverage, position limits and open-interest limits will
be set after liquidity and stress analysis.

## Trading flow

A trader must be able to:

1. Connect a Solana wallet and verify the network and market.
2. Create a portfolio and deposit supported collateral.
3. Review an executable quote, including size, price, fees and expiry.
4. Open, reduce and close a position against funded liquidity.
5. Inspect positions, collateral and transaction history from confirmed chain
   state.
6. Withdraw collateral that the engine permits to be withdrawn.

Every transaction must show whether it is awaiting a signature, submitted,
confirmed, failed or unresolved. An RPC timeout must not be reported as a fill
or a definitive failure without reconciliation.

## System boundaries

| Layer | Responsibility |
| --- | --- |
| Percolator engine | Risk transitions, margin, funding, liquidation and loss accounting |
| Solana program | Account validation, authorization, oracle authentication, token custody and compute limits |
| Execution | Quotes, maker authorization and access to funded counterparties |
| Market services | Oracle updates, bounded crank progress, indexing and transaction reconciliation |
| Wallet application | State presentation, transaction review, signing and status reporting |

The application must use exact integer units and the engine's rounding rules.
Positive PnL must not be presented as withdrawable collateral unless the engine
can establish the required backing. A matcher provides execution logic; it does
not supply liquidity capital.

Oracle and account freshness checks must fail safely. Synthetic prices must
not replace authenticated observations in a live market. Market progress and
exits must follow the specification's bounded, permissionless crank and recovery
rules.

## Delivery milestones

Milestones are acceptance criteria, not release dates. All remain open for this
repository.

### Native integration

Import the independent instruction builders, account readers, Rust conformance
exporter and local SBF transaction fixture. Verify them against the engine in
this fork and the pinned upstream Solana program. Record fresh results here.

### Transaction and risk coverage

Cover deposits, open/reduce/close operations and withdrawals, including nonzero
fees and funding, price moves, liquidation, matcher authorization, stale oracle
and account rejection, insolvency and recovery. Failed instructions must leave
custody and account state consistent under transaction rollback.

### Complete application

Deliver the wallet terminal, quote and transaction planner, portfolio reads,
oracle and keeper services, indexer and reconciliation. The application must
recover from disconnected wallets, restarted services and unavailable RPCs.

### Public devnet validation

Publish reproducible deployment instructions, source revisions, program and
market addresses, and transaction records for the complete trading flow.
Verify compatibility with the target cluster separately from the local VM.

### Capped mainnet release

Establish funded liquidity and reviewed market limits. Complete independent
security review and deployment verification. Document upgrade and administrative
authorities, monitoring, incident response and position-exit procedures before
accepting public funds.

## Current scope

This repository contains the engine and project documentation. There is no
Outright program deployment, wallet application or public market. Passing
engine tests alone does not satisfy the integration or release milestones.
