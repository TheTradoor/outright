# Full wrapper qualification

`Complete wrapper qualification` is the aggregate gate for the exact source commit in
`qualification/wrapper-source.json`. It requires every default-feature library unit
and integration test, plus the native client lifecycle tests, to execute successfully.
The initial baseline contains 1,566 CU, 336 stateful, 148 regression, 17 native lifecycle,
8 library, 7 Anchor probe, 8 listing/oracle scope, and 9 open-issue regression executions;
those numbers are minimum inventory checks, not a selection of tests. Added tests
are discovered and executed automatically. Known failures remain failures.
Some integration binaries include the same shared controls. These counts measure
test executions in each Cargo target, not distinct production scenarios.

The manifest pins the published `TheTradoor/outright-program` commit
`72dd8948b116e9e16a85c830e1e2a7915f12d542` and source tree
`8b54b827082b2b838beacd88d4d99bd12878d2ca`, alongside the unchanged upstream engine,
matcher and toolchains. Runtime, conformance and qualification use that same
published source. Every job checks the commit, tree and unchanged working copy
before and after execution. The original upstream revision and repair patch remain
recorded as provenance; the current build does not apply an overlay.
The runner still supports an explicitly identified overlay for historical evidence
or a future review candidate. Use full commit and tree SHAs. No repository credentials,
wallet keys, deployed accounts, mainnet transactions, or additional token permissions
are needed. The workflow has only `contents: read`; every Action is pinned to a full
commit. Existing licenses remain in the fetched repositories and accompany artifacts.

## Compilation and scheduling

The full CU binary exceeded local compiler memory. Sixteen generated harnesses keep
the original shared prelude and selected invariant module declarations, with their
transitive helper modules. They import the original test source files without changing
assertions or test bodies. `tests/v16_cu.rs` remains untouched: source-contract tests
continue inspecting the complete original harness. The reviewed dependency map was
derived from Rust identifiers, excluding comments and source-code strings. A new
cross-module dependency fails compilation until the map is updated.

Each invariant root module has exactly one owner shard. Dependency modules can be
compiled by several shards; their tests execute only on the owner. Any root/support
tests execute on CU shard zero. Stateful and regression binaries compile intact, then
their dynamically listed test names are divided deterministically over twelve and four
shards. A separate shard runs all seventeen native client lifecycle tests by importing
the existing lifecycle harness and driver against the same candidate. It does not
invoke the older runner that requires a clean baseline HEAD. All jobs
use standard `ubuntu-24.04` runners, one compiler job,
disabled incremental compilation, zero debug information, 256 codegen units,
and one test process at a time. The manifest pins host optimization to level one
for both development and test profiles, with debug assertions and integer overflow
checks explicitly enabled. This speeds up the host simulator and reference-model
bookkeeping; it does not change the SBF build, test bodies, compute limits, action
alphabet, graph depth, or thirty-minute per-test deadline. Ambient Cargo profile
overrides, compiler wrappers, and Rust flags are removed before host compilation.
The host profile is part of the attested source identity, so older reports cannot
be relabeled as results of the new build. A separate cache key avoids reusing the
old unoptimized host cache.

The first complete 37-shard run, `43526782149`, recorded a timeout in
`v16_program_bounded_reference_graph_exhausts_public_action_words` after exactly
1,800 seconds. Its graph replays 11,727 action words and 44,330 transitions. That
execution remains a failed historical attempt. The checked-host follow-up
[run 43563227621](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md)
passed the same graph in 457.375 seconds and completed all 37 shards, 2,120
executions and the aggregate at source `9191c881…`. Exact coverage and identities
were independently reverified. This finite source-specific result does not
substitute for production or physical-wallet acceptance.

The library and three additional integration targets
each have their own shard, for thirty-seven jobs total. At most twelve matrix jobs run concurrently. Host
dependencies share a cache keyed by locked dependencies and the host build profile.

Before attestation, each shard, and aggregation, the pinned host Cargo runs
`cargo +1.95.0 metadata --locked --no-deps --format-version 1`. The guard selects the
exact wrapper package, normalizes source paths relative to its checkout, resolves the
default feature closure, and requires exact equality between configured targets and
every default-enabled target with `test = true`. Only the known generated CU/native
harnesses are removed from that original-target inventory, after their paths and
bytes are verified. A new uncovered target, missing library, or changed feature gate
fails qualification. Generated harnesses therefore cannot change the original inventory.
Fetching sources itself does not require Cargo or a Rust toolchain.

Suite entries default to `kind: "test"` and `target: <suite name>`. The library entry
uses `kind: "lib", target: "percolator_prog"`; it compiles with standard
`cargo +1.95.0 test --locked --lib --no-run --message-format=json`, with the same
single-job/zero-debug profile and `CARGO_PROFILE_TEST_CODEGEN_UNITS=256`.
Canonical harness hashes use Cargo's source path, including `src/v16_program.rs` for
the library. Intact integration targets use the existing `cargo rustc --test` path.

