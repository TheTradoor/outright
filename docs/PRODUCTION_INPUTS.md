# Production setup inputs

Checked on **15 November 2026, 21:59 WIB**. No production wallet was loaded,
no transaction was signed and no mainnet funds were moved.

The current terminal has no enrolled deployment. The website was updated to
[version 34](qualification/2026-11-15-upstream-accounting/README.md#website-publication) on 15 November 2026,
with owner-only access and the unchanged runtime environment revision. The
updated program passed current-validator qualification and its independent build
reproduces the same binary. Final production allocation remains open. Production
authorities, market parameters, maker funding and operating services are not
established by that result.

On 15 November 2026, [Pyth Core inspection](ORACLE_OPERATIONS.md) was added and
verified against a real mainnet SOL/USD observation and the published wrapper.
This supplies feed and policy diagnostics before enrollment. No price publisher,
production fee payer or hosting service was configured by that work.

## Required inputs and resulting work

| Input | Current state | Work it enables |
| --- | --- | --- |
| Public deployer and authority addresses; signing custody arrangement | Not recorded | Prepare deployment transactions bound to the selected program, verify their costs, and obtain signatures through the operator's wallet. Keep seed phrases and private keys out of chat and the repository. |
| Deployment SOL allocation and keeper fee allowance | Not recorded | Fund program/market creation and a separate operating fee payer with explicit spending caps. Account rent is only part of the requirement. |
| Maker collateral commitment and insurance policy | Not recorded | Select and verify funded counterparties, inventory limits, maker consent and backing. The synthetic TEST allocation is excluded. |
| Production matcher selection and quoting policy | Not enrolled | Pin and review the actual matcher, context ownership, spread/size/inventory policy and backing-fee cap. Existing lifecycle tests use the upstream `tests/fixtures/auth_matcher`; testing it does not approve a production market-making policy. |
| SOL/USD and USDC market configuration | Product candidate only | Confirm collateral/feed identities and set reviewed margin, leverage, OI, size, funding, fee and exit parameters; run the production risk scenarios against those values. |
| RPC, oracle publisher and operating host | Not configured | Provision authenticated observations, run the keeper with durable storage, set alerts, and exercise restart, stale-feed and provider-failure recovery. Portfolio discovery is implemented in PR #31; hosting acceptance remains separate. |
| Security review and supported wallet/device combinations | Not completed | Review the exact release and directly exercise the funded lifecycle, rejection, interruption, recovery and permissionless exits on desktop and a physical phone. |

The first funding/custody discussion needs public addresses and budgets, not
secret keys. The operator must retain control of deployment, upgrade and market
authority signatures. No default authority, liquidity amount or leverage is
inferred from the test fixture.

## Observed account rent

The [current read-only RPC result](qualification/2026-11-15-program-rebuild/mainnet-rent.json)
records a mainnet genesis check and rent queries on 15 November 2026 at
21:58-21:59 WIB. The independently reproduced program is 1,283,424 bytes with
SHA-256 `93c73f13ad0d79373d81a556b0a8f9f16e87799a3332f2f9f18558382d96e6a4`.
[Build evidence and scope](qualification/2026-11-15-program-rebuild/README.md).

| Account | Data bytes | Rent-exempt lamports | SOL |
| --- | ---: | ---: | ---: |
| program | 36 | 833,120 | 0.000833120 |
| programData | 1,283,469 | 6,520,672,760 | 6.520672760 |
| uploadBuffer | 1,283,461 | 6,520,632,120 | 6.520632120 |
| market | 3,035 | 16,068,040 | 0.016068040 |
| portfolio | 9,563 | 49,230,280 | 0.049230280 |
| splTokenAccount | 165 | 1,488,440 | 0.001488440 |

These values describe an exact-binary-length scenario with no extra upgrade
capacity. Final program capacity is not selected. The staging buffer is not an
additional permanent account; the deployment procedure determines reuse and
refunds. Do not sum those rows as an approved deployment budget.

Fees, a production matcher, oracle updates, keeper operations, maker liquidity
and insurance are excluded. Market, portfolio and token-account figures are
per account. Recalculate against the final deployment transaction plan before
funding or signing.
No signer was loaded and no transaction was submitted.

The [November 14 observation](qualification/2026-11-14-keeper-discovery/mainnet-rent.json)
belongs to the previous 1,270,936-byte binary and remains historical evidence.
RPC references: [account rent](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)
and [program deployment](https://solana.com/docs/programs/deploying).

## Release sequence

1. Record the production inputs and custody policy above.
2. Implement and verify the selected oracle, matcher and market configuration;
   complete risk and independent security review for those exact components.
3. Prepare the funded deployment and operating services; verify deployed bytes,
   authorities, accounts and budgets before enrolling a terminal profile.
4. Complete actual desktop/mobile and outage acceptance against that release.
5. Publish the official market profile and public access only after the release
   evidence supports accepting deposits.

Traders receive the normal terminal. They do not supply any operator configuration,
RPC settings, oracle service or deployment file.
