# Complete attempt with one host timeout

[Run 43526782149](https://github.com/TheTradoor/outright/actions/runs/43526782149)
finished on source `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c`, tested merge
`07e88e6d6cf5c0af5c1b736bd0976aa6e9c91de3`. All 37 shard reports are complete.
The execution inventory contains **2,119 passes and one timeout**; the aggregate
correctly failed. Counts are executions across Cargo targets, which share some
controls, rather than unique production scenarios.

| Target | Passed | Failed |
| --- | ---: | ---: |
| Compute-unit invariants | 1,574 | 0 |
| Stateful reference/fuzz tests | 342 | 1 |
| Saved fuzz regressions | 154 | 0 |
| Native application lifecycle | 17 | 0 |
| Library unit tests | 8 | 0 |
| Reallocation probe | 7 | 0 |
| Listing/oracle scope | 8 | 0 |
| Open-issue regressions | 9 | 0 |

The only failed invocation is
`inv_086_reference_model_and_deployed_transition_equivalence::v16_program_bounded_reference_graph_exhausts_public_action_words`.
Its log records `QUALIFICATION TIMEOUT after 1800 seconds`, exit 124, without
a completed Rust result or an assertion failure. It is not a pass. The remaining
two tests in that shard ran and passed after the timeout.

The source-bound graph explores 11,727 action words and 44,330 transitions.
The follow-up changes the host build profile to checked optimization level one;
it leaves every graph assertion, action, frontier, SBF byte, CU limit and the
1,800-second per-test limit unchanged. Passing the follow-up remains a separate
requirement.

[summary.json](summary.json) records independently checked exact execution
coverage, canonical harness and Cargo inventory, protocol/source identity, SBF
hashes, every retained log checksum and the aggregate failure.
[index.json](index.json) retains all 37 artifact/job identities.
[complete-evidence.tar.gz](complete-evidence.tar.gz) preserves the original
artifact ZIPs, complete root job logs and metadata. ZIP members preserve every
test log and compilation record, including the timeout. The archive member
hashes are in the summary; the archive SHA-256 is
`3c42d1765162e23d2211f7af8d73ba20e70b9dfd17296ddd87e4d856a7d84fd1`.

The original qualification verifier was rerun against these reports and rejected
them with `Failed tests in v16_program_stateful_fuzz-08`. No failed report was
modified or counted as passing to obtain a coverage summary.
