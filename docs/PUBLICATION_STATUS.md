# Publication status

Updated: **14 November 2026 (Asia/Jakarta, UTC+7)**.

The GitHub 403 is resolved. The existing installation retains selected-repository
access and now includes `TheTradoor/outright-program`. Authenticated branch creation,
source publication and the program PR merge succeeded after that change.

| Work | Published result | Verification |
| --- | --- | --- |
| Wrapper qualification and client freshness | [PR #25](https://github.com/TheTradoor/outright/pull/25), merged as `c2df58efb9c1985078d0bbc2f3cc87bd2cb22b07` | All 48 reported checks passed before merge; merge tree matched the checked tree. |
| Earlier complete evidence | [PR #27](https://github.com/TheTradoor/outright/pull/27), merged as `97a89a247032a3bcf97a164884af7ff48ca1fdfc` | All 58 evidence/documentation files published, including the earlier failed attempts. |
| Repaired program fork | [Program PR #1](https://github.com/TheTradoor/outright-program/pull/1), merged as `dab351b19cd463a76b29178cbe1e9c2c485163d1` | Candidate `72dd8948b116e9e16a85c830e1e2a7915f12d542` and merge have the exact qualified tree `8b54b827082b2b838beacd88d4d99bd12878d2ca`. Upstream history, license and engine dependency are retained. |
| Mainnet transport and program adoption | [PR #28](https://github.com/TheTradoor/outright/pull/28), merged as `3bfbe078c1493764bcb56bffc384dea99f5db55b` | All 51 checks passed before merge. The merge has tested tree `537c60abf1b371bce2e9b79cedcff1a22f53cefa`. Complete qualification passed 37 shards and 2,120 executions; the independent aggregate matches CI. |
| Website client update | [Outright](https://outright.bollish-eth.chatgpt.site), version 30 | Source `3813d630edcfc49948128d7c8cecb4cf0744e7a2`; all 65 protocol files match PR #28. Build, route, mechanics and 496 client checks passed. Existing access is preserved; mainnet is not open. |
| Published release evidence | [PR #30](https://github.com/TheTradoor/outright/pull/30), merged as `33f6af7b0fa7632a5c679aa456e676dd7213cd87` | All four engine checks passed. Every file in the retained packet's checksum manifest was rechecked before merge. |

The current client uses the published program directly in its runtime source
lock, Rust dependency, generated contract and both SBF build paths. Qualification
must identify that same commit and source tree. The upstream Percolator engine
remains `a712af767eeb217876a3d3c50e3849b60ea54462` with exact source equivalence.

Fresh evidence includes **2,120 wrapper executions**, **496 client tests**, **17 application SBF cases**,
two separately executed **seven-transaction validator paths**, and **53 local
verifier tests**. The validator paths use a synthetic fixed-price market and
reconcile exact collateral balances. Counts overlap in scope and are not a
count of independent production scenarios. See the [complete current validation
record](qualification/2026-11-14-published-program/README.md).

The initial PR #28 publication was `5c8373ce…`, tree `609b5042…`, with its
495-client/51-verifier local results and earlier 17-case candidate evidence.
Those records retain their original identities. The current source uses fresh
CI and artifact verification; it does not relabel earlier results.

## Remaining release work

The checked PR #28 tree is merged. The remaining production requirements are
listed in [REPAIR_CHECKLIST.md](REPAIR_CHECKLIST.md): approved market
parameters, authority custody and fee funding, funded execution/backing, live
oracle and keeper/indexing operations, independent security review, physical
wallet acceptance and final public release enrollment.

The hosted deployment profile remains `null`. No production market or public
deposits are enabled. Website publication is not mainnet activation.
