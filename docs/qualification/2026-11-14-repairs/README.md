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
| [Initial candidate application integration](candidate-native-final.log) | Historical initial snapshot: 17 tests passed against the patched SBF and its JavaScript driver; zero failed/ignored/filtered |
| [Earlier client verification](current-client-provenance-check.log) | Historical snapshot: source identity, Rust conformance and 471 tests passed; runtime wrapper pin unchanged |
| [Build](current-client-provenance-build.log) | Terminal bundle build completed |
| [Provenance checks](provenance/results.json) and [ignored-input controls](provenance/ignored-source-results.json) | Repository-URL mismatch plus ordinary and ignored build-configuration rejection; legitimate matcher build outputs permitted by both runners |
| [Earlier PR #25 native CI](pr25-native-ci/README.md) | Historical source `9a5d13b…`: PR and push workflows succeeded; engine 371/439, native client 471, baseline-wrapper application SBF 17, and seven current-validator RPC lifecycle transactions |
| [Initial CI build identity](ci-artifacts-43520468937.json) | Original candidate program and all matcher SBF hashes match local builds; exact original source and runner are recorded |
| [Frozen superseded run](superseded-run-43520468937/README.md) | Run `43520468937` was cancelled: 2,038 recorded passing executions, one INV048 failure and four incomplete shards; aggregate failed. Deterministic archive retains 34 original artifact ZIPs, 35 complete job logs and all root metadata; not a full pass |
| [Trader freshness correction](freshness/terminal-freshness-manifest.json) | Three before-fix UI failures; 165 passing targeted checks after the shared freshness guard; preparation-stage manifest predates publication |
| [Freshness CI](freshness-native-ci/README.md) | Source `3372660…`: engine 371/439, client 477, baseline SBF 17 and seven validator transactions all passed |
| [Freshness client against candidate](freshness/freshness-candidate-native.json) | 17/17 passed against candidate SBF527b; initial missing-dependency setup failure retained separately |
| [Supplemental default targets](supplemental/summary.json) | Realloc7, listing8, open-issue9 and library8 passed; shared controls overlap. [Complete evidence archive](supplemental/complete-evidence.tar.gz) |
| [Preliminary candidate current validator](candidate-validator-ci/README.md) | Historical PR26 source passed seven confirmed RPC transactions on SBPF v3 / Agave4.4.1; ZIP contains complete raw validator log |
| [Qualification verifier checks](qualification-followup/integrated-local-checks.json) | 49 combined negative/positive checks passed locally; protocol bytes match the tested freshness revision |
| [Original CU14 source-contract failure](source-contract/before-ci-failure.log) and [final repair](source-contract/final/manifest.json) | Initial broad gate exposed one obsolete exact-sum source assertion; final INV048 3/3 and six behavioral controls pass without changing model arithmetic |
| [Final native CI](final-native-ci/README.md) | Source `f6fd6e0…`, tested merge `07e88e6d…`: engine 371/439 (overlapping), client 477, baseline SBF 17, and seven baseline-validator RPC transactions passed; all four push duplicates passed |
| [Final candidate current validator](candidate-validator-final-ci/README.md) | Same final source and merge: seven confirmed RPC transactions passed in 25.765 seconds on SBPF v3 / Agave 4.4.1; exact source, protocol, deployed bytes and balances verified; complete validator log retained in the verified ZIP |
| [Site v28 deployment and shipping](site-v28.json) | Source `aee5ba3…` deployed successfully; 17 routes, 750 links/assets, four mechanics tests and 477 client tests passed; all 61 protocol files match `f6fd6e0…`; 55-entry archive verified; profile remains `null`; fresh browser and physical-wallet acceptance incomplete |
| [Complete wrapper attempt](host-timeout-run-43526782149/README.md) | Run `43526782149`: all 37 reports and exact coverage verified; 2,119 passes, one host timeout, aggregate failed; complete archive retained |
| [Fresh browser onboarding](browser-2026-11-14.json) | Unchanged version-28 desktop client: terminal, retry, unavailable state and explicit operator separation passed; no physical-wallet or mainnet acceptance |
| [Current qualification status](final-qualification-status.json) | Checked host optimization at `9191c881…` is under verification in run `43563227621`; all original test coverage, assertions, SBF bytes and time limits retained |

Manifest paths preserve the original local run locations. The corresponding logs and individual patches are retained beside each manifest under their basenames. Hashes identify the exact files and binaries; absolute scratch paths are not deployment locations.

## Complete-gate status

The initial 33-shard [qualification run](https://github.com/TheTradoor/outright/actions/runs/43520468937)
covers the three large wrapper targets and native integration. CU14 reported one
source-contract failure after the model correction removed its old exact-sum
diagnostic. It is now frozen as **cancelled and superseded**, recording 2,038
passing executions, one failure and four incomplete shards; its aggregate job
failed. The [retention index and deterministic archive](superseded-run-43520468937/README.md)
preserve every original artifact ZIP and root job log with verified hashes.
Completed cases retain their scoped results; this is not a full passing gate.
The scoped ownership correction now passes, and the final integrated gate must
still complete. The initial runner did not record its host executable hash, so
no retrospective binary hash is invented.

The final [gate, run 43526782149](https://github.com/TheTradoor/outright/actions/runs/43526782149),
expands coverage to 37 shards and checks the actual Cargo default
target inventory, complete protocol bytes, canonical harness/driver identities,
and host executable digests. It targets source `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c`,
tree `e63c1049c06b0f1ca3a62dde3ec65a6e1c85efff`, through tested merge
`07e88e6d6cf5c0af5c1b736bd0976aa6e9c91de3`. Its
[complete retained attempt](host-timeout-run-43526782149/README.md) records all 37
shards: 2,119 passes and one 1,800-second host reference-graph timeout. Exact
coverage and identities were independently verified, and the original verifier
correctly rejected the aggregate. Checked host optimization is under verification
at source `9191c8819ad683a7d8ffa49f831df5d90b99adb1` in run `43563227621`; it does
not alter the wrapper candidate or graph coverage. Final native and candidate-validator
checks at the earlier source remain valid within their recorded scope.

The [INV-077 interruption record](oracle/inv077-interrupted-status.json) accounts
for nine completed cases, one started case without a result and 67 not started.
Its [partial log](oracle/after-inv077-module-interrupted.log) has no terminal
summary. The combined-candidate model's
[public-sequence log](model/model-combined-candidate-public-sequence.log) likewise
has no completion result. Missing process sessions establish incomplete evidence,
not a test pass or assertion failure. Separately completed tests retain their
stated scope; these partial runs are not restarted or counted as full passes.

The patched local wrapper SBF is `527b000d136ed3ed50dc5bc131d571a8388ebce57ce542ce2225dea693fca180`, built with cargo-build-sbf 4.6.0, platform-tools v1.52 and SBPF v0. The [final current-validator evidence](candidate-validator-final-ci/README.md) independently records the v1.58/v3 wrapper and matcher hashes, before/after source and deployed-byte verification, seven successful RPC transactions and exact balance reconciliation. Production enrollment remains separate. There has been no mainnet transaction or change to the hosted deployment profile.

The GitHub fork exists, but its connected-app write permission is unavailable. This evidence therefore identifies the candidate as **upstream base + reviewed patch + resulting Git tree**, not an invented public fork commit. Publishing the fork commit and migrating runtime source pins remain explicit adoption steps.

The [checksum inventory](sha256.json) covers every retained file in this directory
except the inventory itself, including nested inventories. The preliminary
candidate inventory also preserves the historical `artifact/validator.log` hash
for that member inside its ZIP; its README checksum was refreshed to match the
explanatory documentation. Raw logs are preserved byte for byte, including
original whitespace. The original baseline evidence in `../2026-11-14/` remains
unchanged.
