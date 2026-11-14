# Published-program and mainnet-client verification

This evidence applies to client commit
`02e16562c7e49ab2c4e399599e0b796f22e7b10e`, tested PR merge
`c445ff27285ccfa6800927a08300b85853ea5735`, tree
`537c60abf1b371bce2e9b79cedcff1a22f53cefa`.

The runtime and qualification use published program commit
`72dd8948b116e9e16a85c830e1e2a7915f12d542`, source tree
`8b54b827082b2b838beacd88d4d99bd12878d2ca`. The upstream Percolator engine remains
`a712af767eeb217876a3d3c50e3849b60ea54462`. Builds no longer apply a patch overlay.

| Check | Result | Retained evidence |
| --- | --- | --- |
| Complete wrapper qualification | All 37 shards and 2,120 executions passed; independent aggregate and all test-log hashes verified | [Evidence index](wrapper-evidence-index.json), [CI aggregate](wrapper-qualification.json), [local aggregate](wrapper-local-aggregate.json), [complete raw packet](wrapper-complete-evidence.tar.gz) |
| Native client, Rust conformance and build | 496 passed; zero failed, skipped or cancelled | [CI log](native-client.log), [run 43570649278](https://github.com/TheTradoor/outright/actions/runs/43570649278) |
| Application SBF lifecycle | 17 passed; zero failed, ignored or filtered; 33.49 seconds | [CI log](native-svm.log), [run 43570649228](https://github.com/TheTradoor/outright/actions/runs/43570649228) |
| Ordinary current-validator lifecycle | Seven confirmed client transactions; exact collateral reconciliation | [Report](native-validator-report.json), [CI log](native-validator.log), [run 43570649281](https://github.com/TheTradoor/outright/actions/runs/43570649281) |
| Independently attested current-validator lifecycle | Seven transactions; 26.025 seconds; exact source and artifact identity verified | [Report](candidate-report.json), [attestation](candidate-attestation.json), [summary](candidate-summary.json), [original artifact](candidate-current-validator.zip), [run 43570649227](https://github.com/TheTradoor/outright/actions/runs/43570649227) |
| Independent SBPF v3 program build | Exact SHA256 match to the program tested on the current validator; published source tree is clean | [Build verification](program-build-verification.json), [build log](program-build-verified.log), [program binary](percolator_prog-sbpf-v3.so) |
| Qualification verifiers | 53 local tests passed | [Log](verifier-local.log) |
| Website | Version 30 published with current qualification results; 17 routes and 750 links/assets passed. The identical client passed four mechanics tests and 496 client tests in version 29 | [Version 30 record](site-v30.json), [version 29 verification](site-v29.json), [build log](site-build.log), [check log](site-check-after.log) |

Complete wrapper qualification passed in
[run 43570649236](https://github.com/TheTradoor/outright/actions/runs/43570649236).
All 39 original artifact ZIPs match GitHub's SHA256 digests. All 2,120 raw
test logs match their result records. The packet retains those ZIPs, all 40
decoded job logs, final API metadata and both aggregate results. Its exact
contents, size and archive hash are recorded in the evidence index.

The independent verifier fetched the immutable published sources and reproduced
the CI aggregate. Only `candidate_source_metadata.outright_revision` differs:
the local verifier ran at client head `02e16562`, while GitHub used merge
`c445ff27`. Both identify the same clean source tree. All tested-source metadata,
source identities, coverage, harnesses and binary hashes match.

The bounded reference graph passed in 467.737 seconds under the original
1,800-second limit. It retains the original 11,727 action words and 44,330
transitions. All 51 PR checks passed before merging as
`3bfbe078c1493764bcb56bffc384dea99f5db55b`, whose tree is exactly the tested tree.
This run is separate from the earlier qualification at a different client and
source identity; earlier evidence is not relabeled.

The candidate-validator artifact's original GitHub SHA256 is
`0d050c0acec7ec1613e4f20216f6ee5c3c417ca576d0f425c391ad57b6cada93`.
Its downloaded bytes, source identity, client tree and complete lifecycle report
were independently checked with the current verifier. Both validator paths use
Agave 4.4.1, platform-tools v1.58 and SBPF v3. They use a synthetic TEST market
and generated local signers. The legacy SBF tests use a separate v0 build.

The first website check failed because the CLI test expected `protocol/` while
the website stored its client under `native-client/`. The checkout and build
commands were aligned with the canonical path; all assertions were retained.
[The original failure](site-check-before.log) and passing rerun are both saved.
All 65 tracked protocol files match the tested application source.

Browser checks cover desktop onboarding, unavailable-market retry and operator
separation. Browser-extension metadata errors were observed separately from the
application. No actual wallet extension, physical phone, live oracle, funded
production maker or mainnet transaction is claimed. The hosted profile remains
`null`; these results do not complete the [mainnet release requirements](../../MAINNET_RELEASE.md).

The independent SBPF v3 program build reproduced CI SHA256
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`. The two initial toolchain
unpack failures and the successful build are retained. Moving the isolated
platform-tools cache out of the space-constrained home tmpfs resolved the
build-environment issue without changing program source or compiler flags.
The binary is a review artifact, without signing keys or a production deployment.
