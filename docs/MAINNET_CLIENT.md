# Mainnet client and published program source

The merged client implements mainnet network validation, wallet account
selection, explicit signing-chain requests and transaction links, and adopts the
published repaired program fork. It does not
enroll a production market or enable the hosted terminal. The bundled
`protocol/terminal/deployment.json` remains `null`.

## Implemented behavior

| Surface | Mainnet behavior |
| --- | --- |
| Profile and read-only enrollment | Accept `mainnet-beta` only with the complete mainnet genesis hash and an HTTPS RPC without embedded username/password. Existing source, program-byte, authority, mint, vault and market checks remain required. Enrollment rejects an unsupported network or invalid endpoint before reading program artifacts. |
| Account selection | Require the account to advertise `solana:mainnet` and versioned transaction signing. A devnet-only account cannot connect to a mainnet profile. Losing mainnet chain support clears the session. |
| Wallet request | Explicitly request `solana:mainnet`. Devnet continues to request `solana:devnet`; localnet retains the existing omitted-chain behavior for compatibility. |
| Review boundary | Recheck RPC genesis before prompting the signer, then check review expiry and session revision. The existing post-signature verified snapshot still rechecks network, deployed code and current state before any broadcast. |
| Receipt | Use the explorer's default mainnet route. Never include the production RPC URL or its provider query parameters in a third-party transaction link. |
| Trader wording | A configured mainnet profile identifies real funds. Localnet and devnet continue to identify test funds. Missing deployment configuration retains the unavailable/retry flow. |
| Localnet isolation | A loopback URL cannot label a known mainnet, devnet or testnet genesis as localnet. Mainnet chain selection cannot be bypassed by relabeling a public RPC proxy. |
| Keeper | A mainnet deployment retains the public-network hybrid-oracle requirement; the local fixed-price mode remains rejected. |

The earlier before-sign behavior was reproduced with a deterministic RPC that
changed genesis after preparation: the wallet callback was still reached, even
though the existing post-signature check would block broadcast. The added
pre-signature check stops that unnecessary request. A failed or stale review
remains single-use and must be prepared again.

## Verification scope

The runtime source lock, Rust conformance dependency, generated contract and both
SBF/validator build paths use published program commit
`cfcc3f7b005faea0ff2caeb39bc87a48f75d8761`, tree
`49f987d4963083b9befb3f92cf813fc656dcd02c`, with unchanged upstream engine
`5e3af0710ec7e9b7077393012f8a94a31b2f07ef`. The Rust exporter matches the
client contract; only source identities changed in the adoption. Qualification
requires the same published revision and tree without an overlay. Its source guard
rejects mismatched pins, missing tree identity and staged program modifications.

PR #41 passed all 51 checks before merge: 607 client tests, 19 application SBF
cases, both seven-transaction current-validator paths and 2,137 wrapper executions
across 37 shards. The 53-test verifier suite passes locally. All 39 wrapper
archives and 2,137 raw logs are retained and independently checked. See the
[current validation record](qualification/2026-11-15-upstream-accounting/README.md).
The results below describe the earlier mainnet-client snapshot and retain their
original scope.

The complete native client suite passed **495/495**, with zero failures, skips or
cancellations. The focused network/terminal suite passed **18/18** (included in
the complete count). The engine source identity check, exact Rust contract
comparison and production terminal build passed. These are local checks for this
earlier snapshot; they are not CI or mainnet acceptance results.

The updated client also passed **17/17** application lifecycle cases against the
repaired-candidate SBF in LiteSVM, in 69.06 seconds, with no failed, ignored or
filtered cases. These exercise custody, withdrawal, liquidation, recovery and
atomic rollback with synthetic localnet accounts. The exact protocol identity,
checked host compiler profile and all four SBF hashes are recorded in the
[result](qualification/2026-11-14-mainnet-client/candidate-sbf-result.json).
The qualification report verifier passed **51/51** tests. Complete logs and
checksums are retained beside the [validation record](qualification/2026-11-14-mainnet-client/validation.json).

`protocol/tests/network.test.mjs` checks accepted mainnet profiles, wrong and
truncated genesis hashes, HTTPS and credential requirements, localnet proxy
mislabeling, unsupported networks, explorer privacy, rejection before account
reads/signing, early CLI validation, the unchanged null deployment and the
keeper's manual-oracle rejection.

`protocol/tests/terminal-networks.test.mjs` runs the real terminal module with
deterministic RPC responses and a local fixture signer. It covers normal trader
startup, rejection of a devnet-only account, the actual mainnet signing request,
one fixture submission, the receipt URL and disconnection after a chain change.
This is DOM coverage, not a physical wallet, browser extension or mainnet test.

Client and integration scenarios use synthetic accounts, fixture RPC responses
or LiteSVM. No production signature, deployment or transfer is created. The
complete wrapper qualification for PR #25 passed **2,120/2,120** executions in
37 shards and its aggregate, at the original source `9191c881…` and tested merge
`43ee4808…`. [Its evidence](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md)
does not apply to the changed protocol bytes. Their separate qualification is
[run 43570649236](https://github.com/TheTradoor/outright/actions/runs/43570649236),
which passed before the exact tested tree was merged as
`3bfbe078c1493764bcb56bffc384dea99f5db55b`.

## Remaining release work

PROD-06 remains open for the exact reviewed production deployment, public
profile, real oracle and operational services, funded execution and fresh
desktop/mobile acceptance. Fork publication and the affected requalification
of the client and adopted source are complete. Independent security review and the other requirements in
[MAINNET_RELEASE.md](MAINNET_RELEASE.md) remain separate requirements.

Network constants follow the published
[Solana cluster identities](https://beta.docs.solanalabs.com/clusters/available)
and [mainnet chain reference](https://ercs.ethereum.org/ERCS/erc-7930).
Wallet chain names follow the
[Wallet Standard Solana extension](https://github.com/wallet-standard/wallet-standard/blob/master/extensions/solana.md).
