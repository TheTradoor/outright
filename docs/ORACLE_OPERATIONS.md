# Pyth feed inspection

The operator can inspect a Pyth Core feed before enrolling it in a market. The
command reads the feed and Solana Clock in one confirmed RPC snapshot, checks
the network and bank, and applies the pinned wrapper's Pyth acceptance rules.
It does not require a market, wallet or funded payer.

```sh
node protocol/operator/oracle.mjs \
  --config protocol/operator/examples/pyth-sol-usd.json
```

The included example reads the mainnet SOL/USD feed on shard 0. Its 60-second
age limit and 100-basis-point confidence limit are inspection examples, not an
approved production risk policy. An accepted observation does not enroll a feed,
update a price, operate a keeper or enable trading.

## Configuration

Copy the example to the ignored `protocol/oracle.local.json` for operator-specific
RPC and policy settings. The command requires explicit values:

| Field | Meaning |
| --- | --- |
| `cluster`, `rpcUrl`, `genesisHash` | The enrolled RPC network identity. Public networks require HTTPS. The observed genesis must match before accounts are read. |
| `feedId` | The exact 32-byte hexadecimal Pyth feed ID. A token symbol or price-account address is not a feed ID. |
| `shard` | Integer from 0 through 65,535. The account address is derived from the shard and feed ID under the original Core push program. |
| `maxAgeSeconds` | Canonical unsigned 64-bit decimal string. Age is measured against the Clock in the same bank, not the host's wall clock. |
| `maxConfidenceBps` | Integer from 1 through 10,000. This operator command requires an active confidence check. |

The JSON result includes `keeperFeedId`, which is the base58 encoding of the
same 32 feed bytes required by the keeper configuration. It also includes the
derived account, bank slot, chain time, source revisions and SHA-256 hashes of
the inspected account and Clock bytes. RPC URLs and provider error bodies are
excluded from output.

## Compatibility and exact arithmetic

The published wrapper accepts Pyth accounts owned by
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. The inspector uses its matching
Core push program, `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, to derive stable
feed addresses. A Core Compatible account owned by `rec2HH...` is rejected.
Pyth's newer contract families do not override the wrapper's pinned owner check.

The reader checks the PriceUpdateV2 discriminator, minimum data length, full
verification tag, feed identity, positive price, exponent range, publication
time and confidence. It uses integer arithmetic for price scaling and confidence
products, including values beyond JavaScript's safe integer range. Future or
stale publications, zero after rounding and prices above the engine maximum
are rejected. Price units are the wrapper's E6 units.

The shared fixture includes a captured mainnet SOL/USD account and negative and
boundary cases. JavaScript checks all vectors; a Rust conformance test calls
`oracle_v16::read_oracle_price_e6_from_bytes` from the exact published program
on those same bytes. No engine or program source is changed.

## Results and limits

| Result | Meaning |
| --- | --- |
| `accepted`, exit 0 | This feed observation passed the supplied policy at the reported bank and chain time. |
| `rejected`, exit 1 | The coherent bank was read, but the feed was missing or failed an identity, format, verification, age, confidence or price check. No usable price is returned. |
| `unavailable`, exit 1 | Configuration, network, bank, Clock or RPC evidence could not be established. |

The transport reuses the keeper's 15-second request timeout and 16 MiB decoded
response limit. The command performs only genesis, slot and account reads. It
does not sign, send transactions, access a keypair or change files.

This is a bank-relative observation from the configured RPC, not a light-client
proof or a host-clock freshness check. A frozen or dishonest RPC still requires
independent monitoring. Acceptance does not establish provider availability,
publisher cadence, deployed market policy, composite-feed transformations or
permissionless maintenance of the market.

## Remaining production work

The keeper must receive accounts current enough for the actual market's
`max_staleness_secs` and related Hybrid policy. Pyth documents sponsored SOL/USD
updates with a one-minute heartbeat and a price-deviation trigger, and recommends
operating a price pusher for reliability. A tighter market policy therefore
requires a suitable publishing cadence; inspection does not supply it.

The exact publisher version, credentials, funded payer, fee limits, operating
host and outage/recovery acceptance remain open under OPS-01. Production feed
selection and risk parameters remain subject to the release review. Do not
enlarge the market's risk limits merely to make an inspection pass.

Sources checked on 15 November 2026 (Asia/Jakarta):

- [Pinned wrapper oracle implementation](https://github.com/TheTradoor/outright-program/blob/72dd8948b116e9e16a85c830e1e2a7915f12d542/src/v16_program.rs)
- [Pyth Solana integration](https://docs.pyth.network/pro/use-prices-on-blockchain/solana)
- [Pyth contract addresses](https://docs.pyth.network/pro/contract-addresses)
- [Sponsored feeds and price-pusher requirements](https://docs.pyth.network/pro/sponsored-feeds)
- [Pinned Pyth address derivation](https://github.com/pyth-network/pyth-crosschain/blob/4d7e5ba3fa35f294706d41e1cc299b0b090eca7d/target_chains/solana/sdk/js/pyth_solana_receiver/src/PythSolanaReceiver.ts)
