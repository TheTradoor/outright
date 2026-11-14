# PR 25 native CI evidence

Source head: `9a5d13b27ab77a1a927e0f41d15bc6f6da6606d1`.
Base: `c3e9246664e1dd2d21519681ff336a4539f52c4e`.
All five PR jobs checked out GitHub's merge commit `1a3f222b7452242481b9633e1fc1c4c8fd00abbf`.

| Gate | Run | Job | Observed result |
|---|---|---|---|
| Engine default | 43520469023 | 132213134856 | 371 passed; 0 failed, ignored or filtered |
| Engine fuzz | 43520469023 | 132213134483 | 439 passed; 0 failed, ignored or filtered |
| Native protocol | 43520468868 | 132213133849 | 471 passed; 0 failed, skipped or cancelled; Rust exporter comparison and terminal build succeeded |
| Native SVM | 43520468869 | 132213133348 | 17 passed; 0 failed, ignored or filtered; 36.41 seconds |
| Native validator | 43520468858 | 132213133291 | Seven client lifecycle transactions; fixed-price local market |

The validator report records initialize, deposit, long open/close, short open/close and withdrawal. Trader collateral is `1000000000` atoms both before and after. Final trader portfolio capital is `0`; maker capital is `10000000000`. Transaction signatures and local network identities are in `validator-report.json`.

These runs use unchanged engine `a712af767eeb217876a3d3c50e3849b60ea54462` and wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`. They do **not** qualify the candidate wrapper patch. Default and fuzz test counts overlap and must not be summed into a unique test count.

All four duplicate push workflows also succeeded; their run IDs are in `run-metadata.json`.

Full logs were fetched through the GitHub connector. GitHub-masked authentication fields remain masked. No signer secret or seed phrase was present in the inspected logs. Raw log hashes are recorded in `results.json`.

Warnings remain: upstream Rust unused/dead-code diagnostics, and the validator SBF post-processing warning `Invalid syscall code 9`. The validator still deployed the programs and completed the reported lifecycle. This evidence does not claim warning-free builds or mainnet readiness.
