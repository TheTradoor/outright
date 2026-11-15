# November 15 upstream accounting integration

This packet records merged [application PR #41](https://github.com/TheTradoor/outright/pull/41) and [program PR #2](https://github.com/TheTradoor/outright-program/pull/2). Mainnet trading is
not open. No production deployment, authority signature or funds are involved.

## Sources

| Component | Exact identity |
| --- | --- |
| Application candidate | `7fef978012ca24fee7468c8d35416f4b3d9f10a7` |
| Tested PR merge | `1cb3d8fff140f0594ddfcce7acea2ba724935ac3` |
| Published application merge | `518eb3acfb9667aaa899eeb86835d0cd4f1020a5` |
| Published program merge | `162e73edb4f411d18907a9516e8c2808879935bc` |
| Application tree | `315c274942622526cb0e9d644f13f0aa4bd44861` |
| Percolator engine | `5e3af0710ec7e9b7077393012f8a94a31b2f07ef` |
| Program candidate | `cfcc3f7b005faea0ff2caeb39bc87a48f75d8761` |
| Program tree | `49f987d4963083b9befb3f92cf813fc656dcd02c` |
| Program upstream | `7b11091328de23cded2e4afe96592bbd060a6828` |

Nine upstream engine commits and eleven upstream program commits are retained
as ancestors, preserving authors and history. Engine source, specification,
tests and build inputs match upstream exactly. `retained-recovery.patch` records
the eight-line Recovery correction that remains in the wrapper. Existing
Outright fixture and reference-model repairs are also retained.

## Reviewed behavior

- Resolved closes clear a repaid pending ledger and start a new ledger when a
  later loss arrives after the previous close finalized.
- A certified liquidation deficit first expires lapsed backing behind claims
  that liquidation needs to value, then recertifies the account.
- Counterparty backing behind liened face burned for a Live loss follows that
  loss to its source domain. Batched accounting preserves the original epoch
  increments while reducing repeated ledger work.
- Provider withdrawals cannot take loser-paid backing before the winner is
  refreshed. Wrapper value exits inspect unsettled positions on their own asset.
- A late resolved loss repays provider principal that funded the gain before the
  payout snapshot is captured, within the receivable and principal limits.
- Single and batch trade admission bound liened-claim refresh work. Existing
  portfolios may still reduce or preserve that work.

## Remote results

Local checks passed 607 client tests, 53 verifier tests, exact engine equivalence
and the terminal build. CI passed 406 default engine tests and 474 fuzz-feature
tests; these suites overlap. Six new regression files account for 35 tests,
listed in `engine-regressions.json`. The Rust exporter matches the generated
client contract after changing only the two source identities. All 31 shared
oracle vectors and all 607 client tests pass in that CI run.

The application SBF suite passed 19 cases with zero failed, ignored or filtered
cases in 58.85 seconds. Both current-validator paths completed seven confirmed
transactions and reconciled 1,000,000,000 starting/final collateral atoms, zero
final trader capital and 10,000,000,000 maker capital. These use a controlled
fixed-price TEST market, not production liquidity or a live authenticated feed.
Candidate validator lifecycle duration: 25.762 seconds.

[Complete wrapper qualification](https://github.com/TheTradoor/outright/actions/runs/43710363768)
passed all 37 shards and all 2,137 executions. The aggregate passes, with every
registered test assigned and executed exactly once within its Cargo target.
All 15 new wrapper CU cases pass. All 51 reported checks passed before merge;
both published source trees match their qualified trees. PR #39 retains its
separate source identity and results.

| Scope | Recorded run | Result |
| --- | --- | --- |
| Engine | [43710363763](https://github.com/TheTradoor/outright/actions/runs/43710363763) | 406 default; 474 fuzz-feature; overlapping suites |
| Native client and Rust contract | [43710363733](https://github.com/TheTradoor/outright/actions/runs/43710363733) | 607 client tests; exact exporter match; 31 shared oracle vectors |
| Native SBF | [43710363748](https://github.com/TheTradoor/outright/actions/runs/43710363748) | 19 passed; no failed, ignored or filtered cases |
| Native validator | [43710363791](https://github.com/TheTradoor/outright/actions/runs/43710363791) | Seven confirmed transactions and exact balances |
| Candidate current-validator | [43710363793](https://github.com/TheTradoor/outright/actions/runs/43710363793) | Seven confirmed transactions with source and artifact attestation |
| Complete wrapper | [43710363768](https://github.com/TheTradoor/outright/actions/runs/43710363768) | 37 shards, 2,137 executions, aggregate passed |

## Artifact verification

`wrapper-evidence.tar.gz` retains all 39 wrapper artifacts and their GitHub
metadata: 37 result archives, four compiled program binaries, and the aggregate.
Each of the 2,137 raw test logs is retained. The verifier checks every ZIP digest,
raw-log digest and successful execution, the complete registered test inventory,
source/worktree identities, host executable hashes, harness inventory, binary
hashes and aggregate records. Duplicate, missing or foreign-source results fail.

The separate candidate-validator archive adds a fortieth artifact. Its digest,
exact client commit/tree, all 81 protocol files, pinned toolchain, harness hashes,
program hash and seven-transaction balance report were independently checked.
`ci-verification.json` records all 51 successful checks and both merge identities.
The wrapper and current-validator builds use distinct SBPF targets; their
program hashes are not claimed equal.

The new SBPF v3 program SHA-256 is
`93c73f13ad0d79373d81a556b0a8f9f16e87799a3332f2f9f18558382d96e6a4`.
The earlier BUILD-01 reproduction applies to the previous binary. Independent
reproduction of this new binary remains open until separately established.

## Website source correction

The engine documentation linked to specification revision `51c54ee2` while the
website recorded a newer engine revision. `site-source-before.log` retains the
new gate failing on that page. The URL now derives from `ENGINE_REV`; website
checks compare the normative specification URL and all recorded protocol file
hashes with the client source lock. Build, 20 routes, 994 local links/assets and
four mechanics tests pass. The terminal retry state and corrected specification
link were checked in Chromium. `browser-check.json` records that scope; physical
wallet acceptance remains open. Website publication is recorded below.

## Scope

These are development qualification results, not independent security review
or production acceptance. Reviewed market parameters, funded maker/backing,
production authorities, hosting, live oracle publishing, operational acceptance,
physical wallet testing and final enrollment remain open.

## Recheck the retained evidence

From the application repository root:

```sh
python3 docs/qualification/2026-11-15-upstream-accounting/verify_remote_evidence.py
(cd docs/qualification/2026-11-15-upstream-accounting && sha256sum -c SHA256SUMS)
```

This verifies retained artifacts and their source bindings. It does not rerun the
Rust suites locally. The verifier requires the recorded protocol/qualification
sources; a later incompatible source should use this recorded checkout.

## Website publication

[Outright version 34](https://outright.bollish-eth.chatgpt.site/docs/updates/#upstream-accounting)
was published from Site source `aee9c4a111f0713066b11fc61cbb21a0861b54cb`.
All 81 copied protocol files match merged application `518eb3ac`. The homepage,
Updates, development status, checklist and source references include this adoption.
Current operator-guide links follow master, while the client, engine and program
identities remain pinned explicitly.

The final build and route checks pass: 20 pages, 994 local links/assets. The same
canonical client passed all 607 tests; all four mechanics tests also passed.
Chromium verified the corrected specification URL, search results and navigation,
and the terminal's unavailable/retry state with trade and deposit disabled. The
published update was then observed at the live URL. The screenshot is retained as
`site-update-v34.jpg`; `site-publication.json` records deployment, source and
archive identities. Site access remains owner-only, environment revision zero,
and the official deployment profile remains `null`.
