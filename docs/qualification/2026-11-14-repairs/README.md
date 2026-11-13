# Repair evidence, 14 November 2026

This record follows the [original nine reproduced failures](../2026-11-14/README.md). The [current checklist](../../REPAIR_CHECKLIST.md) distinguishes test corrections, the Recovery program correction, full-suite qualification and release prerequisites.

The complete candidate is [`qualification/program-repair.patch`](../../../qualification/program-repair.patch), applied to wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`. The final indexed Git tree is `8b54b827082b2b838beacd88d4d99bd12878d2ca`; patch SHA-256 is `031848cbccf8dd971ba3fc16b4c39db56093a24cbbc527aaf6e8182d71c061c6`. Earlier records retain original candidate tree `6621d5…`; the final candidate adds only the INV048 ownership-test correction. Engine `a712af767eeb217876a3d3c50e3849b60ea54462` and its accounting implementation are unchanged. The [qualification workflow](../../WRAPPER_QUALIFICATION.md) verifies the base, patch digest, indexed tree, generated test harnesses and exact executed-test coverage.

| Evidence | Scope |
| --- | --- |
| [Reward results](reward/reward-final-results.json) | Five corrected positive fixtures and four unchanged authorization/paid-origin controls; original SBF |
| [Funding manifest](funding/funding-final350-manifest.json) | Original failure, semantic correction, newly exposed measured-CU guard, expanded diagnostic, final four-test runs on both SBFs |
| [Model manifest](model/model-repair-manifest.json) | Nine checks against the original SBF: six exact math/mutation checks, saved failure through both exit campaigns, rebalance exit and original default public-sequence fuzz |
| [Combined-candidate model manifest](model/model-combined-candidate-manifest.json) | Six host controls passed and saved public replay passed against the patched SBF; the separate default public-sequence fuzz run was interrupted without a completion result |
| [Oracle manifest](oracle/manifest.json) | Original failures, identical delayed-Recovery before/after comparison, Live rejection controls and compute comparisons; the full 77-case local INV-077 module was interrupted after nine completed cases |
| [Combined candidate focused tests](candidate-focused-results.json) | Eight original CU failures plus the new delayed-Recovery regression; 9/9 passed against final combined source and patched SBF |
| [Candidate application integration](candidate-native-final.log) | 17 tests passed against the patched SBF and current JavaScript driver; zero failed/ignored/filtered |
| [Current client verification](current-client-provenance-check.log) | Source identity, Rust conformance and 471 tests passed; runtime wrapper pin unchanged |
| [Build](current-client-provenance-build.log) | Terminal bundle build completed |
| [Provenance checks](provenance/results.json) and [ignored-input controls](provenance/ignored-source-results.json) | Repository-URL mismatch plus ordinary and ignored build-configuration rejection; legitimate matcher build outputs permitted by both runners |
| [PR #25 native CI](pr25-native-ci/README.md) | Exact-head PR and push workflows succeeded: engine 371/439, native client 471, baseline-wrapper application SBF 17, and seven current-validator RPC lifecycle transactions |
| [Initial CI build identity](ci-artifacts-43520468937.json) | Original candidate program and all matcher SBF hashes match local builds; exact original source and runner are recorded |
| [Trader freshness correction](freshness/terminal-freshness-manifest.json) | Three before-fix UI failures; 165 passing targeted checks after the shared freshness guard; preparation-stage manifest predates publication |
| [Freshness CI](freshness-native-ci/README.md) | Source `3372660…`: engine 371/439, client 477, baseline SBF 17 and seven validator transactions all passed |
| [Freshness client against candidate](freshness/freshness-candidate-native.json) | 17/17 passed against candidate SBF527b; initial missing-dependency setup failure retained separately |
| [Supplemental default targets](supplemental/summary.json) | Realloc7, listing8, open-issue9 and library8 passed; shared controls overlap. [Complete evidence archive](supplemental/complete-evidence.tar.gz) |
| [Candidate current validator](candidate-validator-ci/README.md) | Exact PR26 source passed seven confirmed RPC transactions on SBPF v3 / Agave4.4.1; ZIP contains complete raw validator log |
| [Qualification verifier checks](qualification-followup/integrated-local-checks.json) | 49 combined negative/positive checks passed locally; protocol bytes match the tested freshness revision |
| [Original CU14 source-contract failure](source-contract/before-ci-failure.log) and [final repair](source-contract/final/manifest.json) | Initial broad gate exposed one obsolete exact-sum source assertion; final INV048 3/3 and six behavioral controls pass without changing model arithmetic |

Manifest paths preserve the original local run locations. The corresponding logs and individual patches are retained beside each manifest under their basenames. Hashes identify the exact files and binaries; absolute scratch paths are not deployment locations.

## Complete-gate status

The initial 33-shard [qualification run](https://github.com/TheTradoor/outright/actions/runs/43520468937)
covers the three large wrapper targets and native integration. CU14 reported one
source-contract failure after the model correction removed its old exact-sum
diagnostic. Other completed shards retain their recorded results; this run is
not claimed as a complete passing gate. The scoped ownership correction now passes, and the final integrated gate must still complete. Its host executable hash was not recorded
by that runner, so no retrospective binary hash is invented.

The final gate expands coverage to 37 shards and checks the actual Cargo default
target inventory, complete protocol bytes, canonical harness/driver identities,
and host executable digests. Its [current PR checks](https://github.com/TheTradoor/outright/pull/25/checks)
are the release-candidate gate. Preliminary CI and local checks do not establish
that the final combined revision passed those checks.

The [INV-077 interruption record](oracle/inv077-interrupted-status.json) accounts
for nine completed cases, one started case without a result and 67 not started.
Its [partial log](oracle/after-inv077-module-interrupted.log) has no terminal
summary. The combined-candidate model's
[public-sequence log](model/model-combined-candidate-public-sequence.log) likewise
has no completion result. Missing process sessions establish incomplete evidence,
not a test pass or assertion failure. Separately completed tests retain their
stated scope; these partial runs are not restarted or counted as full passes.

The patched local wrapper SBF is `527b000d136ed3ed50dc5bc131d571a8388ebce57ce542ce2225dea693fca180`, built with cargo-build-sbf 4.6.0, platform-tools v1.52 and SBPF v0. Current-validator v1.58/v3 evidence for the preliminary candidate is recorded above; final combined-source CI and production enrollment remain separate. There has been no mainnet transaction or change to the hosted deployment profile.

The GitHub fork exists, but its connected-app write permission is unavailable. This evidence therefore identifies the candidate as **upstream base + reviewed patch + resulting Git tree**, not an invented public fork commit. Publishing the fork commit and migrating runtime source pins remain explicit adoption steps.

The [checksum inventory](sha256.json) covers every retained file in this directory
except the inventory itself. Raw logs are preserved byte for byte, including
original whitespace. The original baseline evidence in `../2026-11-14/` remains
unchanged.
