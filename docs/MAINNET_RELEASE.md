# Mainnet release requirements

Outright's target is a trader-facing Solana perpetuals application: open the
terminal, connect a wallet, review an order and manage collateral. Traders must
not supply deployment files, select an RPC, operate a keeper or configure an
oracle. Mainnet is the release target; test environments are internal
verification tools, not a requirement placed on users.

**Current decision: mainnet deposits are not enabled.** No production program,
funded market, reviewed risk policy or production operating service has been
enrolled. Passing the local lifecycle is evidence for that flow, not a release
authorization or an audit.

The merged [mainnet client transport](MAINNET_CLIENT.md) implements network
validation, wallet-chain selection/signing and explorer handling. It does not
close production enrollment, security review, liquidity or wallet acceptance.

## Relationship to Percolator

The implementation uses the actual Percolator risk engine and its Solana
wrapper, pinned in [source-lock.json](../protocol/source-lock.json). It does not
substitute a price simulator or a different exchange's execution engine.
The source check requires exact engine-source equivalence.

The upstream [engine guide](../ENGINE.md), [specification](../spec.md) and
[wrapper product specification](https://github.com/aeyakovenko/percolator-prog/blob/357157e6e14d1d10ce78a995d5d50bb3c1f2ae13/README.md)
define the implementation constraints:

| Requirement | Application consequence |
| --- | --- |
| Bounded account-local progress | Maintenance and exits use bounded engine operations; ordinary progress cannot depend on an operator manually repairing accounts. |
| Isolated asset/side source domains | A market's funds and claims must not be presented as interchangeable backing for unrelated assets. |
| Positive PnL requires realizable backing | Recorded PnL is shown separately from collateral available for withdrawal. |
| Wrapper owns authorization, oracle authentication and custody | The app verifies program code, network, mint, vault, account identities and oracle provenance. |
| Permissionless maintenance and recovery | Keepers help progress; the UI must expose valid user exits and accurately show pending obligations. |
| Scoped, bounded administration | Authorities and upgrade powers must be disclosed and reviewed; a frontend label cannot limit an on-chain authority. |
| Permissionless listing has economic and governance rules | A future listing UI must enforce the actual fee and authority policy, isolate domains and verify each instrument's oracle. |

This describes compatibility with published source. It does not claim Anatoly
Yakovenko's endorsement or a private statement of his intentions. Both upstream
repositories continue to say the software is unaudited and not production ready.

## Evidence required before enabling public funds

| Release requirement | Current evidence and remaining work |
| --- | --- |
| Qualified engine and wrapper | Engine `a712af76` is unchanged. Merged PR #28 adopts published wrapper `72dd8948`. Runtime, generated contract and qualification require that same source. Its complete 37-shard, 2,120-execution qualification, 496 client tests, 17 SBF cases and both current-validator paths passed. All 51 checks passed before the identical source tree was merged. Independent security review remains open. See the [repair checklist](REPAIR_CHECKLIST.md) for exact sources and results. |
| Independent security review | No Outright audit is recorded. Review must cover the exact engine, wrapper, matcher, oracle integration and application release, including custody and exit paths. |
| Production deployment and authority custody | No mainnet program/market is enrolled. A verifiable build, actual program-data hash, authority policy and operator-controlled signing arrangement are required. Disposable local keys must never become production authorities. |
| Funded maker and insurance | The 10,000 TEST fixture is synthetic. Actual collateral, maker consent, capital limits, inventory policy and insurance funding are not established. A matcher alone supplies no capital. |
| Market risk policy | SOL/USD with USDC is the initial product candidate. Collateral identity, oracle feed, leverage/margin, OI and position limits, fees, funding and exit delays require stress-tested, reviewed values. No production risk values are inferred from the fixed-price fixture. |
| Oracle and maintenance services | Real authenticated observations, freshness handling, bounded keeper progress, service restart, fee budgets and monitoring must be exercised together. An administrative fixed-price pusher is not a production price service. |
| Trader application | The hosted release must load its verified market automatically, explain unavailable markets, reconcile each signature, and keep transaction actions closed on unverifiable state. Trade review is disabled when the latest snapshot fails the configured oracle freshness checks; preparation and submission recheck verified state. Deposits retain their custody and simulation checks without a separate oracle freshness requirement. Wallet extensions, mobile wallet browsers and interruption/recovery need direct tests. |
| Operations and incident response | Define the responsible operator, alerts, RPC/provider failure response, permissionless exit instructions, authority rotation and incident communications. Verify recovery without wiping unresolved receipts. |

An approved deployment is a specific set of source commits, build artifacts,
program/market addresses, policy values, authorities and operating services.
A change to any of these requires the affected checks to be repeated. Test
counts, a boolean configuration flag, an acknowledgement checkbox or a
successful website deployment cannot establish that approval.

## User experience at release

1. The site loads the official market and verified state automatically.
2. Connect Wallet shows available wallets and useful mobile instructions.
3. The account view distinguishes wallet collateral, portfolio capital, PnL
   and amounts the engine currently permits to withdraw.
4. An order review shows the instrument, side, size, limit, fee caps, network
   cost and possible partial fill before the wallet is asked to sign.
5. The position and receipt update from confirmed chain state. A timeout remains
   unresolved until reconciled; it never silently creates another order.
6. Closing a position and withdrawing remain separate, explicit operations.
   Recovery or delayed payouts explain the outstanding obligation and valid
   next action.

Until those prerequisites are established, the public-facing terminal must
describe its unavailable state honestly and must not ask ordinary traders to
upload operator configuration.
