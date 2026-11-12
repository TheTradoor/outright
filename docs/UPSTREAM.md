# Upstream sources

Outright is a direct fork of
[`aeyakovenko/percolator`](https://github.com/aeyakovenko/percolator).
Its engine baseline is recorded below.

| Source | Revision | Role |
| --- | --- | --- |
| [Percolator](https://github.com/aeyakovenko/percolator/tree/b22bef7d6122fd7d82680ce9859e8b77fd8ef656) | `b22bef7d6122fd7d82680ce9859e8b77fd8ef656` | Risk engine present in this repository |
| [Percolator program](https://github.com/aeyakovenko/percolator-prog/tree/b42fe017c2bc953778f90d0cb85cd1d426b6e783) | `b42fe017c2bc953778f90d0cb85cd1d426b6e783` | Pinned wrapper for host conformance and local SBF tests |

The normative engine contract is [spec.md](../spec.md), v16.9.1, together with
the pinned source and tests. The wrapper is a separate upstream repository;
the native client depends on its pinned revision. No public Outright program
has been deployed.

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
git diff b22bef7d6122fd7d82680ce9859e8b77fd8ef656 -- \
  src tests spec.md Cargo.toml Cargo.lock LICENSE .cargo scripts kani-list.json
```

This comparison should be empty until an engine change is deliberately adopted.
Changes to the root README, project guides, CI and toolchain selection are
maintained separately from the engine source.
