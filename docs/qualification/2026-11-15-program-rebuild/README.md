# Updated program build and validator report correction

The published `outright-program` source was rebuilt independently after the
November 15 upstream accounting integration. The entire resulting SBPF v3 binary
has the same SHA-256 as the qualified candidate-validator program. The program
and engine sources are unchanged. No production deployment or funds were used.

## Reproduced program

| Component | Identity |
| --- | --- |
| Program commit | `cfcc3f7b005faea0ff2caeb39bc87a48f75d8761` |
| Published program merge | `162e73edb4f411d18907a9516e8c2808879935bc` |
| Program tree | `49f987d4963083b9befb3f92cf813fc656dcd02c` |
| Unchanged Percolator engine | `5e3af0710ec7e9b7077393012f8a94a31b2f07ef` |
| Binary size | 1,283,424 bytes |
| Full binary SHA-256 | `93c73f13ad0d79373d81a556b0a8f9f16e87799a3332f2f9f18558382d96e6a4` |
| Builder | Rust 1.95.0; cargo-build-sbf 4.6.0; platform-tools v1.58; SBPF v3 |
| Qualified runtime | Agave 4.4.1, [run 43710363793](https://github.com/TheTradoor/outright/actions/runs/43710363793) |

The source worktree was clean before and after the build. A separate build
output and freshly installed platform tools produced the binary. `Cargo.lock`
was honored. The public ELF is retained with lossless gzip compression; the
reported hash and size describe the decompressed file. No generated keypair is
included.

`program-build.log` retains both builder warnings: the inherited dual crate type
disables LTO, and post-processing reports `Invalid syscall code 9`. The original
qualified CI build emitted the same messages and passed the seven-transaction
validator lifecycle with this exact binary hash. These warnings were not hidden
or corrected by changing the program or build flags. Production-cluster
verification remains part of the deployment gate.

## Report-verification bug

The Python candidate report verifier checked that a deployed hash had 64
characters but did not compare it with the built artifact. A different 64-character
hash for either the program or the matcher passed. The JavaScript lifecycle
already checked the actual deployed bytes; the missing binding was in the
separate report acceptance step.

[PR #43](https://github.com/TheTradoor/outright/pull/43) requires canonical SHA-256
values, a complete binary inventory and equality between each named build and
deployed hash. It also rejects swapped identities and extra entries. Both false
acceptances were reproduced against the retained PR #41 report. The corrected
verifier rejects both substitutions and accepts the unchanged original report.

Local checks passed 59 verifier tests, including six new regression tests, and
607 client tests. Engine source equivalence, JavaScript harness syntax and the
terminal build passed. The logs and before/after reproduction records are
retained here. The previous 40 artifact digests and 2,137 wrapper logs were
reverified at their recorded source; those counts are not new test executions.

## Fresh CI and publication

PR #43 merged as `8ead6633ed02b09663212967ca9687bf9c425abd` after all five
reported checks passed. The default and fuzz engine jobs ran for both push and
pull-request events; those results overlap. The candidate-validator job built
both programs and completed all seven confirmed lifecycle transactions in
25.872 seconds. Final trader capital was zero, starting/final collateral was
1,000,000,000 atoms, and maker capital was 10,000,000,000 atoms.

[Run 43726866661](https://github.com/TheTradoor/outright/actions/runs/43726866661)
and `pr43-candidate-validator.zip` retain the new result. Its downloaded digest,
source identity, checker/harness hashes, complete binary hashes and balance
report were checked independently. Both binary hashes equal the earlier
qualified artifacts, and the program matches this separate local rebuild.

The run tested PR merge `9d758e046e2f312f467a8ba566dc86f306a1e697`, tree
`b62814ed449627fc495b8b3a21188e7e165e95fe`. PR #42 added documentation while the
run was executing. The published PR #43 tree therefore differs only under
`docs/`; execution sources are identical. This is not a claim of whole-tree
equality. The verifier checks the difference explicitly.

## Read-only mainnet rent observation

Observed on 15 November 2026 at 21:58-21:59 WIB. The RPC returned the mainnet
genesis hash and Solana Core 4.4.0. Finalized slots bracket the observation;
each rent response is recorded separately. No transaction was constructed,
signed or submitted.

| Account | Data bytes | Rent-exempt lamports | SOL |
| --- | ---: | ---: | ---: |
| program | 36 | 833,120 | 0.000833120 |
| programData | 1,283,469 | 6,520,672,760 | 6.520672760 |
| uploadBuffer | 1,283,461 | 6,520,632,120 | 6.520632120 |
| market | 3,035 | 16,068,040 | 0.016068040 |
| portfolio | 9,563 | 49,230,280 | 0.049230280 |
| splTokenAccount | 165 | 1,488,440 | 0.001488440 |

This is an exact-binary-length sizing scenario, with no additional upgrade
capacity. The ProgramData and buffer sizes add the upgradeable loader's 45-byte
and 37-byte metadata. Market and portfolio sizes come from the current generated
contract. SPL token-account rent is per account.

Do not add the upload-buffer and ProgramData rows as an assumed deployment bill.
The selected procedure determines staging, reuse and refunds. Transaction and
priority fees, a production matcher, operating services, liquidity and insurance
are excluded. Final program capacity, authorities and the funded transaction
plan remain open under PROD-02. This dated observation is not a transfer request.

## Recheck

From a checkout containing PR #43 and this packet:

```sh
python3 docs/qualification/2026-11-15-program-rebuild/verify.py
(cd docs/qualification/2026-11-15-program-rebuild && sha256sum -c SHA256SUMS)
```

The verifier checks the retained binary, source identities, original validator
artifact digest, historical harness hashes, original report, rejected hash
substitutions and rent account sizes. It does not repeat compilation or RPC calls.
The earlier packet remains bound to its original source and can be rechecked from
that recorded checkout.

BUILD-02 is complete for independent binary reproduction. Final allocation and
budget approval remain under PROD-02. Live oracle/keeper operation, selected
production risk parameters, funded execution/backing, independent review, real
wallet/mobile acceptance and release enrollment remain open.
