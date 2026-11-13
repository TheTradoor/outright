# Outright product requirements

Outright will provide perpetual futures trading on Solana using the Percolator
risk engine. The application must follow the engine's accounting and risk rules
and expose the resulting state clearly to traders.

The product target is mainnet. Test networks and local validators are internal
verification environments. Traders must not configure deployments, upload
profiles, choose RPC endpoints or operate market services. The application
loads its official market automatically and explains when trading is unavailable.

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

Milestones define the implementation and verification required for a release.
The native client, wallet terminal and local execution tests are present.
A bounded keeper client is also present. Hosted market operations, broader risk
coverage and public-release milestones remain open.

### Native integration

The instruction builders, portfolio reader, Rust conformance exporter, and
local SBF fixture are implemented in [protocol/](protocol/README.md). The host
check compares the client with this fork’s engine and the pinned wrapper.
The SBF tests execute the client instructions and check resulting positions,
token movements, authorization failures, and transaction rollback.

Source checks, commands, and test scope are documented with the implementation.
The [wallet terminal](docs/WALLET_TERMINAL.md) adds deployment checks, coherent
market and portfolio reads, transaction review, simulation, wallet signing and
signature reconciliation. No public market is deployed.

### Transaction and risk coverage

Cover deposits, open/reduce/close operations and withdrawals, including nonzero
fees and funding, price moves, liquidation, matcher authorization, stale oracle
and account rejection, insolvency and recovery. Failed instructions must leave
custody and account state consistent under transaction rollback.

### Complete application

Deliver the wallet terminal, quote and transaction planner, portfolio reads,
oracle and keeper services, indexer and reconciliation. The application must
recover from disconnected wallets, restarted services and unavailable RPCs.

### Release qualification

Publish reproducible build and deployment instructions, source revisions,
program and market addresses, and transaction records for the complete trading
flow. Rehearse loss, outage, expiry and exit cases without public funds. Verify
target-cluster compatibility separately from local execution. Any internal test
deployment remains explicitly labeled and outside the normal trader setup.

### Capped mainnet release

Establish funded liquidity and reviewed market limits. Complete independent
security review and deployment verification. Document upgrade and administrative
authorities, monitoring, incident response and position-exit procedures before
accepting public funds.

The [mainnet release requirements](docs/MAINNET_RELEASE.md) record the evidence
and operating resources still required for that decision. A passing application
suite does not override unresolved upstream failures or independent review.

## Current scope

This repository contains the engine, native client, wallet terminal, bounded
keeper client, integration fixtures and project documentation. There is no
Outright program deployment or public market. See
[market operations](docs/MARKET_OPERATIONS.md) for the keeper's setup and limits.
Local integration tests do not satisfy the public-release requirements.
