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

Rust tooling is absent in this local workspace. Rust conformance, rebuilt SBF,
validator execution and full wrapper qualification must pass for this exact
revision in CI before merge. The earlier PR #36 results are not evidence for
this changed client. Remote results will be retained separately after they
finish.

Engine, program, matcher, instruction builders and account layouts are unchanged.
Program source remains `72dd8948b116e9e16a85c830e1e2a7915f12d542`, tree
`8b54b827082b2b838beacd88d4d99bd12878d2ca`. This correction does not close
production funding, operator hosting, independent review or real-wallet
acceptance. The official market profile remains `null`.

[SHA256SUMS](SHA256SUMS) covers the retained local evidence.
