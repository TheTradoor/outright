# Terminal freshness native CI evidence

Source head and actual checkout in all five jobs: `3372660fc4d76b47b6cdb1a12a239bce4dcb84f5`.
Source tree: `77f802229d2eba0c90d6cf57c4834078d9f9c383`.
Branch: `fix/terminal-freshness`. These are push workflows, not a synthetic PR merge checkout.

| Gate | Run | Job | Observed result |
|---|---|---|---|
| Engine default | 43523301014 | 132222694267 | 371 passed; 0 failed, ignored or filtered |
| Engine fuzz | 43523301014 | 132222693824 | 439 passed; 0 failed, ignored or filtered |
| Native protocol | 43523300954 | 132222693742 | 477 passed; 0 failed, skipped or cancelled; source verification, Rust exporter comparison and terminal build succeeded |
| Native SVM | 43523301002 | 132222694207 | 17 passed; 0 failed, ignored or filtered; 36.51 seconds |
| Native validator | 43523300920 | 132222694277 | Seven client lifecycle transactions; fixed-price local market |

All four workflows and five jobs completed successfully against the exact source head above. The engine default/fuzz test counts overlap and must not be added into a unique total.

The validator report records initialize, deposit, long open/close, short open/close and withdrawal. Trader collateral is `1000000000` atoms both before and after. Final trader portfolio capital is `0`; maker capital is `10000000000`. Transaction signatures and local network identities are retained in `validator-report.json`.

The runtime source remains engine `a712af767eeb217876a3d3c50e3849b60ea54462` and wrapper `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`. These logs validate the freshness client changes against that baseline wrapper. Candidate-wrapper SBF integration and full wrapper qualification are separate evidence.

Full logs were fetched through the GitHub connector. GitHub-masked authentication fields remain masked. No signer secret or seed phrase was present in the inspected logs. `results.json` records raw log hashes, exact checkout identities and observed counts; `run-metadata.json` records workflow/job identities and completed statuses.

Warnings remain: upstream Rust unused/dead-code diagnostics, and the validator SBF post-processing warning `Invalid syscall code 9`. The validator nevertheless deployed the programs and completed the reported lifecycle. This record does not claim warning-free builds, a completed candidate-wrapper gate or mainnet readiness.
