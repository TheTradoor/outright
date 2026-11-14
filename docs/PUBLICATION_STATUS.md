# Publication status

Updated: **15 November 2026 (Asia/Jakarta, UTC+7)**.

The GitHub 403 is resolved. The existing installation retains selected-repository
access and now includes `TheTradoor/outright-program`. Authenticated branch creation,
source publication and the program PR merge succeeded after that change.

| Work | Published result | Verification |
| --- | --- | --- |
| Wrapper qualification and client freshness | [PR #25](https://github.com/TheTradoor/outright/pull/25), merged as `c2df58efb9c1985078d0bbc2f3cc87bd2cb22b07` | All 48 reported checks passed before merge; merge tree matched the checked tree. |
| Earlier complete evidence | [PR #27](https://github.com/TheTradoor/outright/pull/27), merged as `97a89a247032a3bcf97a164884af7ff48ca1fdfc` | All 58 evidence/documentation files published, including the earlier failed attempts. |
| Repaired program fork | [Program PR #1](https://github.com/TheTradoor/outright-program/pull/1), merged as `dab351b19cd463a76b29178cbe1e9c2c485163d1` | Candidate `72dd8948b116e9e16a85c830e1e2a7915f12d542` and merge have the exact qualified tree `8b54b827082b2b838beacd88d4d99bd12878d2ca`. Upstream history, license and engine dependency are retained. |
| Mainnet transport and program adoption | [PR #28](https://github.com/TheTradoor/outright/pull/28), merged as `3bfbe078c1493764bcb56bffc384dea99f5db55b` | All 51 checks passed before merge. The merge has tested tree `537c60abf1b371bce2e9b79cedcff1a22f53cefa`. Complete qualification passed 37 shards and 2,120 executions; the independent aggregate matches CI. |
| Website client update | [Outright](https://outright.bollish-eth.chatgpt.site), version 31 | Source `1517db4e58f0fb51ceedb3e7d8ffed5577e6e32f`; all 67 canonical protocol files match PR #31. Checks passed for 17 routes, 754 links/assets, four mechanics tests and 525 client tests. Existing owner-only access is preserved; mainnet is not open. |
| Published release evidence | [PR #30](https://github.com/TheTradoor/outright/pull/30), merged as `33f6af7b0fa7632a5c679aa456e676dd7213cd87` | All four engine checks passed. Every file in the retained packet's checksum manifest was rechecked before merge. |
| Keeper portfolio discovery | [PR #31](https://github.com/TheTradoor/outright/pull/31), merged as `1161b54094498ce23a287d2d2340e52d8cae68a3` | All 51 checks passed. The merge has tested tree `6414a9f1f80faed6f06f261e81b6867070d4c928`. Source pins and program bytes are unchanged. [Retained evidence](qualification/2026-11-14-keeper-discovery/README.md) includes 39 verified artifacts and all 2,120 test logs. |
| Keeper health and host templates | [PR #32](https://github.com/TheTradoor/outright/pull/32), merged as `9ea27452e3be6e141727d205f4a5aae8b028bedb` | All 51 checks passed. The merge has tested tree `a53736b0d8a6282d16267832ef00b5006809faf8`. [Retained evidence](qualification/2026-11-14-keeper-health/README.md#remote-results) binds 540 client tests, 17 SBF cases, both validator paths and the 2,120-execution wrapper aggregate to this source. |
| Pyth Core feed inspection | [PR #34](https://github.com/TheTradoor/outright/pull/34), merged as `e3d5308c2320de0c0b715be0cc0d3730b6a4e869` | All 51 checks passed. The merge has tested tree `27f13783393dbd45d8e0ccad50b400ae5eaf780d`. [Retained evidence](qualification/2026-11-15-pyth-inspection/README.md#remote-results) includes 594 client tests, 31 shared Rust/JavaScript oracle vectors, 17 SBF cases, both validator paths and 2,120 wrapper executions. |

The current client uses the published program directly in its runtime source
lock, Rust dependency, generated contract and both SBF build paths. Qualification
must identify that same commit and source tree. The upstream Percolator engine
remains `a712af767eeb217876a3d3c50e3849b60ea54462` with exact source equivalence.

Current PR #34 evidence includes **2,120 wrapper executions**, **594 client tests**,
**17 application SBF cases** and two separately executed **seven-transaction
validator paths**. The validator paths use a synthetic fixed-price market and
reconcile exact collateral balances. Counts overlap in scope and are not a
count of independent production scenarios. See the [complete current validation
record](qualification/2026-11-15-pyth-inspection/README.md#remote-results).

The initial PR #28 publication was `5c8373ce…`, tree `609b5042…`, with its
495-client/51-verifier local results and earlier 17-case candidate evidence.
Those records retain their original identities. The current source uses fresh
CI and artifact verification; it does not relabel earlier results.

## Remaining release work

The keeper health follow-up is merged through PR #32. Its publication preserves
the complete tested trees, including the earlier binary evidence archives:

| Work | Published commit | Local source and matching tree |
| --- | --- | --- |
| PR #31 evidence | `e0f66e404cd6210650f4fd448c94b3f8fdbac823` | Local `4f1655b2a5a2040f958efe0a18b30cab61162ad8`; tree `bf20715ee0178e11e1e94ef5cb76593109cfa936` |
| Keeper health implementation | `ea8ccad84ea51945f720ea196a1904e0ad049188` | Local `3cdcfe325d863da0da2a21f2fd47f0ebd0082945`; tree `5f62ee9d1f61c6ba2034aa9043eb6e2e907168b7` |

The [validation record](qualification/2026-11-14-keeper-health/README.md)
records 540 passing local and remote client tests, all 51 passing PR checks and
the independently checked downloaded artifacts. The merge tree equals the tested
tree. The [host guide](KEEPER_HOSTING.md) defines the operational scope. Engine
and program pins are unchanged. The published website remains version 31; this
operator change does not alter the terminal or enroll a production deployment.

The checked PR #34 tree is merged. The remaining production requirements are
listed in [REPAIR_CHECKLIST.md](REPAIR_CHECKLIST.md): approved market
parameters, authority custody and fee funding, funded execution/backing, live
oracle and keeper/indexing operations, independent security review, physical
wallet acceptance and final public release enrollment.

The hosted deployment profile remains `null`. No production market or public
deposits are enabled. Website publication is not mainnet activation.
