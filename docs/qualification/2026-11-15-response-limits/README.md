# Terminal response limits

The official market loader previously checked its 64 KiB limit after
`response.text()` had consumed the entire body. A server that sent 65,537 bytes
and kept the connection open left the terminal loading instead of rejecting the
response immediately. The [pre-fix reproduction](before.log) also records the
resulting failures of the following retry tests. Its base is
`c73b2071ebcbbf11d6f87cbff22fce0bd2cd660f` with the new oversized-stream test.

The loader now counts decoded bytes while reading and cancels immediately above
64 KiB. Wallet RPC responses use the same reader with a 16 MiB limit. The keeper
and oracle inspector retain their existing 16 MiB limit through the shared
transport. These are decoded-body limits, not total browser memory guarantees.
The reader does not retain a separate allocation for every small stream chunk.

Caller cancellation and the existing 15-second deadline both remain active
after response headers arrive. A failed HTTP response is cancelled without
reading provider diagnostics, and cancellation acknowledgement cannot strand the
error path. Rejected responses do not enable wallet actions or send transactions.

## Local verification

| Check | Result |
| --- | --- |
| Client suite | 607 passed; zero failed, cancelled or skipped. [Log](client-tests.log). |
| Added coverage | 13 cases: two terminal onboarding scenarios and 11 transport tests, including the real `Connection` RPC path used by `OutrightClient`. |
| Source equivalence | Percolator source remains `a712af767eeb217876a3d3c50e3849b60ea54462`. [Log](source-check.log). |
| Terminal build | Browser bundle built successfully. [Log](terminal-build.log). |

The transport cases cover the exact decoded-byte boundary, multibyte text split
across chunks, misleading length headers, an open oversized response, a stalled
body, caller cancellation, deadline cancellation, partial JSON, and HTTP
403/429/503 responses. Onboarding checks that failure leaves trading locked and
permits retry. No production wallet, external RPC or funds are involved in these
tests.

Rust tooling is absent in this local workspace. The fresh CI client run has
passed Rust conformance, the 31 shared oracle vectors and all 607 JavaScript
tests. The rebuilt SBF run passed all 19 cases in 59.44 seconds. Both validator
paths completed seven transactions with exact collateral reconciliation. These
results belong to PR #39; earlier PR #36 results are not reused for this client.
All 51 checks subsequently passed, including the complete 37-shard wrapper matrix and aggregate. PR #39 is merged with the exact tested tree.

## Browser check

The shipped terminal bundle was exercised in Chromium against the local preview.
A finite profile body with 65,537 spaces followed by `null` produced the expected
load error, with retry available and wallet/trade buttons disabled. Restoring the
canonical `null` profile and clicking Try again restored the unavailable-market
state. [Observations](browser-check.json), [rejected response](outright-response-rejected.jpg)
and [recovered page](outright-response-recovered.jpg) are retained.

This is a browser loading/retry check, not wallet or mainnet acceptance. Open
streams and body timeout were exercised by the automated tests. Observed console
errors originated from the browser extension's content script, not the terminal.

## Remote results

[PR #39](https://github.com/TheTradoor/outright/pull/39) has head
`b5614216fdc268d9566de8c70521eba44c2d6456`, tested merge
`daba83eea68d96f684f468151d3ba3c9e93b9b3d` and tree
`c0154106b181b3e0fc20c9fe65d6e35a8345a6c7`. Published merge
`90095e5e43a1d8f57ab612983bbae90a4bb37abb` has that identical complete tree.

| Check | Recorded result |
| --- | --- |
| [Native client](https://github.com/TheTradoor/outright/actions/runs/43691379732) | 607 passed, zero failed or skipped; source equivalence, Rust conformance and build passed. [Log](native-client.log). |
| [Native SBF](https://github.com/TheTradoor/outright/actions/runs/43691379774) | 19 passed, zero failed, ignored or filtered, including both Hybrid cases. [Log](native-svm.log). |
| [Native validator](https://github.com/TheTradoor/outright/actions/runs/43691379863) | Seven lifecycle transactions, unchanged starting/final token balance, zero final trader capital; real RPC discovery and overflow rejection. [Report](native-validator-report.json), [log](native-validator.log). |
| [Candidate validator](https://github.com/TheTradoor/outright/actions/runs/43691379739) | Passed in 26.075 seconds. Downloaded archive digest, all 81 protocol hashes, source/tree identity, program attestations and seven-transaction report checked. [Archive](candidate-current-validator.zip). |
| [Wrapper qualification](https://github.com/TheTradoor/outright/actions/runs/43691379931) | All 37 shards, 2,122 executions and aggregate passed. Four rebuilt program hashes and the archive digest match their attestation. [Programs archive](wrapper-programs.zip). |

The [candidate build check](candidate-build-check.json) records the bounded
verification completed while the matrix was still running. The SBPF v3 candidate
program remains `1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
The separate SBPF v0 wrapper matrix uses its own recorded program hashes.

## Website publication

[Outright](https://outright.bollish-eth.chatgpt.site) version **33** was published
successfully on 15 November 2026 at 15:22 WIB from source
`43accd5c262e13c5c79c68a060363c0524e42ff0`. Its 81 canonical protocol files match
published client `90095e5e43a1d8f57ab612983bbae90a4bb37abb` byte for byte.
The deployed terminal bundle matches the bundle used for the browser check.

The final static check covers 20 HTML routes and 992 local links/assets. The
website checkout also passed four mechanics checks and all 607 client tests
before the final documentation-only edits; the canonical source and terminal
bundle did not change after those tests. The homepage announcement, Updates,
source references and checklist now include this correction and its results.

[site-publication.json](site-publication.json) retains the native successful
deployment, version/source identity, local upload digest and separate stored
archive metadata. [site-source-snapshot.json](site-source-snapshot.json),
[site-final-routes.log](site-final-routes.log), [site-check.log](site-check.log)
and [site-build.log](site-build.log) record the local checks. The 39-file upload
contains a `null` market profile. Owner-only access and environment revision 0
are preserved. This publication does not open a market.

Engine, program, matcher, instruction builders and account layouts are unchanged.
Program source remains `72dd8948b116e9e16a85c830e1e2a7915f12d542`, tree
`8b54b827082b2b838beacd88d4d99bd12878d2ca`. This correction does not close
production funding, operator hosting, independent review or real-wallet
acceptance. The official market profile remains `null`.

[ci-verification.json](ci-verification.json) retains all 51 check identities and
three archive digests. [remote-verification.log](remote-verification.log) records
the independent comparison of source and binary identities, all 81 protocol
files, 37 shard records, target/harness inventories and candidate lifecycle.
Individual raw wrapper logs were not independently downloaded for this run.
All four SBPF v0 and both SBPF v3 binaries also match the previous qualification.

Recheck the retained evidence from the repository root:

```sh
python3 docs/qualification/2026-11-15-response-limits/verify_remote_evidence.py
```

The verifier checks recorded evidence; it does not rerun Rust or SBF tests.
[SHA256SUMS](SHA256SUMS) covers the retained evidence.
