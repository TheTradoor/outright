# Upstream sources

Outright is a direct fork of
[`aeyakovenko/percolator`](https://github.com/aeyakovenko/percolator).
Its engine baseline is recorded below.

| Source | Revision | Role |
| --- | --- | --- |
| [Percolator](https://github.com/aeyakovenko/percolator/tree/a712af767eeb217876a3d3c50e3849b60ea54462) | `a712af767eeb217876a3d3c50e3849b60ea54462` | Risk engine present in this repository |
| [Published program fork](https://github.com/TheTradoor/outright-program/tree/72dd8948b116e9e16a85c830e1e2a7915f12d542) | `72dd8948b116e9e16a85c830e1e2a7915f12d542` | Runtime, conformance, SBF and qualification source; exact tree `8b54b827082b2b838beacd88d4d99bd12878d2ca` |
| [Percolator program upstream base](https://github.com/aeyakovenko/percolator-prog/tree/357157e6e14d1d10ce78a995d5d50bb3c1f2ae13) | `357157e6e14d1d10ce78a995d5d50bb3c1f2ae13` | Original source and history retained by the program fork |

The normative engine contract is [spec.md](../spec.md), v16.9.1, together with
the pinned source and tests. The wrapper is retained in a separate program fork;
the native client depends on its published pinned revision. No public Outright program
has been deployed.

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
git diff a712af767eeb217876a3d3c50e3849b60ea54462 -- \
  src tests spec.md Cargo.toml Cargo.lock LICENSE .cargo build.rs kani-list.json
```

This comparison should be empty until an engine change is deliberately adopted.
Application qualification scripts, the root README, project guides, CI and toolchain selection are
maintained separately from the engine source.
