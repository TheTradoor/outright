# Final candidate current-validator CI evidence

GitHub run: https://github.com/TheTradoor/outright/actions/runs/43526782070
Job: 132234392500. Result: **passed**.

## Exact tested source

- PR #25 source head: `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c`.
- Tested merge: `07e88e6d6cf5c0af5c1b736bd0976aa6e9c91de3`.
- Tested tree: `e63c1049c06b0f1ca3a62dde3ec65a6e1c85efff`.
- Wrapper base: `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13`.
- Candidate patch SHA-256: `031848cbccf8dd971ba3fc16b4c39db56093a24cbbc527aaf6e8182d71c061c6`.
- Candidate tree: `8b54b827082b2b838beacd88d4d99bd12878d2ca`.
- Engine: `a712af767eeb217876a3d3c50e3849b60ea54462`.
- Qualification runner SHA-256: `13be25338a4a0e26161fca89bbf04e003cfde39087bc2c8760b5ced4cdcd05b1`.
- Manifest SHA-256: `61cdbdceea699993959ccb5bc24443f0bd00c57e39ff92241a16a6dc9553b0ca`.
- Tracked protocol identity: 61 files, `d9292fe5ea4264c22ef31503f26a8107e1da259c531458ea2531935f469fe7f4`.

The full CI source identity equals `expected-source-identity.json`, independently
captured from the final local source before downloading the CI artifact.

## Result

Tools: cargo-build-sbf 4.6.0, platform-tools v1.58, SBPF v3, Agave 4.4.1.
Twelve report-verifier tests and Node syntax checks passed. Both programs built
successfully. The RPC lifecycle completed in **25.765 seconds**:
portfolio initialization, 100 TEST deposit, long open/close, short open/close,
and 100 TEST withdrawal. All seven distinct signatures have successful confirmed
transaction metadata. An oversized deposit was rejected before signing.
Trader collateral starts and ends at exactly **1,000,000,000 atoms**; final
portfolio capital is **zero**; maker capital is **10,000,000,000 atoms**.

Raw wrapper SBF SHA-256:
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
Raw authentication matcher SBF SHA-256:
`042f7cc2e6a7b343da58d511f72abf56f57e044f70f7b695a52aec2cb9d70190`.
Both hashes exactly match the preliminary PR #26 artifacts. The revised patch
changes test ownership, without changing these production binary bytes.
The deployed ProgramData payload hashes match the raw hashes in this run;
upgrade authorities are null. Both deployed binaries and candidate source were
checked before and after execution.

Artifact 14085113691, ZIP SHA-256 (verified against GitHub metadata):
`f860ec9c5ff7706d8a8aafb3a70f454b3f45b1be373419152a893b4a2a35aa9d`.
The verified ZIP, compact extracted reports/build/lifecycle logs, complete job log and metadata are retained here. The full 1.2 MB `validator.log` is preserved inside the ZIP without duplicating its expanded copy; its SHA-256 is `07e74c68ef20da96b5c15af2733456aa85697f680846ae5d2b9a10ad46e12579`.
The existing `Invalid syscall code 9` build warning remains in the raw log;
actual program deployment and execution succeeded.

This result covers the final integrated source above. The market uses synthetic
collateral and a fixed price. It is not a physical-wallet test, full oracle or
Recovery campaign, security audit, production enrollment or mainnet approval.
No deployment profile was exported and no runtime source pin changed.
