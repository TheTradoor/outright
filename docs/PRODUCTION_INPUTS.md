# Production setup inputs

Checked on **14 November 2026, 20:39 WIB**. No production wallet was loaded,
no transaction was signed and no mainnet funds were moved.

The current terminal has no enrolled deployment. Its published version is 31,
with owner-only access and no runtime environment variables configured. The
qualified program binary exists; production authorities, market parameters,
maker funding and operating services are not established by that artifact.

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

The [retained read-only RPC result](qualification/2026-11-14-keeper-discovery/mainnet-rent.json)
records a mainnet genesis check and `getMinimumBalanceForRentExemption` calls.
It is a dated observation for the stated account sizes, not a transaction-cost
quote or a request to transfer funds.

| Account | Data bytes | Rent-exempt lamports | SOL |
| --- | ---: | ---: | ---: |
| Upgradeable program account | 36 | 833,120 | 0.000833120 |
| ProgramData at exact binary length | 1,270,981 | 6,457,233,720 | 6.457233720 |
| Upload buffer at exact binary length | 1,270,973 | 6,457,193,080 | 6.457193080 |

The buffer is part of deployment staging. These rows do not specify when its
funds are reused or refunded by the selected deployment procedure. Extra program
capacity, transaction and priority fees, matcher deployment, market and token
accounts, oracle updates, keeper operations, maker liquidity and insurance are
excluded. Recalculate for the final deployment transaction plan and account
allocation before funding or signing.

The measured program is 1,270,936 bytes with SHA-256
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
Its [build record](qualification/2026-11-14-published-program/program-build-verification.json)
binds it to the published wrapper and unchanged Percolator engine.

RPC references:
[account rent](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption)
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
