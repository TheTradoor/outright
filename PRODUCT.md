# Independent product on Percolator

## Project direction

The source repository for this project is a direct fork of
[`aeyakovenko/percolator`](https://github.com/aeyakovenko/percolator).
The goal is a usable Solana perpetuals product built on that engine.
The product name is not final.

Pppercolator is a reference for the kind of trading product to deliver. Its
repository, terminal, simulator, launchpad, Hyperliquid client and token are
not the source base or runtime dependencies of this project. Earlier
contributions to that project remain separate work.

The acceptance target is a functioning trading product: connect a Solana
wallet, create a portfolio, deposit collateral, inspect an executable quote,
open/reduce/close a position, withdraw available collateral, and inspect
transactions and positions derived from confirmed chain state. Local tests
and devnet are delivery stages, not the final product.

## Upstream contract

The initial engine revision is
`b22bef7d6122fd7d82680ce9859e8b77fd8ef656`. The authoritative engine contract
is [`spec.md`](spec.md), v16.9.1, together with the pinned source and tests.
The upstream engine source, specification, license and README are unchanged.

The engine is a risk library. Its own README assigns account loading,
authorization, authenticated oracle input, token movement and compute policy
to a wrapper. A native Solana integration also needs a program, funded
counterparties, operational services and a wallet application.

The already-tested integration candidate uses Toly's
[`aeyakovenko/percolator-prog`](https://github.com/aeyakovenko/percolator-prog)
at `b42fe017c2bc953778f90d0cb85cd1d426b6e783`, which pins the engine revision
above. The wrapper is a separate official source; its instructions and account
layouts must remain matched to the adapter. Changes to these pins require
review and repeated conformance and transaction tests.

Compatibility means following the documented engine rules. It does not imply
personal approval or endorsement by Anatoly Yakovenko. The upstream README
still describes the engine as educational, unaudited and not production-ready.

## Integration requirements

- The engine decides risk transitions, margin, funding, liquidation and loss
  accounting. Application code must not invent different balances or silently
  relax those rules.
- Amounts and prices use exact integer units and the prescribed rounding.
  Nominal positive PnL must not be displayed as freely withdrawable collateral
  when the engine cannot prove its backing.
- Wrapper instructions authenticate accounts, portfolio identities, epochs,
  signers, token mint/vault bindings and oracle observations.
- Quotes must have explicit price, fee and validity bounds and a funded maker.
  A matcher is an execution component; it does not create liquidity capital.
- User actions must distinguish pending, confirmed, failed and unknown
  transaction outcomes. An RPC or indexer failure cannot manufacture a fill.
- Public-market progress and exits must respect the spec's bounded,
  permissionless crank and recovery requirements. Synthetic fallback prices
  must not substitute for authenticated oracle handling.
- Administrative authorities, upgrades, market limits and operational owners
  must be documented before accepting public funds.

The initial implementation candidate is one SOL perpetual market with USD
pricing and USDC collateral. Leverage, margin, open-interest and position
limits remain subject to liquidity and stress analysis.

## Work to carry forward

The independently written native adapter, Rust conformance exporter,
portfolio reader and SBF lifecycle tests from earlier work are candidates for
migration. They were reviewed for references to Pppercolator's terminal,
simulator and Hyperliquid code; those components are not required by the
adapter. Source pins match this fork's engine baseline.

Those modules have not yet been imported into this repository. Their previous
passing tests are evidence for that earlier revision, not a claim that this
new repository already contains or has revalidated the integration. Migration
must preserve attribution and must pass fresh CI here before the product
depends on it.

## Completion criteria

1. Import only the independent native integration and verify it against this
   engine fork and the pinned official wrapper. Keep engine changes separate
   from application changes.
2. Extend transaction coverage beyond a fixed-price, zero-fee round trip:
   nonzero fees and funding, price moves, liquidation, matcher authorization,
   stale oracle/state rejection, insolvency/recovery and withdrawals.
3. Deliver the wallet terminal, market/portfolio reads, quote and transaction
   planner, oracle and keeper services, indexer and transaction reconciliation.
4. Demonstrate the complete user flow with public devnet transaction records,
   including restarts, unavailable services and position exits. Verify the
   target cluster's supported program build separately from the local VM build.
5. Establish funded liquidity and reviewed risk limits; complete independent
   security review, deployment/source verification, operational monitoring and
   authority/incident procedures before a capped mainnet release.

## Current status

As of 13 November 2026 (Asia/Jakarta), this repository establishes the corrected
direct engine fork and product direction. It does not yet contain the wallet
product or a deployed native market and accepts no user deposits.
