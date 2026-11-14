# Complete checked-host wrapper qualification

[Run 43563227621](https://github.com/TheTradoor/outright/actions/runs/43563227621)
passed for source `9191c8819ad683a7d8ffa49f831df5d90b99adb1`, tested merge
`43ee48081321b5607de58c991ca5c5ae3af7a024`. All **37 shards and 2,120 test
executions passed**, followed by the successful aggregate. All 40 workflow jobs
and the five separate native/engine workflows completed successfully.

| Target | Passed | Failed |
| --- | ---: | ---: |
| Compute-unit invariants | 1,574 | 0 |
| Stateful reference/fuzz tests | 343 | 0 |
| Saved fuzz regressions | 154 | 0 |
| Native application lifecycle | 17 | 0 |
| Library unit tests | 8 | 0 |
| Reallocation probe | 7 | 0 |
| Listing/oracle scope | 8 | 0 |
| Open-issue regressions | 9 | 0 |

Counts are test executions across Cargo targets, some of which share controls;
they are not 2,120 independent production scenarios. No assigned execution was
missing, duplicated, failed or relabeled from another build.

The formerly timed-out bounded reference graph passed in **457.375 seconds**
with the original 1,800-second deadline, 11,727 action words and 44,330
transitions. Host optimization is level one with debug assertions and overflow
checks enabled. Graph assertions, SBF bytes and compute limits are unchanged.
The [earlier timeout](../host-timeout-run-43526782149/README.md) remains a failed
historical attempt; it has not been rewritten as a pass.

The original qualification verifier independently reprocessed all 37 downloaded
reports. It verified exact registered/executed coverage, canonical Cargo targets
and harnesses, protocol/source identity and shared SBF hashes. Its output matches
the CI aggregate except for the explicitly recorded local verifier checkout
revision. Every per-test log digest and all 39 original GitHub artifact ZIP
digests were checked separately.

[summary.json](summary.json) records the result, exact identities, graph duration,
archive members and SHA-256 hashes. [index.json](index.json) binds every shard to
its original GitHub artifact and report. [complete-evidence.tar.gz](complete-evidence.tar.gz)
preserves all 39 original artifact ZIPs, 40 complete job logs, API metadata,
the CI and independently verified local aggregates, and the graph result.
Archive SHA-256: `87facbad47eb3518749c095c29dba76d8512567ae47ce9ca0b83f74d407328b6`.

The wrapper remains the reviewed upstream base plus patch and resulting Git
tree; fork publication and runtime-pin adoption remain open. This finite suite
does not constitute an independent security review, mainnet deployment, live
oracle/keeper acceptance or physical-wallet testing. Later mainnet client
changes are outside this run's recorded protocol identity.
