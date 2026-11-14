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
for this work. The standalone oracle log records an earlier targeted development
run. The final 594-test local run includes all 54 oracle cases, and remote CI
repeats them on the published source. Earlier wrapper results retain their
original source identities.

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

## Remote results

[PR #34](https://github.com/TheTradoor/outright/pull/34) merged after all 51 checks
passed. Head `c101229d38b495011b610d0a2f44f0725b4f7281` was tested at PR merge
`73f1a7aebea9c537779ef2a35c0192f5a01b8195`. Published merge
`e3d5308c2320de0c0b715be0cc0d3730b6a4e869` has the same complete tree,
`27f13783393dbd45d8e0ccad50b400ae5eaf780d`.

| Check | Result |
| --- | --- |
| [Native client](https://github.com/TheTradoor/outright/actions/runs/43635639352) | 594 passed, zero failed, cancelled or skipped. All 31 oracle vectors pass against the actual Rust wrapper. Source equivalence, wire contract and terminal build passed. [Log](native-client.log). |
| [Native SBF](https://github.com/TheTradoor/outright/actions/runs/43635639164) | 17 passed, zero failed, ignored or filtered; 26.86 seconds. [Log](native-svm.log). |
| [Current validator](https://github.com/TheTradoor/outright/actions/runs/43635639097) | Seven confirmed lifecycle transactions, conserved test collateral, zero final trader capital, real RPC discovery and capacity rejection. [Log](native-validator.log). |
| [Candidate validator](https://github.com/TheTradoor/outright/actions/runs/43635639124) | Passed in 26.121 seconds. Downloaded digest, exact tree, 79 protocol file hashes, binary attestations and seven-transaction report checked. [Archive](candidate-current-validator.zip). |
| [Full wrapper qualification](https://github.com/TheTradoor/outright/actions/runs/43635639169) | All 37 shards, 2,120 executions and aggregate passed. [Aggregate](wrapper-qualification.json). |
| [Engine](https://github.com/TheTradoor/outright/actions/runs/43635639096) | Default and fuzz checks passed. |

[ci-verification.json](ci-verification.json) records all 51 checks and GitHub
digests for the three retained archives. The candidate, wrapper program and
aggregate archive bytes match those digests. The four wrapper SBF hashes match
their attestation. The aggregate has matching source identities, harness and
target inventories, program hashes and all 37 shard identities. Its eight suite
lists total 2,120 executions. Individual raw wrapper logs were not separately
downloaded or independently verified for this run.

The candidate validator's SBPF v3 binary is checked against its own attestation;
the full wrapper matrix uses its separately pinned v0 build. The candidate
program hash remains
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
Both validator paths use the synthetic fixed-price TEST market.

Recheck the retained evidence from the repository root:

```sh
python3 docs/qualification/2026-11-15-pyth-inspection/verify_remote_evidence.py
```

This reads the retained artifacts and current source; it does not rerun the
Rust or SBF tests. [remote-verification.log](remote-verification.log) records the
result. [SHA256SUMS](SHA256SUMS) covers the retained files. Documentation-only
successors preserve the qualified protocol and runner identity.

## Remaining acceptance

The [operator guide](../../ORACLE_OPERATIONS.md) documents the exact receiver and
the difference between feed inspection and a funded publisher. OPS-01 still
requires production feed selection, publisher deployment, cadence, fee budget
and outage/recovery acceptance. Independent review, real wallets, liquidity and
release enrollment remain open. No wallet was loaded or transaction submitted.
