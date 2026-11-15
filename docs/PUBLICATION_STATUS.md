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
| Website client update | [Outright](https://outright.bollish-eth.chatgpt.site), version 35 | Source `f7cc00a0d872053d221234f6b469532844438118`; all 81 canonical protocol files match merged client `518eb3ac`. Build, 20 routes, 996 local links/assets, four mechanics tests and 607 canonical client tests pass. Chromium verified the updated pages, search navigation and published homepage notice. [Retained evidence](qualification/2026-11-15-program-rebuild/README.md#website-publication). Owner-only access remains; mainnet is not open. |
| Published release evidence | [PR #30](https://github.com/TheTradoor/outright/pull/30), merged as `33f6af7b0fa7632a5c679aa456e676dd7213cd87` | All four engine checks passed. Every file in the retained packet's checksum manifest was rechecked before merge. |
| Keeper portfolio discovery | [PR #31](https://github.com/TheTradoor/outright/pull/31), merged as `1161b54094498ce23a287d2d2340e52d8cae68a3` | All 51 checks passed. The merge has tested tree `6414a9f1f80faed6f06f261e81b6867070d4c928`. Source pins and program bytes are unchanged. [Retained evidence](qualification/2026-11-14-keeper-discovery/README.md) includes 39 verified artifacts and all 2,120 test logs. |
| Keeper health and host templates | [PR #32](https://github.com/TheTradoor/outright/pull/32), merged as `9ea27452e3be6e141727d205f4a5aae8b028bedb` | All 51 checks passed. The merge has tested tree `a53736b0d8a6282d16267832ef00b5006809faf8`. [Retained evidence](qualification/2026-11-14-keeper-health/README.md#remote-results) binds 540 client tests, 17 SBF cases, both validator paths and the 2,120-execution wrapper aggregate to this source. |
| Pyth Core feed inspection | [PR #34](https://github.com/TheTradoor/outright/pull/34), merged as `e3d5308c2320de0c0b715be0cc0d3730b6a4e869` | All 51 checks passed. The merge has tested tree `27f13783393dbd45d8e0ccad50b400ae5eaf780d`. [Retained evidence](qualification/2026-11-15-pyth-inspection/README.md#remote-results) includes 594 client tests, 31 shared Rust/JavaScript oracle vectors, 17 SBF cases, both validator paths and 2,120 wrapper executions. |
| Hybrid funding and oracle outage coverage | [PR #36](https://github.com/TheTradoor/outright/pull/36), merged as `0c49df8518aee63bafc57fc35fb7f4e6a54aa4ae` | All 51 checks passed. The merge has tested tree `651a853825b9b35d8120cf19fa0166c258591145`. [Retained evidence](qualification/2026-11-15-hybrid-funding/README.md#remote-results) includes 594 client tests, 19 SBF cases, both validator paths and 2,122 wrapper executions. Engine and runtime pins are unchanged. |
| Terminal response limits | [PR #39](https://github.com/TheTradoor/outright/pull/39), merged as `90095e5e43a1d8f57ab612983bbae90a4bb37abb` | All 51 checks passed; tree `c0154106b181b3e0fc20c9fe65d6e35a8345a6c7` equals the tested tree. 607 client tests, 19 SBF cases, both validator paths and all 2,122 wrapper executions pass. Streaming limits, timeout, cancellation and retry are covered by 13 added tests and browser checks. [Evidence](qualification/2026-11-15-response-limits/README.md). |
| Upstream accounting integration | [Program PR #2](https://github.com/TheTradoor/outright-program/pull/2), merged as `162e73edb4f411d18907a9516e8c2808879935bc`; [application PR #41](https://github.com/TheTradoor/outright/pull/41), merged as `518eb3acfb9667aaa899eeb86835d0cd4f1020a5` | All 51 checks passed before merge. Both published trees match their qualified sources. Nine engine and eleven program commits are retained. All 39 wrapper archives and 2,137 raw test logs were independently verified and retained. [Evidence](qualification/2026-11-15-upstream-accounting/README.md). |
| Keeper shutdown and operator RPC review | [PR #45](https://github.com/TheTradoor/outright/pull/45), merged as `eab353065aa1f9d1329cf9681e686cfa23d5142c` | All 51 checks passed. The merge has tested tree `d4bd003cc0be6e89479dd8e7d29162714bbd9cc3`. Nine new regressions pass; five reproduced earlier defects. All 40 artifacts and 2,137 wrapper logs were independently verified. [Evidence](qualification/2026-11-15-release-audit/README.md). |

The current client uses the published program directly in its runtime source
lock, Rust dependency, generated contract and both SBF build paths. Qualification
must identify that same commit and source tree. The upstream Percolator engine
is `5e3af0710ec7e9b7077393012f8a94a31b2f07ef` with exact source equivalence.

Current PR #45 evidence includes **2,137 wrapper executions**, **616 client tests**,
**19 application SBF cases** and two separately executed **seven-transaction
validator paths**. The validator paths use a synthetic fixed-price market and
reconcile exact collateral balances. Counts overlap in scope and are not a
count of independent production scenarios. See the [complete current validation
record](qualification/2026-11-15-release-audit/README.md#remote-results).

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
and program pins for that earlier work retain their original identities. Website
version 35 includes the qualified upstream engine/program adoption through
PR #41, the independent program rebuild and the PR #43 verifier correction,
alongside the earlier keeper, oracle, Hybrid funding and response-limit updates.
This publication does not enroll a production deployment.

The checked PR #41 tree and program PR #2 tree are merged. The remaining production requirements are
listed in [REPAIR_CHECKLIST.md](REPAIR_CHECKLIST.md): approved market
parameters, authority custody and fee funding, funded execution/backing, live
oracle and keeper/indexing operations, independent security review, physical
wallet acceptance and final public release enrollment.

The hosted deployment profile remains `null`. No production market or public
deposits are enabled. Website publication is not mainnet activation.

## Current program build verification

[PR #42](https://github.com/TheTradoor/outright/pull/42) published the complete
upstream qualification packet and website version 34 evidence as merge
`cd700c39e038f53a843f69788bae14e4bca6d08f`. All four reported engine checks passed,
and the retained 40 artifacts and 2,137 wrapper logs were reverified before merge.

The updated program has now been rebuilt independently with the pinned tools.
Its full SHA-256 matches the qualified validator binary. [Build evidence](qualification/2026-11-15-program-rebuild/README.md)
also records the report-verification correction in [PR #43](https://github.com/TheTradoor/outright/pull/43),
merged as `8ead6633ed02b09663212967ca9687bf9c425abd` after all five reported checks
and a fresh seven-transaction validator lifecycle passed. The retained packet
also records 59 passing local verifier tests, 607 client tests and refreshed
mainnet rent for an exact-length scenario. Final production allocation and
deployment remain open.

Website version 35 was published successfully on 15 November 2026 at 22:08 WIB.
Its [publication record](qualification/2026-11-15-program-rebuild/site-publication.json)
binds the deployed version to source `f7cc00a0d872053d221234f6b469532844438118`.
The live homepage update was checked in Chromium. The source preserves all
81 canonical protocol files, owner-only access and the null deployment profile.

The program build warnings have been classified against the exact retained ELF.
The syscall warning comes from scanning `.rodata` as instructions; all 14
executable syscall sites are recognized. The inherited dual crate-type warning
remains a build-configuration limitation. [Analysis and recheck](qualification/2026-11-15-release-audit/README.md#program-build-warnings).