The explicit `separate_targets` roster records `v16-kani` as requiring feature `kani`.
That roster must exactly match default-disabled test targets; it cannot hide a target
enabled by default features. Kani proofs and rustdoc tests are separate qualifications,
not passing exclusions in this gate. Metadata retains the library's `doctest` flag;
the pinned wrapper source has no runnable documentation examples. The two examples
marked `test = false` are reported in inventory, not counted as executed tests.

The four SBF programs build once, with locked dependencies, cargo-build-sbf 4.6.0,
platform-tools v1.52 and the v0 architecture required by the pinned LiteSVM 0.1
harnesses. All shards verify the same source identities and artifact hashes before
and after execution. **This legacy-SVM test gate is not current-cluster deployment
qualification, an audit, or proof of mainnet readiness.**

## Exact coverage and failures

Each shard saves the complete `--list` inventory, its assigned names, each test's
exit status and log digest, the generated harness digest, source pins, and SBF hashes.
The content identity also binds every tracked `protocol/` path and its actual bytes,
including the native lifecycle harness, JavaScript driver, and package lock. Its
SHA256 uses sorted UTF-8 paths with explicit path/content lengths; the report retains
each file's path, length, and SHA256. Git revision and working-copy status are recorded
separately as metadata. A documentation-only successor can therefore verify identical
content evidence while retaining the revision that actually executed each shard.

The program attestation records the canonical harness and driver hashes for every
configured shard. CU hashes are computed from the exact wrapper source without writing
generated files; intact integration suites use their original source bytes; native
lifecycle uses this repository's lifecycle and driver bytes. Each shard verifies that
complete map before compilation and checks wrapper source, protocol content, and the
canonical map again after execution. The aggregate job fetches the exact candidate and
recomputes the map independently, rejecting matching reports that claim a different
harness or driver. A changed protocol file cannot reuse an older attestation.

Tests run with `--exact --include-ignored --nocapture --test-threads=1`: an ignored
test cannot become a silent skip. Each invocation must report exactly one pass and
zero failures/ignored tests. Normal failures and individual timeouts do not stop
the remaining tests in that shard. A test has a 30-minute deadline; compilation has
a 90-minute deadline; each shard job has a 180-minute deadline. Any timeout is a
failure, never a passing exclusion.

The aggregate job requires all expected shard reports, complete module ownership,
matching source/artifact identities, agreement between full-suite listings, exact
equality between registered names and executed names, no duplicate execution, and
all passing results. Missing reports, interrupted jobs, compilation errors, empty
shards and failure logs keep the gate red. `fail-fast: false` retains independent
results after another shard fails. Artifacts are retained for fourteen days.

## Reproduction

From this repository, with Python 3 and Git available:

```sh
python3 -m unittest discover -s scripts/tests -p test_wrapper_qualification.py -v
python3 scripts/wrapper_qualification.py matrix
python3 scripts/wrapper_qualification.py fetch --workspace /tmp/wrapper-sources
```

Install Rust 1.95.0 and cargo-build-sbf 4.6.0, then build each of `percolator-prog`,
its `tests/fixtures/auth_matcher` and `tests/fixtures/hostile_matcher`, and sibling
`percolator-match` using:

```sh
cargo +1.95.0 build-sbf --tools-version v1.52 --arch v0 -- --locked
```

Record the artifacts and execute a shard:

```sh
python3 scripts/wrapper_qualification.py attest --workspace /tmp/wrapper-sources --output /tmp/artifacts.json
python3 scripts/wrapper_qualification.py run --workspace /tmp/wrapper-sources --shard v16_cu-00 --artifacts /tmp/artifacts.json --output /tmp/results/v16_cu-00
```

Repeat for every ID emitted by `matrix`, preserving failed jobs' results. Then:

```sh
python3 scripts/wrapper_qualification.py aggregate --workspace /tmp/wrapper-sources --reports /tmp/results --output /tmp/wrapper-qualification.json
```

Aggregation requires the exact wrapper and matcher checkout and recorded source
tree, even when all test reports already exist. Historical overlay reports require
their original patched tree. SBF binaries are not required for
this independent source/harness comparison; their recorded hashes must agree across
all reports. Do not edit protocol files between attestation, shard execution, and
aggregation. Results from the previous identity format must be regenerated.

The result is valid only when the aggregate command succeeds. Do not treat an
individual green shard, successful compilation, or partial log as full qualification.
Install locked client dependencies with `npm ci --prefix protocol --ignore-scripts
--no-audit --no-fund` and Node.js 22 before running the native lifecycle shard.
