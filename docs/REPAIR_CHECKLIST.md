# Repair and release checklist

Updated: **15 November 2026 (Asia/Jakarta, UTC+7)**.

**Mainnet trading is not open.** The official deployment profile is `null`.
Earlier reproductions, failures, corrections and source-specific test counts
are preserved in [REPAIR_HISTORY.md](REPAIR_HISTORY.md). This page tracks the
current work without treating an old passing run as evidence for new code.

## Current complete program qualification

[Application PR #41](https://github.com/TheTradoor/outright/pull/41) and
[program PR #2](https://github.com/TheTradoor/outright-program/pull/2) are merged.
All 51 application checks passed before merge. The published trees match their
qualified sources. The prior PR #39 evidence remains at its original identity.

| Component | Exact identity |
| --- | --- |
| Qualified client | `7fef978012ca24fee7468c8d35416f4b3d9f10a7`, PR #41 |
| Tested PR merge | `1cb3d8fff140f0594ddfcce7acea2ba724935ac3` |
| Published application merge | `518eb3acfb9667aaa899eeb86835d0cd4f1020a5`; same tested tree `315c274942622526cb0e9d644f13f0aa4bd44861` |
| Percolator engine | `5e3af0710ec7e9b7077393012f8a94a31b2f07ef`, unchanged upstream source |
| Pinned program | `TheTradoor/outright-program@cfcc3f7b005faea0ff2caeb39bc87a48f75d8761` |
| Published program merge | `162e73edb4f411d18907a9516e8c2808879935bc` |
| Program source tree | `49f987d4963083b9befb3f92cf813fc656dcd02c` |

Runtime, Rust conformance and complete qualification require the same published
program source. The historical patch is retained as evidence; current builds
fetch the published commit directly. Wrong pins, missing tree identity and
staged program edits stop verification.

## Completed corrections and current verification

| Done | ID | Work | Evidence and scope |
| --- | --- | --- | --- |
| [x] | ACCESS-01 | GitHub 403 and fork publication | Selected-repository access now includes the program fork. [Program PR #1](https://github.com/TheTradoor/outright-program/pull/1) is merged with the exact qualified tree. |
| [x] | ENG-01 through ENG-06 | Earlier upstream engine accounting fixes | Retained in the adopted source. [Current engine CI](https://github.com/TheTradoor/outright/actions/runs/43710363763) passes 406 default and 474 fuzz-feature tests; counts overlap. Historical issue mapping remains in the repair history. |
| [x] | CASE-01 through CASE-10 | Reproduced wrapper, fixture and model failures | Corrections and negative controls are retained. [Earlier full qualification](https://github.com/TheTradoor/outright/actions/runs/43563227621) passed 2,120 executions. The new identity is tracked separately below. |
| [x] | UI-01 through UI-07 | Trader onboarding, retry and chart recovery | Official profile loading is automatic. Deployment import is confined to operator mode. Regressions remain in the client suite. |
| [x] | WAL-01, WAL-04 through WAL-08 | Wallet adapter and session recovery | Malformed registrations, account changes, failed subscriptions, old callbacks and disconnect races are covered by automated tests. |
| [x] | TX-01, KPR-01, RPC-01 | Receipts, keeper deferral and local setup | Custody, network, source, fee-budget and unresolved-receipt guards pass in the current client suite. |
| [x] | CLIENT-01 | Mainnet network and signing transport | [Native CI](https://github.com/TheTradoor/outright/actions/runs/43646089202): 594 tests, source equivalence, exact Rust conformance and terminal build pass. Includes genesis, HTTPS, wallet-chain selection, pre-sign checks and explorer privacy. |
| [x] | PROV-01 through PROV-03 | Source and qualification integrity | 53 local verifier tests pass. Source-drift tests reject wrong revisions, repositories, trees, engine identity, legacy overlays and staged program changes. |
| [x] | RPC-02 | Published program on current validator | [Validator CI](https://github.com/TheTradoor/outright/actions/runs/43710363791): seven confirmed lifecycle transactions; starting/final collateral 1,000,000,000 atoms; final trader capital zero; maker capital 10,000,000,000 atoms. Synthetic fixed-price TEST market only. |
| [x] | INT-03 | Application SBF integration on the published source | [SBF CI](https://github.com/TheTradoor/outright/actions/runs/43710363748): 19 passed, zero failed, ignored or filtered; 58.85 seconds. Controlled local fixtures only. |
| [x] | INT-04 | Independently bound current-validator result | [Candidate validator CI](https://github.com/TheTradoor/outright/actions/runs/43710363793) passed in 25.762 seconds. Downloaded artifact digest, exact client tree, all 81 protocol files, binary hashes and seven-transaction report were independently checked. |
| [x] | BUILD-01 | Reproduce the earlier SBPF v3 program | The previous program was independently rebuilt with its pinned toolchain and matched its candidate-validator hash. [Earlier binary and provenance](qualification/2026-11-14-published-program/program-build-verification.json) remain retained. The updated binary is independently reproduced under BUILD-02. |
| [x] | BUILD-02 | Reproduce the updated SBPF v3 program | Clean independent build of program `cfcc3f7b` with engine `5e3af071` reproduces all 1,283,424 bytes by SHA-256 `93c73f13...2d96e6a4`. The full ELF, logs and source identities are [retained](qualification/2026-11-15-program-rebuild/README.md). Mainnet rent was refreshed for an exact-length sizing scenario; final production capacity and the transaction budget remain under PROD-02. |
| [x] | PROV-04 | Bind validator reports to built binaries | [PR #43](https://github.com/TheTradoor/outright/pull/43) rejects substituted program/matcher hashes, malformed hashes and incomplete or extra inventories. Both prior false acceptances were reproduced; the original qualified report still passes. 59 verifier tests and 607 client tests pass locally. All five PR checks passed; the fresh validator run confirms seven lifecycle transactions with matching binary hashes. [Evidence](qualification/2026-11-15-program-rebuild/README.md#report-verification-bug). |
| [x] | ADOPT-01 | Merge published-program runtime adoption | PR #28 merged after all 51 checks passed. The merged source tree is identical to the tested tree. |
| [x] | QUAL-03 | Complete qualification of the current client | [Run 43710363768](https://github.com/TheTradoor/outright/actions/runs/43710363768): 37 shards, 2,137 executions and the aggregate passed. All 39 wrapper artifact digests and all 2,137 raw logs were independently verified and retained, together with source/binary identities, harness inventory and aggregate records. [Evidence and verifier](qualification/2026-11-15-upstream-accounting/README.md#artifact-verification). |
| [x] | SITE-01 | Current website publication | [Version 34](qualification/2026-11-15-upstream-accounting/site-publication.json) deployed from source `aee9c4a111f0713066b11fc61cbb21a0861b54cb`. All 81 canonical protocol files match merged client `518eb3ac`. Checks pass for 20 routes, 994 local links/assets, four mechanics tests and 607 client tests. Chromium verified the corrected spec link, search navigation, unavailable/retry state and the published update. Owner-only access and the `null` deployment profile are preserved. [Evidence](qualification/2026-11-15-upstream-accounting/README.md#website-publication). |
| [x] | KPR-02 | Durable portfolio discovery and bounded RPC transport | PR #31 passed 525 client tests, including 29 new cases, and real RPC discovery before/after account creation with overflow rejection. Static-target behavior, pending-receipt precedence, fee limits and duplicate protection are retained. |
| [x] | KPR-03 | Keeper health and host templates | PR #32 merged after all 51 checks passed; its merge tree equals the tested tree. 540 client tests include 15 new monitor cases and real CLI restart/failure assertions against controlled RPC fixtures. Source equivalence, terminal build and service syntax checks pass. [Evidence](qualification/2026-11-14-keeper-health/README.md). Production host and alert acceptance remain open. |
| [x] | ORC-01 | Read-only Pyth feed inspection | PR #34 merged after all 51 checks passed; its merge tree equals the tested tree. The inspector checks the exact receiver, full verification, feed identity, age, confidence and integer E6 scaling. 594 client tests include 54 oracle cases; 31 shared vectors match the published wrapper through Rust conformance. A real mainnet SOL/USD observation passed the explicit inspection policy. [Retained results](qualification/2026-11-15-pyth-inspection/README.md) and [operator guide](ORACLE_OPERATIONS.md). Feed publishing and production acceptance remain open. |
| [x] | INT-05 | Hybrid funding through feed outage and recovery | PR #36 merged after all 51 checks passed; its tree equals the tested tree. The 19-case SBF suite includes both funding directions and two settlement schedules, strict fallback delay, malformed-feed rejection, recovery without retroactive or repeated charges, exact accounting and rollback. [Evidence](qualification/2026-11-15-hybrid-funding/README.md#remote-results). Production parameters and live publisher acceptance remain open. |
| [x] | RPC-03 | Bounded terminal and wallet RPC responses | PR #39 passed 607 client tests, including 13 new cases; full qualification passed all 51 checks. Profile responses are limited during streaming to 64 KiB, and wallet/keeper RPC to 16 MiB. Cancellation, timeout and retry passed browser and automated checks. [Evidence](qualification/2026-11-15-response-limits/README.md). |

| [x] | ENG-07 | Adopt upstream loss-accounting and refresh-bound corrections | Program PR #2 and application PR #41 retain nine engine and eleven program commits. All 35 new engine regression cases and 15 new CU cases pass. Engine implementation, specification, tests and build inputs match upstream exactly. [Source review and results](qualification/2026-11-15-upstream-accounting/README.md). |

A checked item is complete within its stated scope. Automated adapters and a
website deployment do not establish real-wallet acceptance, production liquidity
or independent security review.

The current upstream integration is merged through application PR #41 and program
PR #2 after all 51 checks passed. [Retained evidence](qualification/2026-11-15-upstream-accounting/README.md)
binds the 607-client, 19-SBF, validator and 2,137-wrapper results to their exact
source and program bytes. All raw wrapper logs are retained. Earlier response-limit
and Hybrid funding records keep their original source identities.

The Hybrid funding follow-up is merged through PR #36. Local checks passed 19
SBF tests, 594 client tests and 53 verifier tests. Remote qualification passed
all 51 checks and 2,122 wrapper executions with matching source and artifact
identities. [Retained results](qualification/2026-11-15-hybrid-funding/README.md#remote-results).
These controlled traces do not close QUAL-02 for production market parameters.

## Completed keeper discovery

The operator now supports opt-in discovery within its enrolled market. Full
account/program verification precedes admission, and complete sweeps survive
restart without resetting fees or bypassing pending receipts. The CLI bounds
HTTP response bytes and cancels oversized responses. The engine and wrapper
pins are unchanged.

For PR #31, local client checks passed **525/525**, including 29 new discovery/transport
scenarios; source equivalence and terminal build pass, and the verifier suite
passes **53/53**. The current-validator lifecycle now additionally checks real
RPC discovery before and after trader creation and rejects target overflow.
These added validator assertions pass in run 43600724703. All **51 PR checks**
passed before PR #31 merged with the exact tested tree. See the
[retained evidence](qualification/2026-11-14-keeper-discovery/README.md) and
[automatic discovery](MARKET_OPERATIONS.md#automatic-portfolio-discovery).

## Remaining release and acceptance work

The merged keeper health follow-up adds operational checks and Linux service
templates without changing engine, program, instruction or custody code. Its
local and remote validation is recorded in
[keeper health verification](qualification/2026-11-14-keeper-health/README.md).
The PR #31 evidence retains its original source identity. The Pyth inspection follow-up
is merged through PR #34; its [retained evidence](qualification/2026-11-15-pyth-inspection/README.md#remote-results)
is separate from the earlier keeper results. It does not deploy a publisher or
approve production market parameters.

| Done | ID | Requirement | What closes it |
| --- | --- | --- | --- |
| [ ] | QUAL-02 | Production risk scenarios | Exact accounting and rollback for the selected live Hybrid feed, funding/backing fees, insolvency, payout halts and teardown with reviewed parameters. |
| [ ] | WAL-02 | Real desktop wallet acceptance | Actual wallet/version/browser through connect, approve/reject, account/network changes, signing, interruption and receipt recovery. Use [WALLET_ACCEPTANCE.md](WALLET_ACCEPTANCE.md). |
| [ ] | WAL-03 | Physical iPhone/mobile acceptance | Actual supported wallet browser, complete transaction flow, backgrounding, lock/unlock, layout and recovery. DOM tests cannot close this item. |
| [ ] | OPS-01 | Live oracle integration | Read-only Pyth inspection is implemented under ORC-01. Completion still requires the selected authenticated feed and funded publisher, reviewed cadence, freshness/confidence rejection, outage and resumed operation under the production configuration. |
| [ ] | OPS-02 | Hosted keeper and portfolio discovery | Discovery is verified through client, SBF and real RPC validator checks. Local health checks now track receipt age, sweep latency, rejected visits, bank progress and fee headroom across restart; Linux service templates are supplied. Completion still requires the actual host, live feeds, funded payer, independent discovery-completeness monitoring and production capacity/outage acceptance. |
| [ ] | PROD-01 | Independent security review | Review the exact engine, wrapper, matcher, oracle, client and operations; resolve findings and record the reviewed release. |
| [ ] | PROD-02 | Production deployment and authority custody | Operator-controlled signer, final program capacity and transaction budget, program/market addresses, verified deployed bytes, reviewed upgrade/admin policy. The independent build and exact-length rent observation are complete; production allocation remains unselected. Local test keypairs are excluded. |
| [ ] | PROD-03 | Funded execution and backing | Real committed collateral, maker authorization and executable liquidity, inventory/capital limits and insurance policy. Test collateral is not liquidity. |
| [ ] | PROD-04 | Reviewed market parameters | Collateral/feed identities, margin/leverage, OI and position limits, fees/funding and exit delays supported by stress results. |
| [ ] | PROD-05 | Operations and incident response | Health JSON and service exit status are available for host alert routing. Assigned operators, delivered alerts, authority rotation, provider failure response and exercised permissionless exits remain required. |
| [ ] | PROD-06 | Final release enrollment | Enroll the approved source, deployed programs, market, authorities and services; repeat wallet acceptance, establish public site access and open deposits only for that release. |

Ordinary traders must not upload a deployment file or configure RPC, oracle or
keeper services. [MAINNET_RELEASE.md](MAINNET_RELEASE.md) defines the trading
and exit experience. [PUBLICATION_STATUS.md](PUBLICATION_STATUS.md) records
publication results. [PRODUCTION_INPUTS.md](PRODUCTION_INPUTS.md) records the
missing public authority addresses, budgets, liquidity commitment and service
configuration needed to prepare the production deployment.

## How this checklist is maintained

Close a row only with exact source, scope and evidence. Keep failed and interrupted
attempts in the history. Changes to program, client, policy or service inputs
require the affected checks again. A synthetic fixture or passing test count
cannot complete a production prerequisite.
