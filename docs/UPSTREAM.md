# Upstream sources

Outright is a direct fork of
[`aeyakovenko/percolator`](https://github.com/aeyakovenko/percolator).
Its engine baseline is recorded below.

| Source | Revision | Role |
| --- | --- | --- |
| [Percolator](https://github.com/aeyakovenko/percolator/tree/5e3af0710ec7e9b7077393012f8a94a31b2f07ef) | `5e3af0710ec7e9b7077393012f8a94a31b2f07ef` | Risk engine present in this repository |
| [Published program fork](https://github.com/TheTradoor/outright-program/tree/cfcc3f7b005faea0ff2caeb39bc87a48f75d8761) | `cfcc3f7b005faea0ff2caeb39bc87a48f75d8761` | Runtime, conformance, SBF and qualification source; exact tree `49f987d4963083b9befb3f92cf813fc656dcd02c` |
| [Percolator program upstream base](https://github.com/aeyakovenko/percolator-prog/tree/7b11091328de23cded2e4afe96592bbd060a6828) | `7b11091328de23cded2e4afe96592bbd060a6828` | Latest upstream program merged with the retained Outright repairs |

The normative engine contract is [spec.md](../spec.md), v16.9.1, together with
the pinned source and tests. The wrapper is retained in a separate program fork;
the native client depends on its published pinned revision. No public Outright program
has been deployed.

## November 15 source update

The update merges nine engine commits through `5e3af071` and eleven program
commits through `7b110913`, preserving their authors and history. The program
merge is [PR #2](https://github.com/TheTradoor/outright-program/pull/2).
The engine implementation, specification and upstream tests match the pinned
engine exactly. The program retains Outright's Recovery observation correction
and fixture/model repairs.

The update addresses resolved-close ledgers after repaid or later losses,
liquidation behind lapsed backing, backing transfers for losses paid by liened
claims, and repayment of provider principal after a late resolved loss. Live
provider withdrawals cannot take a loser's payment before a winner settles.
The wrapper also checks unsettled positions on the exit's own asset and limits
trade admission by the work required to refresh liened claims, including batches.

No account-layout or instruction-encoding change was found in the source diff.
The conformance export changes only its source identities and matches the Rust
exporter byte for byte. Application PR #41 passed all 51 checks before merge,
including 2,137 wrapper executions, 607 client tests, 19 SBF cases and both
seven-transaction validator paths. Published trees match the qualified sources.
The complete artifact and raw-log packet is retained in
[the November 15 integration record](qualification/2026-11-15-upstream-accounting/README.md).
No deployment profile is enrolled.

## November 14 source update

The engine was advanced by merging the 13 upstream commits through `a712af76`,
preserving their authors and history. The matching wrapper revision is
`357157e6`; its dependency pin adopts this engine. Outright's engine source,
specification and upstream tests match that revision exactly.

The update includes upstream fixes for:

- #132: closing a dead leg removes only the effective open interest remaining
  on its side, including zero after earlier exits.
- #175 and #252: realized funding/mark losses and source claims are attributed
  to the domain owed the loss; same-domain fully backed claims can cancel debt.
- #243: a live account refresh expires lapsed backing in active legs' latent
  source domains, as well as domains already holding claims.
- #250: lien-covered face and pledged backing leave the credit-rate calculation
  together, while the provider withdrawal watermark remains conservative.
- #251: a zero-conversion claim can wait without rolling back earlier close
  progress; permanently sub-atom claims can retire when the domain is final.

The Rust conformance export is unchanged except for its two source revision
fields. No account-layout or instruction-encoding migration is introduced.
Older deployment profiles deliberately fail the release check: an operator must
verify newly built program bytes and enroll a new profile.

The original wrapper reported nine failing cases. The repair record preserves
their reproductions, distinguishes program changes from fixture/model corrections,
and retains the complete 2,120-execution passing qualification at its original
source identity. The published fork contains the exact qualified tree. Adoption
changes the wrapper revision metadata only; all generated account layouts and
instruction encodings match the Rust export. See the [repair checklist](REPAIR_CHECKLIST.md)
for the affected checks on the current client.

Both upstream repositories identify their code as unaudited research, not a
production release. Passing test gates does not complete independent review or
the other [mainnet release requirements](MAINNET_RELEASE.md).

## Attribution

The engine was created by Anatoly Yakovenko and includes work from upstream
contributors. Its Git history, source files, specification, test suite and
Apache-2.0 license are retained. [ENGINE.md](../ENGINE.md) preserves the
upstream README verbatim at the engine baseline. Outright's root README and
project documentation describe this fork's product work.

Outright is independent. Compatibility with upstream code does not imply
approval or endorsement by its author.

Pppercolator informed the product reference. Its terminal, simulator,
Hyperliquid client, launchpad and token are not part of this repository or its
runtime dependencies.

## Compatibility policy

The Rust package remains named `percolator` so consumers can retain the upstream
API. Product branding must not rename engine types or alter account layouts.

An engine or wrapper update must record the new full commit, review the source
diff and repeat the applicable tests. The native adapter checks instruction
bytes and account layouts against that exact wrapper revision. The host exporter
uses the engine in this checkout; the SBF runner verifies source equivalence
before using the same pinned upstream engine dependency. Update generated
fixtures only after reviewing the source change that requires them.

Compare the engine with the baseline from the repository root:

```sh
git diff 5e3af0710ec7e9b7077393012f8a94a31b2f07ef -- \
  src tests spec.md Cargo.toml Cargo.lock LICENSE .cargo build.rs kani-list.json
```

This comparison should be empty until an engine change is deliberately adopted.
Application qualification scripts, the root README, project guides, CI and toolchain selection are
maintained separately from the engine source.
