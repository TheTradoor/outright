# Repair and verification checklist

Updated: **14 November 2026 (Asia/Jakarta, UTC+7)**.

This checklist separates a completed correction from a passing test, an
upstream report, and work that has not been verified. Mainnet deposits remain
disabled. A green row applies only to its stated source revision and evidence;
it is not a promise that the application has no other bugs.

## Status definitions

| Status | Meaning | Required evidence |
| --- | --- | --- |
| **Fixed and verified** | The correction is present and the relevant checks passed. | Source change, affected behavior and an identifiable passing run. |
| **Reproduced / open** | A failure has been observed against the recorded artifacts and is not yet resolved. | Exact failing test or transaction, assertion/error, source and artifact identity. |
| **Unverified** | The behavior is reported or required, but the necessary direct check is incomplete. | Keep open until the reproduction or acceptance evidence exists. |
| **External prerequisite** | Completion requires production resources or an independent party in addition to code. | Named operator/resource/reviewer and evidence for the exact release. |

Checked boxes mean the scoped row is complete. They do not imply completion of
other rows or permission to accept public funds.

## Recorded source baseline

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

The following corrections are present in the current working tree, after the
PR #21 baseline. They have passed local regression checks; a corrective commit
and its CI identity must be recorded before treating this table as a published
release record. The earlier 452-test baseline remains historical evidence.

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
wallet or mainnet acceptance count. The preserved [before-fix failures](qualification/2026-11-14/wallet-before.log) and [after-fix passing run](qualification/2026-11-14/wallet-after.log) provide the adapter regression comparison. Current-change CI remains pending.

## Upstream-wide failures: current investigation

