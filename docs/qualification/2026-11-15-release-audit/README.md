# Keeper shutdown and operator RPC review

This review covers the published application and program sources after PR #44.
It reproduced two operational defects, corrected them in
[PR #45](https://github.com/TheTradoor/outright/pull/45), and examined both warnings
from the independently reproduced program build. The Percolator engine and
`outright-program` source, binary and build flags are unchanged.

## Scope and local results

| Area | Inspection and verification |
| --- | --- |
| Wallet and transaction client | Account/program identity, instruction review, fee and rent checks, signing, durable receipts, confirmation, recovery and settlement paths reviewed; existing client tests rerun |
| Keeper and storage | Discovery, pending receipts, fee reservation, shutdown ownership and restart recovery reviewed; actual filesystem locks exercised |
| RPC tools | Terminal, wallet, keeper, oracle, enrollment and account-inspection transports checked; CLI subprocesses exercised against a controlled local HTTP server |
| Oracle and wire contract | Existing Pyth policy, integer scaling and Rust conformance checks retained and executed in native CI |
| Program and engine | Source pins and engine equivalence checked; existing SBF, validator and wrapper qualification run for the new application source |
| Website | Twenty routes, 998 local links/assets, four mechanics tests and all 83 canonical protocol files checked; Chromium exercised terminal retry and documentation search |

The baseline passed 607 client tests and 59 verifier tests. The corrected client
passes 616 tests, including nine new cases. Five of those cases fail against the
previous behavior: one shutdown ownership case and four CLI response cases.
The remaining cases check shutdown failure recovery and successful read-only
enrollment/inspection. Before/after logs are retained here. The terminal build
and engine source equivalence check passed.

This is an engineering review and automated qualification, not an independent
security review. No production signer was loaded, and no mainnet transaction was
submitted. Real wallet extensions, physical phones, production liquidity and
operating services remain separate acceptance requirements.

## Corrected behavior

### Keeper shutdown ownership

Shutdown closed the journal and removed `keeper.lock` before awaiting the final
`health.json` write. A replacement worker could acquire the directory while the
old process was still writing health status. The old write could then overwrite
the replacement's observation.

The final health write now completes while the existing worker still holds the
journal lock. Journal closure runs even when that health write fails. A poisoned
receipt journal retains its recovery lock, as before. The regression holds the
old writer open and proves that a replacement cannot acquire the directory until
shutdown finishes. Receipt recovery and the poisoned-lock path are also tested.

### Operator RPC response bounds

The profile-enrollment and account-inspection CLIs constructed their own RPC
connections without the shared decoded-response limit. The inspection command
also retained automatic rate-limit retries. Open oversized responses could keep
these tools waiting, and HTTP provider response bodies appeared in error output.

Both commands now use the existing 16 MiB response bound and 15-second request
deadline. Inspection disables rate-limit retries. Tests start the actual CLI
processes against an HTTP server that crosses the byte limit and leaves the
stream open, then check cancellation and failure without process-timeout cleanup.
Separate tests cover HTTP 429 and successful read-only RPC. No transaction method
is permitted by the successful test server.

## Program build warnings

The retained SBPF v3 program remains 1,283,424 bytes, SHA-256
`93c73f13ad0d79373d81a556b0a8f9f16e87799a3332f2f9f18558382d96e6a4`.

The exact [cargo-build-sbf 4.6.0 source](https://github.com/anza-xyz/cargo-build-sbf/blob/b0c665a47167198fbce6d9e9670693c9aa4e20d8/cargo-build-sbf/src/post_processing.rs)
was retrieved and compared byte-for-byte with the installed crate. Its
`verify_program` function passes the entire ELF file to a verifier that scans its
input as instructions. The first unrecognized call is at file offset 4,336 in
`.rodata`, before executable `.text` begins at offset 4,464. That data produces
the `Invalid syscall code 9` warning.

The executable section contains 14 syscall sites using 11 recognized symbols;
none has an unrecognized syscall code. The registry hashes were independently
crosschecked using the Rust hash implementation shipped with solana-sbpf 0.26.0.
[The diagnostic record](build-warning-analysis.json) and
[recheck script](verify_build_warning.py) bind this finding to the exact retained
binary. It explains this warning for this binary; it is not a replacement for
runtime verification or a blanket exemption for future warnings.

The second warning comes from the inherited `cdylib` plus `lib` crate types. The
wrapper supplies both the deployable program and library exports used by host
tests and Rust conformance. That configuration and its optimization limitation
remain recorded. No dependency, compiler flag, source pin or program byte was
changed to hide either warning.

## Browser observations

Chromium displayed the updated homepage and operations-review section. Searching
for `keeper restart` returned the new section first and navigated to its anchor.
The terminal displayed the unavailable-market state. Retrying returned to that
state, with wallet connection, trade review, deposit and withdrawal disabled.
The terminal layout was visually checked. See [browser-check.json](browser-check.json).

## Remote results

[PR #45](https://github.com/TheTradoor/outright/pull/45) merged as
`eab353065aa1f9d1329cf9681e686cfa23d5142c` after all **51 checks passed**. Its tree is
`d4bd003cc0be6e89479dd8e7d29162714bbd9cc3`, identical to the tested merge
`8a7d16c38e43ff93ba1bff9f8802f68009621300` and candidate
`2ca0dafb76b0473dad5c56f62d4ce05717be54e3`.

| Path | Result and retained evidence |
| --- | --- |
| [Native protocol](https://github.com/TheTradoor/outright/actions/runs/43729717434) | 616 client tests, engine source equivalence, Rust contract conformance including 31 shared oracle vectors, and terminal build; `native-protocol.log` |
| [Native SBF](https://github.com/TheTradoor/outright/actions/runs/43729717444) | 19 cases passed; `native-svm.log` |
| [Native validator](https://github.com/TheTradoor/outright/actions/runs/43729717472) | Seven confirmed lifecycle transactions, exact collateral reconciliation and discovery checks; `native-validator.log` |
| [Candidate current-validator](https://github.com/TheTradoor/outright/actions/runs/43729717453) | Seven confirmed transactions; exact client commit/tree, 83 protocol files, runner/harness identities and binary hashes independently checked; retained ZIP |
| [Complete wrapper qualification](https://github.com/TheTradoor/outright/actions/runs/43729717402) | All 37 shards and 2,137 executions passed; 39 artifact digests, complete registered/assigned inventory, binaries and all 2,137 raw logs independently checked; `wrapper-evidence.tar.gz` |

Both validator paths use controlled fixed-price TEST instruments. Each reconciles
starting and final collateral at 1,000,000,000 atoms, final trader capital at zero
and maker capital at 10,000,000,000 atoms. These paths and test counts overlap;
they do not represent independent production scenarios.

The candidate program remains SHA-256
`93c73f13ad0d79373d81a556b0a8f9f16e87799a3332f2f9f18558382d96e6a4`, matching
the independently rebuilt SBPF v3 binary. The wrapper suite also retains its
separate pinned SBPF v0 builds. No program source or build flag changed.

[CI metadata](ci-verification.json) preserves all check identities and artifact
digests. [Independent verification](remote-verification.json) records the local
recheck of all 40 downloaded artifacts, including the full wrapper log inventory.

## Recheck retained evidence

From the repository root:

```sh
python3 docs/qualification/2026-11-15-release-audit/verify_build_warning.py
python3 docs/qualification/2026-11-15-release-audit/verify_remote_evidence.py
(cd docs/qualification/2026-11-15-release-audit && sha256sum -c SHA256SUMS)
```

The scripts recheck retained records and binary/log digests. They do not repeat
compilation, RPC calls or the Rust test executions. Source identity must match
the recorded application for the current qualification verifier to accept it.
