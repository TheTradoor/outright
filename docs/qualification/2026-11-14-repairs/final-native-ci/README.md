# Final integrated application native CI evidence

Source head: `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c`.
Source tree: `e63c1049c06b0f1ca3a62dde3ec65a6e1c85efff`.
All five PR #25 jobs checked out GitHub's merge commit `07e88e6d6cf5c0af5c1b736bd0976aa6e9c91de3`.

| Gate | PR run | Job | Observed result |
|---|---|---|---|
| Engine default | 43526783773 | 132234396587 | 371 passed; 0 failed, ignored or filtered |
| Engine fuzz | 43526783773 | 132234396972 | 439 passed; 0 failed, ignored or filtered |
| Native protocol | 43526782095 | 132234392998 | 477 passed; 0 failed, skipped or cancelled; source verification, Rust exporter comparison and terminal build succeeded |
| Native SVM | 43526781978 | 132234390957 | 17 passed; 0 failed, ignored or filtered; 27.45 seconds |
| Native validator | 43526782038 | 132234391027 | Seven client lifecycle transactions; fixed-price local market |

All five PR jobs completed successfully against the tested merge above. The engine default/fuzz counts overlap and must not be added into a unique total. All four duplicate push workflows also succeeded at the exact source head. Their run IDs and final statuses are recorded in `run-metadata.json`.

The validator report records initialize, deposit, long open/close, short open/close and withdrawal. Trader collateral is `1000000000` atoms both before and after. Final trader portfolio capital is `0`; maker capital is `10000000000`. Transaction signatures and local network identities are retained in `validator-report.json`.

The runtime source remains engine `a712af767eeb217876a3d3c50e3849b60ea54462` and wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`. These logs validate the final integrated application against that baseline wrapper. Candidate-validator run `43526782070` and full-wrapper run `43526782149` are separate evidence and are not qualified by these passing jobs.

Full logs were fetched through the GitHub connector. GitHub-masked authentication fields remain masked. No signer secret or seed phrase was present in the inspected logs. `results.json` records raw log hashes, actual checkout identities and observed counts; `run-metadata.json` records workflow/job identities and statuses.

Warnings remain: upstream Rust unused/dead-code diagnostics, and the validator SBF post-processing warning `Invalid syscall code 9`. The validator nevertheless deployed the programs and completed the reported lifecycle. This evidence does not claim warning-free builds, completed candidate qualification or mainnet readiness.
