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

## Remaining acceptance

The [host guide](../../KEEPER_HOSTING.md) separates operational thresholds from
market risk policy. No production host, oracle publisher, funded fee payer or
external alert destination was configured. RPC enumeration completeness and
actual hosted capacity/outage acceptance remain open under OPS-02. Delivered
alerts and assigned incident responders remain open under PROD-05. Physical
wallet acceptance and independent review are unchanged. The official trading
profile remains `null`.