The pinned wrapper's
[commit report](https://github.com/aeyakovenko/percolator-prog/commit/357157e6e14d1d10ce78a995d5d50bb3c1f2ae13)
records eight failures in `v16_cu` and one in
`v16_program_stateful_fuzz`. All eight CU failures and the focused INV-086 stateful failure have now been
directly reproduced against the rebuilt artifacts: **nine confirmed failures
remain open**. The eight CU tests each exited with code 101 after an assertion
or program error, without a compute-resource exhaustion failure. Full-suite
qualification remains incomplete.

Upstream metadata lists ten counterexample identifiers. That is a different
inventory from nine failing tests: one finding can affect multiple tests, and
metadata can have a different scope. Do not map those ten identifiers onto
nine invented failure rows or mark findings fixed merely because a different
suite passes.

| Done | ID | Gate | Status | Reported baseline | Evidence needed to close |
| --- | --- | --- | --- | --- | --- |
| [ ] | UP-CU | Full `v16_cu` gate | Reproduced / open; full target environment blocked | All eight CU failures reproduced in the focused harness. Current full-target compilation was killed twice by SIGKILL before assertions ran. | Repair the observed failures and run the complete target in a suitable environment. Focused execution cannot be presented as a full-gate pass. |
| [ ] | UP-STATE | Full `v16_program_stateful_fuzz` gate | Reproduced / open | The focused INV-086 case failed with an effective-exposure imbalance. The full 336-test run is still in progress. | Explain and repair the divergence, retain the exact scenario, and rerun focused and full gates. |
| [ ] | UP-REG | Full `v16_program_fuzz_regressions` gate | Unverified — running | The current run started 148 tests; no final outcome is recorded here yet. | Capture the complete result and investigate any failure; partial progress is not a pass. |
| [ ] | UP-MAP | Reconcile test failures with invariant metadata | Exact failure inventory mapped; causes unresolved | Eight exact CU failures and one stateful failure are confirmed below; ten counterexample IDs remain a separate inventory. | Complete the cause-level mapping and distinguish policy conflicts, harness faults and production defects. |

### Confirmed failing-test inventory

All nine rows below are **Reproduced / open**. The focused CU harness registers
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
| CASE-07 | `v16_program_auto_crank_refresh_not_blocked_by_unneeded_first_asset_oracle` | `tests/invariants/cu/inv_072_order_robust_crankability.rs:893`; panic in focused harness `:4766` | `Custom(22)` / `OracleStale`; program used 44,995 of 1,399,700 CU. [CU log 06](qualification/2026-11-14/cu-06.log). |
| CASE-08 | `v16_attack_public_recovery_kf_progress_survives_stale_42_feed_tail_at_max_shape` | `tests/invariants/cu/inv_077_bounded_work_and_maximum_shape_compute.rs:5285`; panic in focused harness `:4841` | `Custom(22)` / `OracleStale`; program used 107,866 of 1,399,700 CU. [CU log 07](qualification/2026-11-14/cu-07.log). |
| CASE-09 | `inv_086_reference_model_and_deployed_transition_equivalence::v16_program_reference_model_matches_deployed_public_sequence` | `tests/invariants/stateful/inv_086_reference_model_and_deployed_transition_equivalence.rs:2070` | Exposure divergence. Focused run: zero passed, one failed, 335 filtered; 139.91 seconds. [INV-086 log](qualification/2026-11-14/inv086.log). |

The observed groups are five reward-policy/accounting failures, one
cadence-equivalence failure, two stale-oracle policy conflicts, and one
exposure-invariant failure. These groups describe the failing checks; they do
not establish that all failures have independent production causes. The
stale-oracle failures occur below their compute limits. Do not relax freshness
guards merely to satisfy the test expectations. The earlier candidate
`v16_program_reward_price_tracks_actual_catchup_across_report_and_crank_orders`
is not included in the confirmed failure inventory.

CASE-09 reports: `action 11 RebalanceReduce { actor: 155, asset: 37 }: live
asset 1 has unclassified effective exposure imbalance [1, 0]`. Its observed
32-byte scenario seed is:

```text
[0,0,0,0,0,0,0,0,10,190,101,105,240,2,140,129,247,246,233,219,191,23,40,144,172,253,245,59,69,52,14,70]
```

The preserved [failure log](qualification/2026-11-14/inv086.log) and
[scenario JSON](qualification/2026-11-14/inv086-scenario.json) record this case.
Rounding is a candidate explanation, not an established resolution. Adding a
one-atom tolerance without proving that the exposure/accounting invariant is
preserved would hide the failure rather than repair it.

### Current reproduction record

| Field | Current run |
| --- | --- |
| Wrapper revision | `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`; no production wrapper fix is claimed in this checklist. |
| Engine revision | `a712af767eeb217876a3d3c50e3849b60ea54462`, using locked dependencies. |
| External matcher revision | `60aac3a996d0264c47fbefe9a2625d6ee6fb6a47` |
| Toolchain | Rust 1.95.0 host; cargo-build-sbf 4.6.0; explicitly selected platform-tools v1.52 and SBPF v0. |
| Program and matcher builds | Wrapper, authenticated matcher, hostile matcher and external matcher builds all completed. Build logs record warnings; successful build does not mean warning-free output. |
| Full CU compilation | Two attempts were killed by signal 9: ordinary debug build, then a single-job attempt with `-C debuginfo=0 -C codegen-units=256`. This is an environment/resource termination, not an observed assertion failure. |
| Focused CU harness | Compiled with unchanged original assertion sources; 211 registered cases, eight selected executions, eight observed failures with exit code 101. This is not full-suite qualification. |
| Focused stateful result | INV-086 failed as recorded above; cause unresolved. |
| Full stateful and regression results | Both still running when this record was updated; final counts pending. |
| Corrective commit for current client fixes | Pending publication; local final native run passed 471 tests. |
| Corrective commit for upstream-wide failures | None claimed. |

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
| [ ] | QUAL-01 | Full current-wrapper qualification after repairs | Unverified | Exact source/artifact report, all failing cases addressed, applicable complete suites rerun, no unresolved production-impacting findings. |
| [ ] | QUAL-02 | Broader risk scenarios | Unverified | Live Hybrid funding, mark-movement/backing fees, broader insolvency stress, payout-halt repair and additional teardown configurations exercised with exact accounting and rollback checks. |
| [ ] | WAL-02 | Real desktop wallet acceptance | Unverified | Supported wallet/version/browser through connect, approve/reject, account/network changes, signing, interruption and receipt recovery. |
| [ ] | WAL-03 | Physical iPhone/mobile wallet acceptance | Unverified | Actual supported mobile wallet browser, responsive layout and complete transaction/recovery path; DOM fixtures cannot close this row. |
| [ ] | OPS-01 | Live oracle integration | Unverified | Correct feed identity, authenticated observations, freshness/confidence rejection, interruption and resumed operation with the production configuration. |
| [ ] | OPS-02 | Hosted keeper and indexing recovery | Unverified | Restart/outage exercises, bounded progress, fee budgets, RPC failure handling, monitoring and preservation of unresolved receipts. |
| [ ] | PROD-01 | Independent security review | External prerequisite | Independent review of the exact engine, wrapper, matcher, oracle integration, client and operations; verified disposition of findings. |
| [ ] | PROD-02 | Mainnet deployment and authority custody | External prerequisite | Verified build/program bytes, program/market addresses, disclosed upgrade/admin policy and operator-controlled signing arrangement. Disposable local keys are excluded. |
| [ ] | PROD-03 | Funded execution and backing | External prerequisite | Committed real collateral, maker authorization, executable liquidity, inventory/capital limits and insurance policy. The 10,000 TEST fixture is not production liquidity. |
| [ ] | PROD-04 | Reviewed market risk parameters | External prerequisite | Approved collateral/feed identity, margins, leverage, OI and position limits, fees/funding and exit delays supported by stress results. |
| [ ] | PROD-05 | Operational ownership and incident response | External prerequisite | Responsible operators, alerts, authority rotation, provider/RPC failure procedures and tested permissionless user exit instructions. |
| [ ] | PROD-06 | Final release enrollment | Unverified | Exact approved source, binaries, policy, addresses and services enrolled together; end-to-end acceptance completed before public deposits. |

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
