# Repair and verification checklist

Updated: **14 November 2026 (Asia/Jakarta, UTC+7)**.

This checklist separates a completed correction from a passing test, an
upstream report, and work that has not been verified. Mainnet deposits remain
disabled. A green row applies only to its stated source revision and evidence;
it is not a promise that the application has no other bugs.

## Status definitions

| Status | Meaning | Required evidence |
| --- | --- | --- |
| **Verified passing** | A complete scoped check passed without implying that unrelated failures are resolved. | Exact target, source/artifact identity, counts and complete result. |
| **Fixed and verified** | The correction is present and the relevant checks passed. | Source change, affected behavior and an identifiable passing run. |
| **Reproduced / open** | A failure has been observed against the recorded artifacts and is not yet resolved. | Exact failing test or transaction, assertion/error, source and artifact identity. |
| **Unverified** | The behavior is reported or required, but the necessary direct check is incomplete. | Keep open until the reproduction or acceptance evidence exists. |
| **External prerequisite** | Completion requires production resources or an independent party in addition to code. | Named operator/resource/reviewer and evidence for the exact release. |

Checked boxes mean the scoped row is complete. They do not imply completion of
other rows or permission to accept public funds.

## Integrated baseline evidence and current qualification

The earlier integrated baseline is `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c`, tree
`e63c1049c06b0f1ca3a62dde3ec65a6e1c85efff`. PR #25 checks executed GitHub's merge
`07e88e6d6cf5c0af5c1b736bd0976aa6e9c91de3`. The runtime wrapper pin remains
`357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`; the repaired candidate is tested as the
separately identified base-plus-patch source below.

The checked-host follow-up at `9191c8819ad683a7d8ffa49f831df5d90b99adb1`, tested
merge `43ee48081321b5607de58c991ca5c5ae3af7a024`, passed the complete **37-shard,
2,120-execution wrapper gate**, including its aggregate. The five separate
engine/native workflows also passed. [Complete retained evidence](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md)
binds this result to its exact source and artifacts; later client changes require
their own affected release checks. Earlier rows below retain their original
source-specific evidence.

