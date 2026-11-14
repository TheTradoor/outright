# Pyth inspection verification

This follow-up adds a read-only Pyth Core inspector and checks its acceptance
rules against the published Percolator wrapper. It does not change engine,
program, transaction, custody or terminal code. Source revisions are unchanged.

| Check | Local result |
| --- | --- |
| Client suite | 594 passed, zero failed, cancelled or skipped. [Log](client-tests.log). |
| Oracle tests | 54 passed, including 31 shared wrapper vectors, malformed network/Clock/feed evidence, exact bank reads and the real CLI. [Log](oracle-tests.log). |
| Published wrapper conformance | One Rust test directly checked all 31 shared vectors against `oracle_v16::read_oracle_price_e6_from_bytes`. Includes the captured mainnet SOL/USD account. [Log](rust-conformance.log). |
| Wire contract | Rebuilt with Rust 1.100.0; output matches the retained contract byte-for-byte. No lockfile changes. |
| Source and terminal | Exact upstream engine-source comparison and terminal build pass. [Build log](terminal-build.log). |
| Mainnet observation | The actual command read SOL/USD from a confirmed bank. Age was 44 seconds against an explicit 60-second inspection limit; the observation passed. [Result](mainnet-observation.json). This is a dated sample, not a current price or an availability guarantee. |
| Previous keeper merge | All 46 post-merge checks for PR #32 completed successfully. [Check identities](pr32-postmerge-checks.json). These results retain their earlier source identity. |

[verification.json](verification.json) records the baseline and source hashes
for this work. The current PR must pass remote verification on its exact source
before merging; the previous 2,120-execution wrapper result is not relabeled.

The Rust and JavaScript tests share explicit vectors but call separate
implementations. They cover age and confidence boundaries, wrong owner/feed,
partial verification, malformed bytes, exponent and price limits, decimal
truncation and integers beyond JavaScript's safe range. A disabled confidence
check is tested to match the wrapper's parser semantics; the operator config
itself rejects that setting.

The CLI test allows only genesis, slot and account reads, verifies the bank
floor and fixed account list, confirms stale data produces a failing exit, and
checks that no files change. Signing options are rejected. RPC credentials and
provider errors do not appear in output.

The [operator guide](../../ORACLE_OPERATIONS.md) documents the exact receiver and
the difference between feed inspection and a funded publisher. OPS-01 still
requires production feed selection, publisher deployment, cadence, fee budget
and outage/recovery acceptance. Independent review, real wallets, liquidity and
release enrollment remain open. No wallet was loaded or transaction submitted.
