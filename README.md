# Outright

Perpetual futures on Solana, built on [Percolator](https://github.com/aeyakovenko/percolator).

Outright is developing a native Solana trading application around Anatoly
Yakovenko's Percolator risk engine. This repository is a direct fork of the
engine and the source repository for that work.

**In development. No Outright market is deployed, and no user deposits are
accepted. The engine is unaudited and must not be used with real funds.**

## What is here

The repository currently contains the Percolator engine, its specification and
test suite, a native Solana client, a wallet terminal, a bounded keeper client
and integration fixtures. Hosted oracle and keeper services, indexing and a
public market remain unfinished.

| Component | Status |
| --- | --- |
| Risk engine | Upstream Percolator source, unchanged at the [recorded revision](docs/UPSTREAM.md) |
| Engine specification | [v16.9.1](spec.md) |
| Runtime tests | Default and `fuzz` suites; run locally or through GitHub Actions |
| Solana program integration | [Native client, Rust conformance exporter, and local SBF tests](protocol/README.md) |
| Wallet terminal | [Mainnet-capable client with simulation and transaction reconciliation; no enrolled public market](docs/WALLET_TERMINAL.md) |
| Market keeper | [Worker with oracle checks, portfolio discovery, fee caps and durable receipts](docs/MARKET_OPERATIONS.md) |
| Funded local market | [Validator bootstrap and complete RPC lifecycle check](docs/LOCAL_MARKET.md), with a fixed synthetic TEST/USD price |
| Hosted services | Provider oracle publishing, keeper hosting and completeness monitoring remain open |
| Oracle inspection | [Read-only Pyth Core checks against coherent on-chain Clock and feed data](docs/ORACLE_OPERATIONS.md) |
| Public deployment | None |

The intended user flow is wallet connection, collateral deposit, an executable
quote, position management, and withdrawal. [PRODUCT.md](PRODUCT.md) defines
the requirements and the evidence needed before a public release.

## Development

Install [Rust through rustup](https://rustup.rs/), then run:

```sh
git clone https://github.com/TheTradoor/outright.git
cd outright
cargo test --locked
cargo test --locked --features fuzz
```

The Rust version is pinned in [rust-toolchain.toml](rust-toolchain.toml).
These commands test the engine. They do not deploy a program or start a
trading application.

For the native integration, install Node.js 22.12 or newer and run:

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
bash protocol/check.sh
```

See [the SBF fixture guide](protocol/svm/README.md) to execute the client's
instructions in a local Solana VM. No public program or market is deployed.

See [the development guide](docs/DEVELOPMENT.md) for test scope and
[the original engine guide](ENGINE.md) for Percolator's model and proof workflow.

## Documentation

- [Product requirements and delivery milestones](PRODUCT.md)
- [Mainnet release requirements and user experience](docs/MAINNET_RELEASE.md)
- [Production inputs, funding observations and release sequence](docs/PRODUCTION_INPUTS.md)
- [Upstream sources and compatibility policy](docs/UPSTREAM.md)
- [Development and verification](docs/DEVELOPMENT.md)
- [Native integration verification results](docs/NATIVE_VERIFICATION.md)
- [Repair checklist and remaining release requirements](docs/REPAIR_CHECKLIST.md)
- [Wallet terminal and deployment profiles](docs/WALLET_TERMINAL.md)
- [Run a funded local market](docs/LOCAL_MARKET.md)
- [Market keeper and operator recovery](docs/MARKET_OPERATIONS.md)
- [Inspect Pyth feeds before market enrollment](docs/ORACLE_OPERATIONS.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

## Attribution and license

Percolator was created by Anatoly Yakovenko and developed with its upstream
contributors. Outright is an independent project; it is not an official
Percolator release or an endorsement by its author.

The engine source, specification, license and existing commit history are
retained. The original upstream README is preserved in [ENGINE.md](ENGINE.md).
Outright's documentation replaces the repository's front page without changing
the engine's package name or public API.

Licensed under [Apache-2.0](LICENSE).