| Done | Current check | Result | Evidence and limit |
| --- | --- | --- | --- |
| [x] | Default and fuzz-feature engine | 371 and 439 passed; zero failed, ignored or filtered | [Engine run](https://github.com/TheTradoor/outright/actions/runs/43526783773), jobs `132234396587` / `132234396972`; the two suites overlap. |
| [x] | Native client, source identity and Rust conformance | 477 passed; zero failed, skipped or cancelled; terminal build passed | [Native run](https://github.com/TheTradoor/outright/actions/runs/43526782095), job `132234392998`. |
| [x] | Baseline-wrapper application SBF integration | 17 passed; zero failed, ignored or filtered; 27.45 seconds | [SBF run](https://github.com/TheTradoor/outright/actions/runs/43526781978), job `132234390957`. |
| [x] | Repaired-candidate application integration, SBPF v0 | 17 passed; zero failed, ignored or filtered | [Freshness candidate result](qualification/2026-11-14-repairs/freshness/freshness-candidate-native.json). Recorded at source `3372660…` against the original candidate; all 61 protocol files match the final source, whose extra ownership-test correction does not change production binary bytes. This earlier run is not relabeled as a final-head run. |
| [x] | Baseline-wrapper current-validator lifecycle | Seven RPC transactions passed; collateral 1,000,000,000 atoms before and after; final trader capital zero; maker capital 10,000,000,000 atoms | [Validator run](https://github.com/TheTradoor/outright/actions/runs/43526782038), job `132234391027`; [report](qualification/2026-11-14-repairs/final-native-ci/validator-report.json). |
| [x] | Repaired-candidate current-validator lifecycle | Seven confirmed RPC transactions passed on platform-tools v1.58 / SBPF v3 / Agave 4.4.1; 25.765 seconds; the same exact balance reconciliation | [Candidate run](https://github.com/TheTradoor/outright/actions/runs/43526782070), job `132234392500`; [full source and artifact evidence](qualification/2026-11-14-repairs/candidate-validator-final-ci/README.md). Synthetic fixed-price market only. |
| [x] | Website version 28 deployment and shipping checks | Deployment succeeded; 17 routes, 750 local links/assets, four mechanics tests and 477 client tests passed; all 61 protocol files match the final source | [Shipping record](qualification/2026-11-14-repairs/site-v28.json). Archive has 55 entries with no unexpected dependency, Git, keypair or environment paths. Hosted deployment profile remains `null`. |
| [x] | Fresh desktop browser onboarding | Passed on the unchanged version-28 client | [Browser record](qualification/2026-11-14-repairs/browser-2026-11-14.json): terminal navigation, unavailable state, retry and operator separation verified. This does not cover a configured market or physical wallet. |
| [ ] | Physical-wallet acceptance | Not completed | Desktop extension and iPhone wallet connection/signing/recovery remain open. |
| [x] | Checked-host exhaustive graph, supplemental | Passed in 540.362 seconds; original 1,800-second limit and all 11,727 action words retained | [Complete local graph evidence](qualification/2026-11-14-repairs/checked-host-graph/README.md). Debug assertions and overflow checks enabled; deployed SBF artifacts unchanged. This one-test result does not close the 37-shard aggregate. |
| [x] | Complete 37-shard wrapper qualification | 2,120 passed, zero failed; aggregate passed | [Complete checked-host run](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md), source `9191c881…`, tested merge `43ee4808…`. All reports, exact execution coverage and source/artifact identities independently verified. The graph passed in 457.375 seconds with its original 1,800-second limit. The earlier timeout remains historical evidence. |
| [ ] | Live market and mainnet | Not implemented or enabled | The client accepts only localnet/devnet profiles; mainnet enrollment, wallet-chain/signing, explorer handling and fresh acceptance checks remain open under PROD-06. The hosted deployment profile remains `null`. |
| [ ] | Fork publication and runtime-pin adoption | Blocked by GitHub integration write access (`403`) | Installation [156871870](https://github.com/settings/installations/156871870) has selected-repository access that omits `TheTradoor/outright-program`. Add that repository to the installation before publishing the candidate and migrating the pin; see ADOPT-01 below. |

All five final native PR jobs and all four duplicate push workflows passed.
[Complete native CI logs and hashes](qualification/2026-11-14-repairs/final-native-ci/README.md)
retain the exact source and checkout identities. The candidate-validator source
identity independently matches the final source, protocol bytes, runner, manifest
and patch. Neither result substitutes for the complete wrapper aggregate.
Existing compiler warnings, including `Invalid syscall code 9` during SBF
post-processing, remain visible in the raw logs; actual deployment and the scoped
RPC lifecycles succeeded.

A bounded independent review of the freshness correction found no actionable
issue within its reviewed scope. This review is not counted as additional tests
or proof that unreviewed behavior is correct.

Website version 28 uses source `aee5ba3fc4fb55aabaab415c758ef0201c653830` and
successfully deployed at `2026-11-13T23:33:01.912572Z`. The released archive hash is
`0679f999fce51181f7ce0efc7d1f1384c29cd240b081b42acdd37a835fa85910`. This publishes
the client and documentation while keeping mainnet deposits disabled. Fork
write access and runtime source-pin migration remain open under ADOPT-01.

The sections below preserve earlier snapshots and the original failures. Their
counts and source identities are historical evidence, not replacements for the
final-source results above.

## Original client source baseline

| Component | Exact identity |
| --- | --- |
| Outright merged source | `aca0a325d870997c64986f8af52f3b4272aa4f9a` |
| Tested client revision, PR #21 | `22c15a7db2aa0aa2f3b0377fa6b5ace0f416e81a` |
| Tested repository tree | `aca46d2c466c2430433f85920a8a08b5dae4d4ac` |
| Percolator engine | `a712af767eeb217876a3d3c50e3849b60ea54462` |
| Solana wrapper | `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13` |
| Upstream adoption | [PR #20](https://github.com/TheTradoor/outright/pull/20) |
| Trader onboarding | [PR #21](https://github.com/TheTradoor/outright/pull/21) |

The engine sources, specification and inherited tests match the pinned
upstream baseline. The wrapper is a separate dependency; its wider test gates
are separate from Outright's 17-case integration suite. Changing a source pin
or applying a patch requires fresh evidence for the affected checks.

## Corrections already incorporated and verified

These rows record work completed before the current broader-failure
investigation. Engine corrections are upstream work adopted in PR #20, not
newly authored Outright fixes. Their attribution and commit history are retained.

| Done | ID | Behavior corrected | Status | Evidence and scope |
| --- | --- | --- | --- | --- |
| [x] | ENG-01 | Dead-leg close removes only the effective open interest still remaining on that side, including zero. | Fixed and verified | Upstream engine #132 adopted in PR #20; source equivalence and engine suites passed. |
| [x] | ENG-02 | Consumed K/F support is attributed to the domain owed the loss. | Fixed and verified | Upstream engine #175 adopted in PR #20; source equivalence, engine and native integration checks passed. |
| [x] | ENG-03 | Fully backed same-domain claims can offset debt with correct backing attribution. | Fixed and verified | Upstream engine #252 adopted in PR #20; engine regression suite retained. |
| [x] | ENG-04 | Live refresh expires lapsed backing in active legs' latent source domains. | Fixed and verified | Upstream engine #243 adopted in PR #20; default and fuzz-feature suites passed. |
| [x] | ENG-05 | Lien-covered face and pledged backing leave the credit-rate calculation together while the provider withdrawal watermark remains conservative. | Fixed and verified | Upstream engine #250 adopted in PR #20; exact source checks and engine suites passed. |
| [x] | ENG-06 | A waiting zero-conversion claim does not roll back earlier close progress; final sub-atom claims can retire. | Fixed and verified | Upstream engine #251 adopted in PR #20; inherited regression coverage and integration gate passed. |
| [x] | UI-01 | Connect wallet no longer opens a deployment-file dialog in the normal trader flow. | Fixed and verified | PR #21; the default page loads the official profile and opens the wallet chooser once a supported profile is available. DOM and Chromium checks passed. |
| [x] | UI-02 | Operator file import is separated from trader onboarding. | Fixed and verified | Explicit `?operator=1` mode, separate banner and guarded handlers; direct events cannot trigger import from normal trader mode. |
| [x] | UI-03 | Missing configuration has a visible market-unavailable state. | Fixed and verified | `null` profile regression and browser observation; wallet/deposit/trade controls remain disabled. |
| [x] | UI-04 | Failed HTTP requests, network errors and timeouts permit a fresh retry without overlapping requests. | Fixed and verified | Eight onboarding DOM scenarios cover request errors, 15-second timeout, duplicate retry and eventual success. |
| [x] | UI-05 | Invalid, oversized, wrong-source and unsupported-network profiles cannot enable wallet actions. | Fixed and verified | Onboarding regressions cover invalid JSON, source mismatch, more than 64 KiB and mainnet profile rejection. |
| [x] | UI-06 | A late startup response cannot replace a successfully selected operator profile. | Fixed and verified | Existing terminal race regression; successful import supersedes and aborts pending startup loading. |
| [x] | WAL-01 | Wallet changes, removed accounts and closed choosers cannot attach stale connection results. | Fixed and verified | Existing terminal lifecycle scenarios remain passing; see [verification history](NATIVE_VERIFICATION.md#wallet-selection-lifecycle). |
| [x] | TX-01 | Receipt failures and cross-tab updates cannot silently restore stale actionable balances. | Fixed and verified | Receipt/session regressions remain passing; [cross-tab coverage](NATIVE_VERIFICATION.md#cross-tab-receipt-consistency). |
| [x] | KPR-01 | Missing keeper targets are deferred without bypassing verification or losing fee/receipt constraints. | Fixed and verified | The 100 keeper tests remain passing; [keeper deferral evidence](NATIVE_VERIFICATION.md#keeper-deferral-after-simulation). |
| [x] | RPC-01 | Local market setup uses the official loader identity, exact program pins and bounded transaction reconciliation. | Fixed and verified | Setup regressions and current-validator lifecycle gate; [local runner evidence](NATIVE_VERIFICATION.md#funded-local-validator). |

## Recorded passing checks

These are the completed PR #21 baseline checks. They are not results of the
current upstream-wide reproduction run recorded below.

| Done | Check | Recorded result | Evidence | Limit |
| --- | --- | --- | --- | --- |
| [x] | Default engine suite | 371 passed | [Engine CI](https://github.com/TheTradoor/outright/actions/runs/43507775023) | Finite runtime suite. |
| [x] | Engine with fuzz feature | 439 passed | Same engine CI | Overlaps the default suite; do not add the counts. Not a continuous fuzz campaign. |
| [x] | Native client, terminal and keeper | 452 passed | [Native CI](https://github.com/TheTradoor/outright/actions/runs/43507775412) | Includes test harness parents; 61 terminal DOM scenarios are not 61 physical-wallet runs. |
| [x] | Rust instruction/account conformance | Exact comparison passed | Same native CI | Source identity, byte encoding and layout compatibility; not a security proof. |
| [x] | Outright legacy SBF integration | 17 passed, zero failed or ignored | [SBF CI](https://github.com/TheTradoor/outright/actions/runs/43507775247) | Selected application scenarios with controlled oracle and matcher fixtures. |
| [x] | Agave 4.4.1 RPC lifecycle | Seven confirmed lifecycle transactions | [Validator CI](https://github.com/TheTradoor/outright/actions/runs/43507775445) | Synthetic local market; generated test signer. |
| [x] | RPC balance reconciliation | Starting/final collateral both 1,000,000,000 atoms; final portfolio capital zero; maker capital 10,000,000,000 atoms | Same validator CI | Fixed test price, zero funding and test collateral. |
| [x] | Website build and route checks | 16 HTML routes, 689 local links/assets, search anchors, four PnL tests and 452 client tests passed | Website verification record and PR #21 snapshot | Static/UI checks do not verify production services. |
| [x] | Browser onboarding review | Normal trader state, retry, explicit operator dialog, guide navigation/search verified | Chromium review at the PR #21 website snapshot | No real wallet extension or physical phone. Browser-extension metadata errors were observed separately from the application. |

The RPC lifecycle covers portfolio creation, a 100 TEST deposit, long
open/close, short open/close and a 100 TEST withdrawal. An oversized deposit
was also rejected without changing the expected balances.

## Corrections in the current investigation

The following corrections are recorded in [PR #22](https://github.com/TheTradoor/outright/pull/22),
client revision `6966fbf55689e09a4ff928fec2805958095c13de` and tree
`d3f38d587bfcc89386ff7548cd8c787340c469e1`. The earlier 452-test baseline
remains historical evidence.

| Done | ID | Behavior corrected | Status | Current evidence and limit |
| --- | --- | --- | --- | --- |
| [x] | UI-07 | A missing canvas context no longer strands market startup or prevents wallet use. The chart can recover existing observations without reconnecting. | Fixed and verified | New null-context and chart-recovery DOM regressions; non-chart wallet data remains usable. |
| [x] | WAL-04 | Malformed wallet registrations and throwing feature getters no longer hide a healthy wallet. | Fixed and verified | Eight malformed-adapter variants and late-registration regression; invalid adapters are isolated. |
| [x] | WAL-05 | Invalid account lists and malformed account-change events no longer crash or retain actionable state. | Fixed and verified | Valid authorized accounts can still connect; invalid responses remain recoverable in the chooser; malformed updates clear state. |
| [x] | WAL-06 | Failed event subscription or invalid cleanup cannot leave partial wallet authorization or an active old callback. | Fixed and verified | Regressions reuse the same adapter identity and prove subscription-specific callback isolation. |
| [x] | WAL-07 | A throwing listener cleanup cannot block disconnect or alter a later session. | Fixed and verified | Disconnect clears balances/actions; a retained old callback cannot affect the replacement session. |
| [x] | WAL-08 | A synchronous disconnect during event subscription cannot complete a wallet connection. | Fixed and verified | Subscription-race regression checks disabled actions, no connected wallet and exactly one cleanup. |

Eighteen new scenarios are recorded in
[`wallet-adapters.test.mjs`](../protocol/tests/wallet-adapters.test.mjs).
The affected terminal/onboarding/adapter tests passed **82/82**. The final local
native run, recorded in `pr22-native-final.log`, passed **471 tests with zero
failures, skips or cancellations**, with engine source verification and Rust
conformance. This count includes test harness parents and is not a physical
wallet or mainnet acceptance count. The preserved [before-fix failures](qualification/2026-11-14/wallet-before.log) and [after-fix passing run](qualification/2026-11-14/wallet-after.log) provide the adapter regression comparison. All ten GitHub push/PR checks passed for the exact client revision before [PR #22](https://github.com/TheTradoor/outright/pull/22) merged as `77691cb3084ca9f8f0190aafd934fb6c4518f625`. The merge tree equals the tested tree.

### Historical CI for the PR #22 client correction

| Done | Check | Result | Evidence |
| --- | --- | --- | --- |
| [x] | Default engine | 371 passed, no failed or ignored tests | [Engine run](https://github.com/TheTradoor/outright/actions/runs/43511981402) |
| [x] | Fuzz-feature engine | 439 passed, no failed or ignored tests; overlaps default | Same engine run |
| [x] | Native protocol | Source and Rust conformance, 471 native tests and terminal build passed | [Native run](https://github.com/TheTradoor/outright/actions/runs/43511981328) |
| [x] | Application SBF integration | 17 passed, no failed, ignored or filtered tests | [SBF run](https://github.com/TheTradoor/outright/actions/runs/43511981234) |
| [x] | Current-validator RPC lifecycle | Seven transactions; collateral starts and ends at 1,000,000,000 atoms, final portfolio capital zero | [Validator run](https://github.com/TheTradoor/outright/actions/runs/43511981276), [retained report](qualification/2026-11-14/validator-report.json) |
| [x] | Browser visual review of the corrected client | A fresh Chromium tab verified the terminal, retry state, home/docs navigation, checklist anchors and search; no desktop horizontal overflow | Website version 26; no physical wallet or phone acceptance is implied. The previous browser attachment failure was recovered. |

### Earlier PR #25 snapshot: client and provenance verification

At the earlier [PR #25](https://github.com/TheTradoor/outright/pull/25) source head
`9a5d13b27ab77a1a927e0f41d15bc6f6da6606d1`, its five PR jobs checked out
GitHub's merge commit `1a3f222b7452242481b9633e1fc1c4c8fd00abbf`, combining that
head with base `c3e9246664e1dd2d21519681ff336a4539f52c4e`. All five jobs and the
four duplicate push workflows succeeded. These application checks still use
wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`; they do not establish that the
candidate wrapper below passed its complete qualification gate.

| Done | Check | Observed result | Evidence |
| --- | --- | --- | --- |
| [x] | Default engine | 371 passed; zero failed, ignored or filtered | [Engine run](https://github.com/TheTradoor/outright/actions/runs/43520469023), job `132213134856` |
| [x] | Fuzz-feature engine | 439 passed; zero failed, ignored or filtered; overlaps the default suite | Same engine run, job `132213134483` |
| [x] | Native protocol | 471 passed; zero failed, skipped or cancelled; source check, Rust exporter comparison and terminal build passed | [Native run](https://github.com/TheTradoor/outright/actions/runs/43520468868), job `132213133849` |
| [x] | Application SBF integration | 17 passed; zero failed, ignored or filtered; 36.41 seconds | [SBF run](https://github.com/TheTradoor/outright/actions/runs/43520468869), job `132213133348` |
| [x] | Current-validator RPC lifecycle | Seven client transactions; collateral remained 1,000,000,000 atoms, final trader portfolio capital zero, maker capital 10,000,000,000 atoms | [Validator run](https://github.com/TheTradoor/outright/actions/runs/43520468858), job `132213133291`; [retained report](qualification/2026-11-14-repairs/pr25-native-ci/validator-report.json) |

The [CI evidence record](qualification/2026-11-14-repairs/pr25-native-ci/README.md)
retains complete logs, source identities, job IDs, counts and hashes. Compiler
warnings remain, including the SBF post-processing warning `Invalid syscall code 9`
in the validator build; deployment and the recorded RPC lifecycle nevertheless
completed. Passing checks are not a claim of warning-free builds.

### Trader price availability follow-up

At client revision `3372660fc4d76b47b6cdb1a12a239bce4dcb84f5` (tree
`77f802229d2eba0c90d6cf57c4834078d9f9c383`), trade review now uses the same
oracle-freshness predicate as transaction preparation. Expired observations,
future-slot observations and zero effective prices disable review and show a
refresh/wait message. A fresh snapshot restores review; deposit and exit policy
remain unchanged. Three UI regressions failed before the correction. The
[local before/after manifest](qualification/2026-11-14-repairs/freshness/terminal-freshness-manifest.json)
records 165 passing targeted checks and the inclusive age-boundary control.
Its preparation-stage status predates publication of the revision above.

All four push workflows passed for that exact client revision: engine 371/439
(overlapping suites), native client **477**, baseline-wrapper SBF **17**, and
seven current-validator transactions. [Complete CI evidence](qualification/2026-11-14-repairs/freshness-native-ci/README.md).
The current client also passed **17/17** integration cases against the patched
SBF, with zero ignored or filtered tests and 102.17 seconds of test time.
[Candidate result and hashes](qualification/2026-11-14-repairs/freshness/freshness-candidate-native.json).
An initial isolated-worktree run lacked locked Node dependencies; that setup
failure and the successful run after `npm ci` are retained separately.

## Repair candidate: scope and evidence

The complete reviewable change is [`qualification/program-repair.patch`](../qualification/program-repair.patch). It applies to upstream wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13` and produces Git tree `8b54b827082b2b838beacd88d4d99bd12878d2ca`. Its SHA-256 is `031848cbccf8dd971ba3fc16b4c39db56093a24cbbc527aaf6e8182d71c061c6`. The Percolator engine stays at `a712af767eeb217876a3d3c50e3849b60ea54462`.

Only eight added lines change production program behavior: Recovery assets may use their frozen committed state after oracle-profile validation. The remaining changes repair test fixtures and the independent model. Existing Live and DrainOnly oracle checks, engine accounting, ABI and original maximum-shape compute limits remain in place.

| Done | Case | Cause and correction | Verified scope |
| --- | --- | --- | --- |
| [x] | CASE-01 through CASE-05 | Reward fixtures expected authenticated receipts while the effective price still carried trade-origin provenance. The positive cases now authenticate through a public crank; stale and paid-origin negative controls still require zero unauthorized rewards. | All five repaired tests plus four unchanged controls passed. [Results](qualification/2026-11-14-repairs/reward/reward-final-results.json). This is a fixture correction, not a new accounting implementation. |
| [x] | CASE-06 | Different oracle-observation histories accrue different funding. Compare their exact independently calculated funding and retain strict equality for identical observation histories with different account-settlement timing. | Four module tests passed on both original and patched SBF. One-atom negative controls, custody, fees, payouts and exact rollback remain. [Manifest](qualification/2026-11-14-repairs/funding/funding-final350-manifest.json). |
| [x] | CASE-07 | Fixture setup attempted health progress with a stale Live Hybrid leg. Establish valid setup and explicitly test stale rejection, rollback and successful current-slot authentication. | Complete INV-072 module: 11 passed. Live freshness was not relaxed. |
| [x] | CASE-08 | A later-slot Recovery refresh was incorrectly required to supply a current Live oracle report even though Recovery settles frozen committed state. Add a Recovery-only exemption after profile validation. | The identical delayed-Recovery test fails on the old SBF and passes on the patch. Stale, malformed, foreign-owner, wrong-feed and omitted Live evidence remain guarded; custody and finite progress are checked. |
| [x] | CASE-09 | The model incorrectly equated sums of rounded per-leg exposure with aggregate OI. Track exact signed rounding residue together with independent A/epoch history and canonical raw-position transitions. | Nine final checks passed against the original SBF, including default public-sequence fuzz. The combined-candidate run passed six host controls and the saved replay against the patched SBF; the separate public-sequence fuzz run was interrupted without a final result. No arbitrary tolerance. [Original-SBF manifest](qualification/2026-11-14-repairs/model/model-repair-manifest.json); [combined-candidate manifest](qualification/2026-11-14-repairs/model/model-combined-candidate-manifest.json). |
| [x] | PROV-01 | Build qualification could omit ignored or untracked source/configuration; the client identity test did not compare the repository URL. | Both SVM and validator runners reject ordinary and ignored `.cargo/config.toml` inputs while allowing matcher `target/` outputs. A wrong Cargo repository URL is rejected. [Negative controls](qualification/2026-11-14-repairs/provenance/ignored-source-results.json) and the PR #25 native checks above passed. |
| [x] | INT-01 | Verify the initial application snapshot's JavaScript instructions against the repaired program. | Historical candidate check: 17 SBF integration tests passed, zero failed/ignored/filtered, 54.83 seconds. [Log](qualification/2026-11-14-repairs/candidate-native-final.log). Later freshness and final integrated checks are recorded separately. |
| [x] | INT-02 | Execute the repaired candidate with the final integrated client on a current validator. | Exact source `f6fd6e0…`, tested merge `07e88e6d…`: seven successful confirmed RPC transactions, exact token/capital reconciliation, immutable test programs and before/after source/binary verification. [Final candidate-validator evidence](qualification/2026-11-14-repairs/candidate-validator-final-ci/README.md). This scoped local lifecycle does not close the complete wrapper gate. |
| [x] | CASE-10 | The first broad run exposed an INV048 source-contract assertion still expecting the old exact-sum diagnostic. Retain the 13 existing ownership entries, add the typed rounding-residue lifecycle witness and require all six behavioral controls. | Full INV048 changed from 2 passed / 1 failed to **3/3 passed**; the six unchanged arithmetic/mutation controls also passed. No model arithmetic or production source changed. [Final evidence](qualification/2026-11-14-repairs/source-contract/final/manifest.json); [original CI failure](qualification/2026-11-14-repairs/source-contract/before-ci-failure.log). |
| [x] | PROV-02 | The first gate omitted three default integration targets/library and did not bind exported native results to client bytes. | Expanded to 37 shards with Cargo target inventory, protocol content identity, canonical harness/driver checks and host-executable hashes. **49** combined verifier checks passed locally; final workflow execution remains QUAL-01. [Local checks](qualification/2026-11-14-repairs/qualification-followup/integrated-local-checks.json). |
| [ ] | QUAL-01 | Complete repaired-wrapper qualification across every configured default unit/integration target and native lifecycle. | [Final run 43526782149](https://github.com/TheTradoor/outright/actions/runs/43526782149) requires 37 complete shard reports and a passing exact-coverage aggregate. Its [final-result placeholder](qualification/2026-11-14-repairs/final-qualification-status.json) remains pending. The earlier 33-shard run exposed CASE-10 and is not a passing final gate. |
| [ ] | ADOPT-01 | Publish the candidate program revision and migrate the application's source pin. | Fork created at [TheTradoor/outright-program](https://github.com/TheTradoor/outright-program), but GitHub integration writes return `403: Resource not accessible by integration`. The patch is retained in the existing Outright repository. Runtime pin remains the previously verified upstream revision. |

The GitHub installation uses **selected repositories**. Its accessible repository
inventory includes `TheTradoor/outright` but not the newly created
`TheTradoor/outright-program`. The account owner can add that exact repository in
[the existing installation settings](https://github.com/settings/installations/156871870).
Repository creation and public read access do not grant the integration write access.

A separate target inventory review identified three default integration targets
and library tests outside the initial 33-shard manifest. Their unchanged tests
all passed against the original combined candidate: realloc **7/7**, listing
**8/8**, open-issue regressions **9/9**, library **8/8**. These **32 executions**
include six shared model controls in each integration target; the newly covered
target-local cases total six, plus eight library tests.
[Exact inventories and results](qualification/2026-11-14-repairs/supplemental/summary.json)
and [complete raw evidence](qualification/2026-11-14-repairs/supplemental/complete-evidence.tar.gz)
are retained. The three open-issue tests are ordinary regressions, not expected
failures; some use injected internal states and do not establish public attack
reachability. The expanded gate requires **37 shards** and checks the Cargo
target inventory so future default unit/integration targets cannot be silently
omitted. Rustdoc and feature-gated Kani proofs remain explicitly separate.

The combined candidate was also executed directly: all eight original CU failures plus the new delayed-Recovery regression passed **9/9** against the patched SBF and final combined source. [Exact results and hashes](qualification/2026-11-14-repairs/candidate-focused-results.json). This remains focused evidence.

### Interrupted local runs and complete-gate status

Two additional local runs did not emit a terminal result. They are recorded as
**interrupted/incomplete**, without inferring either a passing suite or an assertion
failure from the missing process session:

| Run | Completed evidence | Remaining uncertainty |
| --- | --- | --- |
| Full INV-077 module on the patched SBF | Nine of 77 cases completed successfully; no failed case was recorded. [Interruption status](qualification/2026-11-14-repairs/oracle/inv077-interrupted-status.json) and [partial log](qualification/2026-11-14-repairs/oracle/after-inv077-module-interrupted.log). | One case started without a result; 67 were not started. No complete-module pass, duration or exit code is claimed. The separately completed targeted Recovery tests, compute controls and INV-072 11/11 remain valid. |
| Combined-candidate model run | Six host math/mutation controls passed, and the retained scenario replay passed against the patched SBF. [Manifest and log hashes](qualification/2026-11-14-repairs/model/model-combined-candidate-manifest.json). | The unchanged default public-sequence fuzz run was interrupted after starting one test, without a completion result. Its passing original-SBF run is separate evidence. |

The initial 33-shard [run 43520468937](https://github.com/TheTradoor/outright/actions/runs/43520468937)
used source `9a5d13b…` and original candidate tree
`6621d5edd799f68ce0864f740ddc6da22e01c701`. CU14 completed 98 cases with
97 passes and the one CASE-10 source-contract failure. The frozen run is
**cancelled and superseded**, with **2,038 recorded passing executions, one
failure and four incomplete shards**; its aggregate job failed. The
[retained archive and index](qualification/2026-11-14-repairs/superseded-run-43520468937/README.md)
preserve all 34 original artifact ZIPs, 35 complete job logs and root metadata.
Completed cases remain scoped preliminary evidence, not a full passing gate.
The [initial build record](qualification/2026-11-14-repairs/ci-artifacts-43520468937.json)
identifies wrapper SBF `527b000d…` and all three matcher artifacts. The final
candidate adds only the test ownership correction to that source; the model,
production program and engine code are unchanged. The final 37-shard gate
requires its own matching source/artifact records and complete aggregate.

### Preliminary current-validator candidate evidence

[Candidate run 43523148675](https://github.com/TheTradoor/outright/actions/runs/43523148675)
passed for PR #26 source `0c44c9bd9363939ed4fe73501ccd93ec5d475dbc`, tested merge
`f056fb20b2928c446e0b67e806b8ad3996e79730` and tree
`900fb80a9462e36b207d83bf113a8ad5de61f57a`. The repaired program built with
platform-tools v1.58 / SBPF v3 and executed seven confirmed RPC transactions
on Agave 4.4.1. Collateral started and ended at 1,000,000,000 atoms; trader
capital ended at zero and maker capital remained 10,000,000,000 atoms.
The oversized deposit was rejected, deployed bytes were checked before and
after, and both test upgrade authorities were revoked. No deployment profile
was exported. [Full evidence](qualification/2026-11-14-repairs/candidate-validator-ci/README.md).

The current-validator wrapper SHA-256 is
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
This is distinct from the legacy v0 hash below. This historical record applies
to that exact preliminary source. The final integrated revision now has its own
passing [candidate-validator run](https://github.com/TheTradoor/outright/actions/runs/43526782070)
and [retained evidence](qualification/2026-11-14-repairs/candidate-validator-final-ci/README.md).
Its raw wrapper and matcher hashes match the preliminary artifacts; the final
test-ownership correction changed no production binary bytes.
It does not close physical-wallet, real-oracle, independent-review or mainnet
enrollment requirements.

### Compute evidence, including the changed test budget

CASE-06 exposed a previously unreached funded liquidation path. The transaction **succeeded** under the existing 1,400,000-CU runtime budget, then failed a 325,000-CU host-test performance assertion. Four measured funded paths consumed 325,971–326,193 CU. The repair gives only this funded report-cadence fixture a named 350,000-CU per-instruction measured guard (700,000 for its two-instruction rollback bundle). The global and zero-funding guard remain 325,000, and the runtime budget remains 1,400,000. This is an explicitly documented benchmark-budget correction, not a production performance improvement.

For the production Recovery correction, the strict all-Live maximum-shape refresh measured 949,929 → 949,971 CU. Its original 950,000-CU guard remains unchanged, leaving only 29 CU of margin. That small margin is retained as a release concern and must be rerun with every artifact/toolchain change. Delayed Recovery remains within the original 1,375,000-CU bound.

The original local wrapper SBF hash is `51b159ed4e9bb79903c9406029f3ea079089ab5564204a3ce51a88af8d8744c2`; the patched local SBF hash is `527b000d136ed3ed50dc5bc131d571a8388ebce57ce542ce2225dea693fca180`. Both use platform-tools v1.52 and SBPF v0 for the legacy LiteSVM harness. These are distinct from the current-validator v1.58 / v3 release artifacts. The candidate has not been deployed to mainnet.

## Original upstream failures and repair disposition

The pinned wrapper's
[commit report](https://github.com/aeyakovenko/percolator-prog/commit/357157e6e14d1d10ce78a995d5d50bb3c1f2ae13)
records eight failures in `v16_cu` and one in
`v16_program_stateful_fuzz`. All eight CU failures and the focused INV-086 stateful failure have now been
directly reproduced against the rebuilt baseline artifacts. **All nine have scoped repairs and passing targeted evidence**, as recorded below. The complete repaired-wrapper gate subsequently passed at source `9191c881…`; its [2,120-execution evidence](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md) is separate from the original failures. The eight original CU tests each exited with code 101 after an assertion
or program error, without a compute-resource exhaustion failure.

Upstream metadata lists ten counterexample identifiers. That is a different
inventory from nine failing tests: one finding can affect multiple tests, and
metadata can have a different scope. Do not map those ten identifiers onto
nine invented failure rows or mark findings fixed merely because a different
suite passes.

| Done | ID | Gate | Status | Reported baseline | Evidence needed to close |
| --- | --- | --- | --- | --- | --- |
| [x] | UP-CU | Full `v16_cu` target | Verified passing for source `9191c881…` | All 16 shards: 1,574 passed, exact coverage verified. The earlier local interruptions remain historical. | [Complete checked-host run](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md). |
| [x] | UP-STATE | Full `v16_program_stateful_fuzz` gate | Verified passing for source `9191c881…` | All 12 shards: 343 passed, zero failed. The bounded graph passed in 457.375 seconds without reducing its coverage or deadline. | [Complete checked-host run](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md); the [earlier timeout](qualification/2026-11-14-repairs/host-timeout-run-43526782149/README.md) remains retained. |
| [x] | UP-REG | Full `v16_program_fuzz_regressions` gate | Verified passing for source `9191c881…` | All four shards: **154 passed**, zero failed, exact coverage verified. | [Complete checked-host run](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md). The earlier 148-case source retains its separate [run log](qualification/2026-11-14/regressions.log). |
| [x] | UP-MAP | Reconcile the nine test failures with their causes | Completed for the nine observed tests | Seven fixture corrections, one independent-model correction and one production Recovery guard correction are distinguished above. Ten upstream counterexample IDs remain a separate inventory. | No claim is made that the nine tests discharge every upstream finding. |

### Confirmed failing-test inventory

The following table preserves the **original failing baseline**, not the status of the repair candidate. The focused baseline CU harness registers
211 cases; eight selected cases were run individually with the original
assertions retained and each failed with exit code 101. These are targeted
reproductions, not a run of all 211 cases or the full CU gate. The
[machine-readable CU record](qualification/2026-11-14/cu-results.json)
contains fully qualified test names, panic excerpts, source/artifact hashes,
and execution results. The log numbering follows that JSON's result order.
Source paths refer to the pinned wrapper repository.

| ID | Exact test function | Assertion/source | Observed failure and evidence |
| --- | --- | --- | --- |
| CASE-01 | `v16_program_exposed_auth_keeper_reward_commutes_with_settlement_through_hybrid_catchup` | `tests/invariants/cu/inv_045_exposed_keeper_provenance.rs:273` | Reward/settlement accounting differs: keeper capital 10,000,000 versus 10,001,995. [CU log 08](qualification/2026-11-14/cu-08.log). |
| CASE-02 | `v16_program_keeper_maintenance_preserves_distinct_reward_budgets_until_catchup` | `tests/invariants/cu/inv_045_reward_maintenance_catchup.rs:261` | Recipient fee-cursor/liability preservation assertion fails; keeper capital 1,000 versus 2,997. [CU log 03](qualification/2026-11-14/cu-03.log). |
| CASE-03 | `v16_program_reward_policy_succession_preserves_receipts_and_effective_price_catchup` | `tests/invariants/cu/inv_045_reward_policy_catchup.rs:244` | Reward/accounting tuple differs: keeper capital 1,000 versus 2,995. [CU log 04](qualification/2026-11-14/cu-04.log). |
| CASE-04 | `v16_program_hybrid_catchup_rewards_survive_resolved_cohort_redemption_order` | `tests/invariants/cu/inv_045_reward_terminal_redemption.rs:226` | Portfolio equality assertion fails; keeper capital 1,000 versus 2,995. [CU log 05](qualification/2026-11-14/cu-05.log). |
| CASE-05 | `v16_program_retained_stale_penalty_survives_fresh_liquidation_and_catchup` | `tests/invariants/cu/inv_045_retained_penalty_handoff.rs:468` | Reward/accounting tuple differs: keeper capital 1,000 versus 3,762. [CU log 02](qualification/2026-11-14/cu-02.log). |
| CASE-06 | `v16_program_funded_report_cadence_preserves_partial_liquidation_reward_and_custody` | `tests/invariants/cu/inv_045_report_cadence_rewards.rs:595` | Renewal/crank cadence changes liquidation economics; exact unequal tuples preserved. [CU log 01](qualification/2026-11-14/cu-01.log). |
| CASE-07 | `v16_program_auto_crank_refresh_not_blocked_by_unneeded_first_asset_oracle` | `tests/invariants/cu/inv_072_order_robust_crankability.rs:893`; panic in focused harness `:4766` | `Custom(22)` / `EngineNonProgress`; program used 44,995 of 1,399,700 CU. [CU log 06](qualification/2026-11-14/cu-06.log). |
| CASE-08 | `v16_attack_public_recovery_kf_progress_survives_stale_42_feed_tail_at_max_shape` | `tests/invariants/cu/inv_077_bounded_work_and_maximum_shape_compute.rs:5285`; panic in focused harness `:4841` | `Custom(22)` / `EngineNonProgress`; program used 107,866 of 1,399,700 CU. [CU log 07](qualification/2026-11-14/cu-07.log). |
| CASE-09 | `inv_086_reference_model_and_deployed_transition_equivalence::v16_program_reference_model_matches_deployed_public_sequence` | `tests/invariants/stateful/inv_086_reference_model_and_deployed_transition_equivalence.rs:2070` | Exposure divergence. Focused run: zero passed, one failed, 335 filtered; 139.91 seconds. [INV-086 log](qualification/2026-11-14/inv086.log). |

The error labels above are corrected against the pinned wrapper enum: code
22 is `EngineNonProgress`; `OracleStale` is code 27. The earlier report
misnamed code 22. The raw transaction logs are unchanged. These two cases fail
the same-slot authenticated-observation progress guard.

The original observed groups are five reward-policy/accounting failures, one
cadence-equivalence failure, two stale-oracle policy conflicts, and one
exposure-invariant failure. These groups describe the failing checks; they do
not establish that all failures have independent production causes. The
stale-oracle failures occur below their compute limits. Do not relax freshness
guards merely to satisfy the test expectations. The earlier candidate
`v16_program_reward_price_tracks_actual_catchup_across_report_and_crank_orders`
passed its complete 96-world control in 127.70 seconds and is not included
in the confirmed failure inventory; see the [control log](qualification/2026-11-14/authenticated-control.log).

CASE-09 reports: `action 11 RebalanceReduce { actor: 155, asset: 37 }: live
asset 1 has unclassified effective exposure imbalance [1, 0]`. Its observed
32-byte scenario seed is:

```text
[0,0,0,0,0,0,0,0,10,190,101,105,240,2,140,129,247,246,233,219,191,23,40,144,172,253,245,59,69,52,14,70]
```

The preserved [failure log](qualification/2026-11-14/inv086.log) and
[scenario JSON](qualification/2026-11-14/inv086-scenario.json) record this case.
The reference check compares sums of rounded per-leg exposure. The engine
specification separately requires aggregate long/short OI equality and explicitly
permits a side's rounded leg quantities to exceed its aggregate OI (`spec.md`,
effective-OI rules). The observed model failure alone therefore does not prove
a loss of funds or an aggregate-OI violation. Reconciliation must explain the
rounding residue and preserve the actual accounting invariants. Adding a
one-atom tolerance without proving that the exposure/accounting invariant is
preserved would hide the failure rather than repair it.

### Preserved baseline reproduction record

| Field | Preserved baseline observation |
| --- | --- |
| Wrapper revision | `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`; this original baseline did not include the candidate Recovery correction. |
| Engine revision | `a712af767eeb217876a3d3c50e3849b60ea54462`, using locked dependencies. |
| External matcher revision | `60aac3a996d0264c47fbefe9a2625d6ee6fb6a47` |
| Toolchain | Rust 1.95.0 host; cargo-build-sbf 4.6.0; explicitly selected platform-tools v1.52 and SBPF v0. |
| Program and matcher builds | Wrapper, authenticated matcher, hostile matcher and external matcher builds all completed. Build logs record warnings; successful build does not mean warning-free output. |
| Full CU compilation | Two attempts were killed by signal 9: ordinary debug build, then a single-job attempt with `-C debuginfo=0 -C codegen-units=256`. This is an environment/resource termination, not an observed assertion failure. |
| Focused CU harness | Compiled with unchanged original assertion sources; 211 registered cases, eight selected executions, eight observed failures with exit code 101. This is not full-suite qualification. |
| Focused stateful result | INV-086 failed as recorded above; subsequent model reconciliation is documented separately in CASE-09. |
| Full stateful result | Not completed in this evidence record; the focused failure is confirmed separately. |
| Full regression result | 148 passed, zero failed/ignored/filtered; 501.17 seconds, exit 0. |
| Corrective commit for current client fixes | `6966fbf55689e09a4ff928fec2805958095c13de`; local final native run passed 471 tests. |
| Corrective commit for upstream-wide failures | None was applied to this baseline. The later candidate is identified above by its upstream base, patch digest and resulting tree. |

Focused harness provenance: original harness SHA-256
`105a5bf1734ac36ac68fab23f0a429c4f192c9e9ea97567b75d0708378ef5f1a`;
focused harness SHA-256
`efdc138f84e61a6b4cd956b3beb00aba7f8bc3d8e79d3d60ca58e8df192b2f37`.
The CU record preserves the compilation command and confirms the original
assertion sources were unchanged.

Built artifact SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| `percolator_prog.so` | `51b159ed4e9bb79903c9406029f3ea079089ab5564204a3ce51a88af8d8744c2` |
| `auth_matcher.so` | `50e532267926e180f013200c1799e26127dd23dc150866cffd491424629ddf93` |
| `hostile_matcher.so` | `e0c20fad34a7822cc6ce42a3c77ff08a8591977102f0c497a339d66a9dd6240a` |
| `percolator_match.so` | `15ca5d638e7911157ef075b60170c06d82ef2208f6565002cf6620315e6dc3ea` |

Current local evidence files: `pr22-native-final.log`,
`qualification-build.log`, `qualification-auth-build.log`,
`qualification-hostile-build.log`, `qualification-match-build.log`,
`qualification-host-compile.log`, `qualification-host-small.log`,
`qualification-stateful-focused.log`, `qualification-stateful.log` and
`qualification-regressions.log`. A published repair report should preserve
the relevant complete logs or equivalent immutable CI evidence alongside the
final commit identity.

A row becomes **Reproduced / open** when the fresh run demonstrates the
failure. It becomes **Fixed and verified** only after the cause is corrected
and the relevant checks pass. Removing a failing assertion, adding an ignore,
or weakening an invariant does not count as repairing the underlying behavior.

## Remaining release and acceptance work

| Done | ID | Requirement | Status | Completion evidence |
| --- | --- | --- | --- | --- |
| [x] | QUAL-01 | Full candidate-wrapper qualification after repairs | Verified passing at source `9191c881…` | [Complete evidence](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md): 37 passing reports, 2,120 passing executions, exact registered/executed coverage, matching source/artifact identities and a passing aggregate independently reproduced. Future source or client changes require affected requalification; runtime-pin adoption and release acceptance remain separate. |
| [ ] | QUAL-02 | Broader risk scenarios | Unverified | Live Hybrid funding, mark-movement/backing fees, broader insolvency stress, payout-halt repair and additional teardown configurations exercised with exact accounting and rollback checks. |
| [ ] | WAL-02 | Real desktop wallet acceptance | Unverified | Supported wallet/version/browser through connect, approve/reject, account/network changes, signing, interruption and receipt recovery. Follow the [real-wallet acceptance runbook](WALLET_ACCEPTANCE.md); its cases are not yet executed. |
| [ ] | WAL-03 | Physical iPhone/mobile wallet acceptance | Unverified | Actual supported mobile wallet browser, responsive layout and complete transaction/recovery path. The [runbook](WALLET_ACCEPTANCE.md) requires separate physical-phone evidence; DOM fixtures cannot close this row. |
| [ ] | OPS-01 | Live oracle integration | Unverified | Correct feed identity, authenticated observations, freshness/confidence rejection, interruption and resumed operation with the production configuration. |
| [ ] | OPS-02 | Hosted keeper and indexing recovery | Unverified | Restart/outage exercises, bounded progress, fee budgets, RPC failure handling, monitoring and preservation of unresolved receipts. |
| [ ] | PROD-01 | Independent security review | External prerequisite | Independent review of the exact engine, wrapper, matcher, oracle integration, client and operations; verified disposition of findings. |
| [ ] | PROD-02 | Mainnet deployment and authority custody | External prerequisite | Verified build/program bytes, program/market addresses, disclosed upgrade/admin policy and operator-controlled signing arrangement. Disposable local keys are excluded. |
| [ ] | PROD-03 | Funded execution and backing | External prerequisite | Committed real collateral, maker authorization, executable liquidity, inventory/capital limits and insurance policy. The 10,000 TEST fixture is not production liquidity. |
| [ ] | PROD-04 | Reviewed market risk parameters | External prerequisite | Approved collateral/feed identity, margins, leverage, OI and position limits, fees/funding and exit delays supported by stress results. |
| [ ] | PROD-05 | Operational ownership and incident response | External prerequisite | Responsible operators, alerts, authority rotation, provider/RPC failure procedures and tested permissionless user exit instructions. |
| [ ] | PROD-06 | Mainnet client support and final release enrollment | Not implemented / not enabled | Implement approved mainnet enrollment with verified genesis, source pins, program bytes, profile, addresses and policy; complete wallet-chain filtering/signing and explorer handling with fresh negative and acceptance tests. Enroll the approved oracle, keeper and services together, then satisfy the [acceptance completion requirements](WALLET_ACCEPTANCE.md#completion-record) before public deposits. Fork access alone does not complete this work. |

The current [profile validator](../protocol/src/client.mjs) deliberately permits
only `localnet` and `devnet`. The [terminal](../protocol/terminal/terminal.mjs)
requires `solana:devnet` in wallet account chains outside localnet and only sets
the signing-chain field for devnet. Mainnet support therefore requires reviewed
client changes and fresh verification; publishing a fork or changing a profile
cannot enable a complete mainnet flow.

The normal trader interface must continue to load the official market
automatically and explain unavailable state. None of the open operator or
release tasks should be delegated to traders through a deployment-file upload.

## How this checklist is maintained

1. Preserve the original failure and its exact source/artifact identity.
2. Record whether the cause is application code, wrapper/engine behavior,
   a test fixture, an environment failure or an external dependency.
3. Add or retain a regression that detects the actual defect.
4. Run the affected checks, then the required broader gates for changed
   accounting, custody, authorization or transaction behavior.
5. Link the corrective commit and final results; update status only after the
   result is observed. Keep untested configurations explicitly open.

Detailed historical results remain in [Native verification](NATIVE_VERIFICATION.md).
Production criteria remain in [Mainnet release requirements](MAINNET_RELEASE.md).
