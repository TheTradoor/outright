# Repair and release checklist

Updated: **15 November 2026 (Asia/Jakarta, UTC+7)**.

**Mainnet trading is not open.** The official deployment profile is `null`.
Earlier reproductions, failures, corrections and source-specific test counts
are preserved in [REPAIR_HISTORY.md](REPAIR_HISTORY.md). This page tracks the
current work without treating an old passing run as evidence for new code.

## Last complete program qualification

| Component | Exact identity |
| --- | --- |
| Qualified client | `da50d845f752f03e9f8b778854bf436a86b93da5`, [PR #32](https://github.com/TheTradoor/outright/pull/32) |
| Tested PR merge | `a4f4ebc0a9703011dc3f8fec12f6a0dd62218122` |
| Published merge | `9ea27452e3be6e141727d205f4a5aae8b028bedb`; same tested tree `a53736b0d8a6282d16267832ef00b5006809faf8` |
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
| [x] | ENG-01 through ENG-06 | Upstream engine accounting fixes | Exact source equivalence and [current engine CI](https://github.com/TheTradoor/outright/actions/runs/43619626470) pass. Historical issue mapping remains in the repair history. |
| [x] | CASE-01 through CASE-10 | Reproduced wrapper, fixture and model failures | Corrections and negative controls are retained. [Earlier full qualification](https://github.com/TheTradoor/outright/actions/runs/43563227621) passed 2,120 executions. The new identity is tracked separately below. |
| [x] | UI-01 through UI-07 | Trader onboarding, retry and chart recovery | Official profile loading is automatic. Deployment import is confined to operator mode. Regressions remain in the client suite. |
| [x] | WAL-01, WAL-04 through WAL-08 | Wallet adapter and session recovery | Malformed registrations, account changes, failed subscriptions, old callbacks and disconnect races are covered by automated tests. |
| [x] | TX-01, KPR-01, RPC-01 | Receipts, keeper deferral and local setup | Custody, network, source, fee-budget and unresolved-receipt guards pass in the current client suite. |
| [x] | CLIENT-01 | Mainnet network and signing transport | [Native CI](https://github.com/TheTradoor/outright/actions/runs/43619626553): 540 tests, source equivalence, exact Rust conformance and terminal build pass. Includes genesis, HTTPS, wallet-chain selection, pre-sign checks and explorer privacy. |
| [x] | PROV-01 through PROV-03 | Source and qualification integrity | 53 local verifier tests pass. Source-drift tests reject wrong revisions, repositories, trees, engine identity, legacy overlays and staged program changes. |
| [x] | RPC-02 | Published program on current validator | [Validator CI](https://github.com/TheTradoor/outright/actions/runs/43619626473): seven confirmed lifecycle transactions; starting/final collateral 1,000,000,000 atoms; final trader capital zero; maker capital 10,000,000,000 atoms. Synthetic fixed-price TEST market only. |
| [x] | INT-03 | Application SBF integration on the published source | [SBF CI](https://github.com/TheTradoor/outright/actions/runs/43619626519): 17 passed, zero failed, ignored or filtered; 32.75 seconds. Controlled local fixtures only. |
| [x] | INT-04 | Independently bound current-validator result | [Candidate validator CI](https://github.com/TheTradoor/outright/actions/runs/43619626489) passed in 25.507 seconds. Downloaded artifact digest, exact client tree, all 73 protocol files, binary hashes and seven-transaction report were independently checked. |
| [x] | BUILD-01 | Independently reproduce the SBPF v3 program | Rebuilt published source with the pinned toolchain; SHA256 exactly matches the program tested by candidate-validator CI. [Binary and provenance](qualification/2026-11-14-published-program/program-build-verification.json) are retained. Production signing and deployment remain open. |
| [x] | ADOPT-01 | Merge published-program runtime adoption | PR #28 merged after all 51 checks passed. The merged source tree is identical to the tested tree. |
| [x] | QUAL-03 | Complete qualification of the current client | [Run 43619626528](https://github.com/TheTradoor/outright/actions/runs/43619626528): 37 shards, 2,120 executions and the aggregate passed. Downloaded program/summary artifact digests, source/binary identities, harness inventory and aggregate records were checked. [Retained evidence and verifier](qualification/2026-11-14-keeper-health/README.md#remote-results). Individual raw wrapper logs were not independently downloaded for this run. The earlier PR #31 packet retains its separate 39-artifact/2,120-log verification. |
| [x] | SITE-01 | Current website publication | [Version 31](qualification/2026-11-14-keeper-discovery/site-publication.json) deployed successfully from source `1517db4e58f0fb51ceedb3e7d8ffed5577e6e32f`. All 67 canonical protocol files match the PR #31 client. Checks pass for 17 routes, 754 links/assets, four mechanics tests and 525 client tests. This publication did not repeat the earlier browser visual check or establish physical-wallet acceptance. Existing owner-only access and the `null` deployment profile are preserved. |
| [x] | KPR-02 | Durable portfolio discovery and bounded RPC transport | PR #31 passed 525 client tests, including 29 new cases, and real RPC discovery before/after account creation with overflow rejection. Static-target behavior, pending-receipt precedence, fee limits and duplicate protection are retained. |
| [x] | KPR-03 | Keeper health and host templates | PR #32 merged after all 51 checks passed; its merge tree equals the tested tree. 540 client tests include 15 new monitor cases and real CLI restart/failure assertions against controlled RPC fixtures. Source equivalence, terminal build and service syntax checks pass. [Evidence](qualification/2026-11-14-keeper-health/README.md). Production host and alert acceptance remain open. |

A checked item is complete within its stated scope. Automated adapters and a
website deployment do not establish real-wallet acceptance, production liquidity
or independent security review.

## Completed keeper discovery

The operator now supports opt-in discovery within its enrolled market. Full
account/program verification precedes admission, and complete sweeps survive
restart without resetting fees or bypassing pending receipts. The CLI bounds
HTTP response bytes and cancels oversized responses. The engine and wrapper
pins are unchanged.

Local client checks pass **525/525**, including 29 new discovery/transport
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
The PR #31 evidence retains its original source identity.

| Done | ID | Requirement | What closes it |
| --- | --- | --- | --- |
| [ ] | QUAL-02 | Production risk scenarios | Exact accounting and rollback for the selected live Hybrid feed, funding/backing fees, insolvency, payout halts and teardown with reviewed parameters. |
| [ ] | WAL-02 | Real desktop wallet acceptance | Actual wallet/version/browser through connect, approve/reject, account/network changes, signing, interruption and receipt recovery. Use [WALLET_ACCEPTANCE.md](WALLET_ACCEPTANCE.md). |
| [ ] | WAL-03 | Physical iPhone/mobile acceptance | Actual supported wallet browser, complete transaction flow, backgrounding, lock/unlock, layout and recovery. DOM tests cannot close this item. |
| [ ] | OPS-01 | Live oracle integration | Selected authenticated feed and publisher, freshness/confidence rejection, outage and resumed operation under the production configuration. |
| [ ] | OPS-02 | Hosted keeper and portfolio discovery | Discovery is verified through client, SBF and real RPC validator checks. Local health checks now track receipt age, sweep latency, rejected visits, bank progress and fee headroom across restart; Linux service templates are supplied. Completion still requires the actual host, live feeds, funded payer, independent discovery-completeness monitoring and production capacity/outage acceptance. |
| [ ] | PROD-01 | Independent security review | Review the exact engine, wrapper, matcher, oracle, client and operations; resolve findings and record the reviewed release. |
| [ ] | PROD-02 | Production deployment and authority custody | Operator-controlled signer, fee budget, program/market addresses, verifiable build and program bytes, reviewed upgrade/admin policy. Local test keypairs are excluded. |
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
