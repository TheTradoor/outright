# Outright

Perpetual futures on Solana, built on [Percolator](https://github.com/aeyakovenko/percolator).

Outright is developing a native Solana trading application around Anatoly
Yakovenko's Percolator risk engine. This repository is a direct fork of the
engine and the source repository for that work.

**In development. No Outright market is deployed, and no user deposits are
accepted. The engine is unaudited and must not be used with real funds.**

## What is here

The repository currently contains the Percolator engine, its specification and
test suite, and Outright's product and contribution documentation. The wallet
application and native Solana integration have not been added to this repository.

| Component | Status |
| --- | --- |
| Risk engine | Upstream Percolator source, unchanged at the [recorded revision](docs/UPSTREAM.md) |
| Engine specification | [v16.9.1](spec.md) |
| Runtime tests | Default and `fuzz` suites; run locally or through GitHub Actions |
| Solana program integration | Pending import and verification in this repository |
| Wallet terminal and market services | Planned |
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

See [the development guide](docs/DEVELOPMENT.md) for test scope and
[the original engine guide](ENGINE.md) for Percolator's model and proof workflow.

## Documentation

- [Product requirements and delivery milestones](PRODUCT.md)
- [Upstream sources and compatibility policy](docs/UPSTREAM.md)
- [Development and verification](docs/DEVELOPMENT.md)
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
