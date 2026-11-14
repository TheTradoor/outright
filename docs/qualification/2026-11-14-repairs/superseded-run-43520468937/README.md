# Superseded wrapper run: retained evidence

[Run 43520468937](https://github.com/TheTradoor/outright/actions/runs/43520468937)
is **completed / cancelled and superseded**, not a complete passing qualification.
It tested source `9a5d13b27ab77a1a927e0f41d15bc6f6da6606d1` through merge
`1a3f222b7452242481b9633e1fc1c4c8fd00abbf`.

The retained reports record **2,038 passing executions, one INV048 failure and
four incomplete shards** (`v16_cu-02`, `v16_program_stateful_fuzz-08`, `-09`, `-10`).
These are recorded executions, including completed cases within incomplete
shards; they do not establish unique full-suite coverage. CU14 completed with
97 passes and one obsolete source-contract assertion failure. The aggregate job
failed, and no successful aggregate artifact exists. CASE-10 documents the later
source-contract repair; this archive preserves the original failure.

`retained-evidence.tar.gz` contains the frozen run's 140 root files byte for byte:
34 original artifact ZIPs, 35 complete job logs and 71 metadata JSON files.
Expanded artifact directories are omitted because their exact contents remain
inside the original ZIPs. The archive also contains this newly authored README;
it was not present in the frozen source. Its original `index.json` and `run.json`
retain statuses, source identities, per-shard results and artifact provenance.
Paths in the original index pointing into extracted directories resolve after
extracting the corresponding ZIP to that named directory.

`summary.json` records the outcome and archive checksum; `archive-members.json`
records every tar member's byte count and SHA-256. All 34 ZIPs were checked against
their GitHub artifact metadata digests and sizes, their ZIP integrity, and the
original index. The log hashes in that index were also verified. Tar members are
sorted with fixed modes, empty owner names, zero owner IDs and timestamps; gzip
uses a zero timestamp and empty filename. Two independent encodings were byte-identical.
Raw logs retain their original whitespace and GitHub masking.

Final source `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c` is evaluated separately by
[run 43526782149](https://github.com/TheTradoor/outright/actions/runs/43526782149).
Its 37-shard aggregate remains pending in the follow-up record. No result from
this superseded run is relabeled as a final-source pass or mainnet approval.
