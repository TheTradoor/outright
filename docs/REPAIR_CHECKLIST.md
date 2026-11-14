# Repair and release checklist

Updated: **14 November 2026 (Asia/Jakarta, UTC+7)**.

**Mainnet trading is not open.** The official deployment profile is `null`.
Earlier reproductions, failures, corrections and source-specific test counts
are preserved in [REPAIR_HISTORY.md](REPAIR_HISTORY.md). This page tracks the
current work without treating an old passing run as evidence for new code.

## Current source

| Component | Exact identity |
| --- | --- |
| Qualified client | `02e16562c7e49ab2c4e399599e0b796f22e7b10e`, [PR #28](https://github.com/TheTradoor/outright/pull/28) |
| Tested PR merge | `c445ff27285ccfa6800927a08300b85853ea5735` |
| Published merge | `3bfbe078c1493764bcb56bffc384dea99f5db55b`; same tested tree `537c60abf1b371bce2e9b79cedcff1a22f53cefa` |
| Percolator engine | `a712af767eeb217876a3d3c50e3849b60ea54462`, unchanged upstream source |
| Published program | `TheTradoor/outright-program@72dd8948b116e9e16a85c830e1e2a7915f12d542` |
| Program source tree | `8b54b827082b2b838beacd88d4d99bd12878d2ca` |

Runtime, Rust conformance and complete qualification require the same published
program source. The historical patch is retained as evidence; current builds
fetch the published commit directly. Wrong pins, missing tree identity and
staged program edits stop verification.

## Completed corrections and current verification

| Done | ID | Work | Evidence and scope |
| --- | --- | --- | --- |
| [x] | ACCESS-01 | GitHub 403 and fork publication | Selected-repository access now includes the program fork. [Program PR #1](https://github.com/TheTradoor/outright-program/pull/1) is merged with the exact qualified tree. |
| [x] | ENG-01 through ENG-06 | Upstream engine accounting fixes | Exact source equivalence and [current engine CI](https://github.com/TheTradoor/outright/actions/runs/43570649305) pass. Historical issue mapping remains in the repair history. |
| [x] | CASE-01 through CASE-10 | Reproduced wrapper, fixture and model failures | Corrections and negative controls are retained. [Earlier full qualification](https://github.com/TheTradoor/outright/actions/runs/43563227621) passed 2,120 executions. The new identity is tracked separately below. |
| [x] | UI-01 through UI-07 | Trader onboarding, retry and chart recovery | Official profile loading is automatic. Deployment import is confined to operator mode. Regressions remain in the client suite. |
| [x] | WAL-01, WAL-04 through WAL-08 | Wallet adapter and session recovery | Malformed registrations, account changes, failed subscriptions, old callbacks and disconnect races are covered by automated tests. |
| [x] | TX-01, KPR-01, RPC-01 | Receipts, keeper deferral and local setup | Custody, network, source, fee-budget and unresolved-receipt guards pass in the current client suite. |
| [x] | CLIENT-01 | Mainnet network and signing transport | [Native CI](https://github.com/TheTradoor/outright/actions/runs/43570649278): 496 tests, source equivalence, exact Rust conformance and terminal build pass. Includes genesis, HTTPS, wallet-chain selection, pre-sign checks and explorer privacy. |
| [x] | PROV-01 through PROV-03 | Source and qualification integrity | 53 local verifier tests pass. Source-drift tests reject wrong revisions, repositories, trees, engine identity, legacy overlays and staged program changes. |
| [x] | RPC-02 | Published program on current validator | [Validator CI](https://github.com/TheTradoor/outright/actions/runs/43570649281): seven confirmed lifecycle transactions; starting/final collateral 1,000,000,000 atoms; final trader capital zero; maker capital 10,000,000,000 atoms. Synthetic fixed-price TEST market only. |
| [x] | INT-03 | Application SBF integration on the published source | [SBF CI](https://github.com/TheTradoor/outright/actions/runs/43570649228): 17 passed, zero failed, ignored or filtered; 33.49 seconds. Controlled local fixtures only. |
| [x] | INT-04 | Independently bound current-validator result | [Candidate validator CI](https://github.com/TheTradoor/outright/actions/runs/43570649227) passed in 26.025 seconds. Downloaded artifact digest, exact client tree, complete source identity, binary hashes and seven-transaction report were independently checked. |
| [x] | BUILD-01 | Independently reproduce the SBPF v3 program | Rebuilt published source with the pinned toolchain; SHA256 exactly matches the program tested by candidate-validator CI. [Binary and provenance](qualification/2026-11-14-published-program/program-build-verification.json) are retained. Production signing and deployment remain open. |
| [x] | ADOPT-01 | Merge published-program runtime adoption | PR #28 merged after all 51 checks passed. The merged source tree is identical to the tested tree. |
| [x] | QUAL-03 | Complete qualification of the new identity | [Run 43570649236](https://github.com/TheTradoor/outright/actions/runs/43570649236): 37 shards and 2,120 executions passed, with exact coverage and a matching independent aggregate. All 39 artifact digests and 2,120 individual test-log digests were verified. [Complete evidence](qualification/2026-11-14-published-program/README.md) retains all 40 job logs. |
| [x] | SITE-01 | Publish the updated website | [Version 30](qualification/2026-11-14-published-program/site-v30.json) deployed successfully; current verification and comparison commands are published. Version 29 already carried the identical client. All 65 protocol files match the client above; 17 routes, 750 links/assets, four mechanics tests and 496 client tests pass. Browser onboarding, retry and operator separation pass. The deployment profile remains `null`. |

A checked item is complete within its stated scope. Automated adapters and a
website deployment do not establish real-wallet acceptance, production liquidity
or independent security review.

## Keeper discovery follow-up

The operator now supports opt-in discovery within its enrolled market. Full
account/program verification precedes admission, and complete sweeps survive
restart without resetting fees or bypassing pending receipts. The CLI bounds
HTTP response bytes and cancels oversized responses. The engine and wrapper
pins are unchanged.

Local client checks pass **525/525**, including 29 new discovery/transport
scenarios; source equivalence and terminal build pass, and the verifier suite
passes **53/53**. The current-validator lifecycle now additionally checks real
RPC discovery before and after trader creation and rejects target overflow.
Those added validator assertions require the follow-up CI result; they are not
included in the older validator evidence above. See
[automatic discovery](MARKET_OPERATIONS.md#automatic-portfolio-discovery).

## Remaining release and acceptance work

| Done | ID | Requirement | What closes it |
| --- | --- | --- | --- |
| [ ] | QUAL-02 | Production risk scenarios | Exact accounting and rollback for the selected live Hybrid feed, funding/backing fees, insolvency, payout halts and teardown with reviewed parameters. |
| [ ] | WAL-02 | Real desktop wallet acceptance | Actual wallet/version/browser through connect, approve/reject, account/network changes, signing, interruption and receipt recovery. Use [WALLET_ACCEPTANCE.md](WALLET_ACCEPTANCE.md). |
| [ ] | WAL-03 | Physical iPhone/mobile acceptance | Actual supported wallet browser, complete transaction flow, backgrounding, lock/unlock, layout and recovery. DOM tests cannot close this item. |
| [ ] | OPS-01 | Live oracle integration | Selected authenticated feed and publisher, freshness/confidence rejection, outage and resumed operation under the production configuration. |
| [ ] | OPS-02 | Hosted keeper and portfolio discovery | Discovery is implemented and locally tested. Completion still requires the operating host, production feeds and funded fee payer, capacity/latency and completeness monitoring, and production restart/outage/RPC acceptance. |
| [ ] | PROD-01 | Independent security review | Review the exact engine, wrapper, matcher, oracle, client and operations; resolve findings and record the reviewed release. |
| [ ] | PROD-02 | Production deployment and authority custody | Operator-controlled signer, fee budget, program/market addresses, verifiable build and program bytes, reviewed upgrade/admin policy. Local test keypairs are excluded. |
| [ ] | PROD-03 | Funded execution and backing | Real committed collateral, maker authorization and executable liquidity, inventory/capital limits and insurance policy. Test collateral is not liquidity. |
| [ ] | PROD-04 | Reviewed market parameters | Collateral/feed identities, margin/leverage, OI and position limits, fees/funding and exit delays supported by stress results. |
| [ ] | PROD-05 | Operations and incident response | Responsible operators, alerts, authority rotation, provider failure response and exercised permissionless exits. |
| [ ] | PROD-06 | Final release enrollment | Enroll the approved source, deployed programs, market, authorities and services; repeat wallet acceptance, establish public site access and open deposits only for that release. |

Ordinary traders must not upload a deployment file or configure RPC, oracle or
keeper services. [MAINNET_RELEASE.md](MAINNET_RELEASE.md) defines the trading
and exit experience. [PUBLICATION_STATUS.md](PUBLICATION_STATUS.md) records
publication results.

## How this checklist is maintained

Close a row only with exact source, scope and evidence. Keep failed and interrupted
attempts in the history. Changes to program, client, policy or service inputs
require the affected checks again. A synthetic fixture or passing test count
cannot complete a production prerequisite.
