# Repair evidence, 14 November 2026

This record follows the [original nine reproduced failures](../2026-11-14/README.md). The [current checklist](../../REPAIR_CHECKLIST.md) distinguishes test corrections, the Recovery program correction, full-suite qualification and release prerequisites.

The complete candidate is [`qualification/program-repair.patch`](../../../qualification/program-repair.patch), applied to wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`. The resulting indexed Git tree is `6621d5edd799f68ce0864f740ddc6da22e01c701`. Engine `a712af767eeb217876a3d3c50e3849b60ea54462` and its accounting implementation are unchanged. The [qualification workflow](../../WRAPPER_QUALIFICATION.md) verifies the base, patch digest, indexed tree, generated test harnesses and exact executed-test coverage.

| Evidence | Scope |
| --- | --- |
| [Reward results](reward/reward-final-results.json) | Five corrected positive fixtures and four unchanged authorization/paid-origin controls; original SBF |
| [Funding manifest](funding/funding-final350-manifest.json) | Original failure, semantic correction, newly exposed measured-CU guard, expanded diagnostic, final four-test runs on both SBFs |
| [Model manifest](model/model-repair-manifest.json) | Six exact math/mutation checks, saved failure through both exit campaigns, rebalance exit and original default public-sequence fuzz |
| [Oracle manifest](oracle/manifest.json) | Original failures, identical delayed-Recovery before/after comparison, Live rejection controls, compute comparisons and module-run status |
| [Combined candidate focused tests](candidate-focused-results.json) | Eight original CU failures plus the new delayed-Recovery regression; 9/9 passed against final combined source and patched SBF |
| [Candidate application integration](candidate-native-final.log) | 17 tests passed against the patched SBF and current JavaScript driver; zero failed/ignored/filtered |
| [Current client verification](current-client-provenance-check.log) | Source identity, Rust conformance and 471 tests passed; runtime wrapper pin unchanged |
| [Build](current-client-provenance-build.log) | Terminal bundle build completed |
| [Provenance checks](provenance/results.json) | Repository-URL mismatch and untracked-build-configuration negative controls |

Manifest paths preserve the original local run locations. The corresponding logs and individual patches are retained beside each manifest under their basenames. Hashes identify the exact files and binaries; absolute scratch paths are not deployment locations.

The patched local wrapper SBF is `527b000d136ed3ed50dc5bc131d571a8388ebce57ce542ce2225dea693fca180`, built with cargo-build-sbf 4.6.0, platform-tools v1.52 and SBPF v0. Current-validator v1.58/v3 and a production deployment require separate evidence. There has been no mainnet transaction or change to the hosted deployment profile.

The GitHub fork exists, but its connected-app write permission is unavailable. This evidence therefore identifies the candidate as **upstream base + reviewed patch + resulting Git tree**, not an invented public fork commit. Publishing the fork commit and migrating runtime source pins remain explicit adoption steps.
