# Keeper health verification

This follow-up adds operator observability and systemd templates to the client
from PR #31. The previously interrupted evidence commit `4f1655b2` is retained
in this branch; its 39 artifacts and 2,120 wrapper-log digests were reverified
with its existing verifier before continuing.

## Local results

| Check | Result and scope |
| --- | --- |
| `npm test --prefix protocol` | 540 passed, zero failed, cancelled or skipped. [Full log](client-tests.log). Includes 15 new monitor tests and additional assertions in the existing keeper process tests. |
| `npm run build --prefix protocol` | Terminal build passed. [Build output](build.log). |
| `node protocol/check-source.mjs` | Exact engine-source equivalence and source-lock agreement passed. |
| Upstream engine comparison | No diff from `a712af767eeb217876a3d3c50e3849b60ea54462` in source, upstream tests, specification, Cargo files, license, build configuration or proof inventory. |
| Program and browser scope | No diff from PR #31 in `protocol/src`, source lock, generated contract, terminal, Rust conformance or SBF integration code. |
| systemd syntax | All three units passed `systemd-analyze verify` using temporary copies with the available Node executable in place of `/usr/bin/node`. The unmodified templates require that documented host path. No service was installed or started. |
| Diff whitespace | `git diff --check` passed. |

[verification.json](verification.json) records the baseline, source pins, runtime
and SHA-256 hashes of the operator source, units, regression tests, dependency lock
and generated contract. The source hashes distinguish these checks from the
earlier PR #31 qualification. The full wrapper matrix and SBF validator paths
were not rerun locally for this operator-only change.

The process tests run real Node CLI children against controlled HTTP JSON-RPC
fixtures. They verify that the live status is written before stdout reports a
submission, a deferred account remains visible after another succeeds, graceful
termination reports stopped, restart confirms the original receipt without a
second send, and RPC failure publishes failed status while preserving the journal
and reserved fees. They do not send transactions to Solana mainnet.

Monitor regressions cover receipt and partial-sweep age across restart, missed
health writes, missing history, fixed-bank stalls, slow cycles, fee headroom,
capacity and empty scans, rejected/failed/deferred work across complete sweeps,
configuration/journal disagreement, clock rollback, file modes, size limits,
symlinks, corrupt history and sanitized output. The read-only health CLI passes
with an unreachable configured RPC and an existing worker lock, leaving every
file unchanged. Simulation and stopped processes cannot report readiness.

## Remote results

[PR #32](https://github.com/TheTradoor/outright/pull/32) merged after all 51 checks
passed. Head `da50d845f752f03e9f8b778854bf436a86b93da5` was tested at PR merge
`a4f4ebc0a9703011dc3f8fec12f6a0dd62218122`. Published merge
`9ea27452e3be6e141727d205f4a5aae8b028bedb` has that same complete tree,
`a53736b0d8a6282d16267832ef00b5006809faf8`.

| Check | Result |
| --- | --- |
| [Native client](https://github.com/TheTradoor/outright/actions/runs/43619626553) | 540 passed, zero failed, cancelled or skipped. Source equivalence, Rust conformance and terminal build passed. [CI log](native-client.log). |
| [Native SBF](https://github.com/TheTradoor/outright/actions/runs/43619626519) | 17 passed, zero failed, ignored or filtered; 32.75 seconds. [CI log](native-svm.log). |
| [Current validator](https://github.com/TheTradoor/outright/actions/runs/43619626473) | Seven confirmed lifecycle transactions, conserved collateral, zero final trader capital, real RPC discovery and capacity rejection. [CI log](native-validator.log). |
| [Candidate validator](https://github.com/TheTradoor/outright/actions/runs/43619626489) | Passed in 25.507 seconds. Downloaded archive digest, exact client tree, 73 protocol file hashes, deployed binary attestations and seven-transaction report checked. [Archive](candidate-current-validator.zip). |
| [Full wrapper qualification](https://github.com/TheTradoor/outright/actions/runs/43619626528) | 37 shards, 2,120 executions and the aggregate passed. [Aggregate](wrapper-qualification.json). |
| [Engine](https://github.com/TheTradoor/outright/actions/runs/43619626470) | Default and fuzz checks passed; upstream engine source remains unchanged. |

[ci-verification.json](ci-verification.json) retains all 51 check identities and
the GitHub digests of three downloaded archives. The candidate, wrapper program
and wrapper aggregate archive bytes match those digests. Four wrapper SBF binary
hashes match the program attestation; the aggregate has the same source identity,
harness inventory, program hashes and exact 37-shard source roster. Its eight
suite lists total 2,120 executions. Individual raw wrapper logs were not separately
downloaded or independently verified for this run. The earlier PR #31 packet
retains its broader raw-log verification under its original source identity.

The candidate validator uses SBPF v3; the full wrapper matrix uses its separately
pinned v0 build. Their binary hashes are checked against the corresponding
attestation, not compared as if they were the same artifact. Both validator
paths use the synthetic fixed-price TEST market, not a production oracle or
funded market-making service.

Recheck the retained artifacts and current source hashes from the repository root:

```sh
python3 docs/qualification/2026-11-14-keeper-health/verify_remote_evidence.py
```

This verifier checks downloaded evidence; it does not rerun the Rust or SBF tests.
Its result is retained in [remote-verification.log](remote-verification.log).
Documentation-only successors preserve the qualified protocol and runner identity.

## Remaining acceptance

The [host guide](../../KEEPER_HOSTING.md) separates operational thresholds from
market risk policy. No production host, oracle publisher, funded fee payer or
external alert destination was configured. RPC enumeration completeness and
actual hosted capacity/outage acceptance remain open under OPS-02. Delivered
alerts and assigned incident responders remain open under PROD-05. Physical
wallet acceptance and independent review are unchanged. The official trading
profile remains `null`.
