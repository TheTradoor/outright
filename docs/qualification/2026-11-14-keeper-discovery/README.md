# Keeper discovery verification

The client revision is `58a4e0781648fd5a4711b227d272a84e299ec3a7`,
[PR #31](https://github.com/TheTradoor/outright/pull/31). GitHub tested merge
`450f51442a3bfc953b09b51f62c9c3607c2f5d92`, whose tree
`6414a9f1f80faed6f06f261e81b6867070d4c928` equals the client tree.

The wrapper remains `72dd8948b116e9e16a85c830e1e2a7915f12d542`,
source tree `8b54b827082b2b838beacd88d4d99bd12878d2ca`. The actual
Percolator engine remains `a712af767eeb217876a3d3c50e3849b60ea54462`.
No engine, wrapper, instruction, account-layout or custody change is included.

All [51 checks](pr-checks.json) passed before merge as
`1161b54094498ce23a287d2d2340e52d8cae68a3`; its tree equals the tested tree.
Complete wrapper [run 43600724725](https://github.com/TheTradoor/outright/actions/runs/43600724725)
passed all 37 shards, 2,120 executions and the final aggregate. The
[original artifact packet](wrapper-evidence.tar.gz) retains all 39 ZIPs and
their GitHub metadata. The [aggregate](wrapper-qualification.json) is retained
separately for review.

[verify_evidence.py](verify_evidence.py) checks every artifact digest, all 2,120
raw test-log digests, current source identity, all four SBF binary digests,
shard assignments, coverage records and agreement with the CI aggregate. It
does not rerun Rust tests or locally reproduce the Cargo inventory. Run:

```sh
python3 docs/qualification/2026-11-14-keeper-discovery/verify_evidence.py
```

All four v0 program/matcher hashes also match the previous qualified build.

| Check | Result | Evidence |
| --- | --- | --- |
| Native client, Rust conformance, source equivalence and terminal build | 525 passed; zero failed, skipped or cancelled | [CI log](native-client.log), [run 43600724705](https://github.com/TheTradoor/outright/actions/runs/43600724705) |
| Application SBF lifecycle | 17 passed; zero failed, ignored or filtered; 32.50 seconds | [CI log](native-svm.log), [run 43600724678](https://github.com/TheTradoor/outright/actions/runs/43600724678) |
| Native current-validator lifecycle and discovery | Seven confirmed transactions; discovery observes one then two portfolios; overflow rejected | [Report](native-validator-report.json), [CI log](native-validator.log), [run 43600724703](https://github.com/TheTradoor/outright/actions/runs/43600724703) |
| Independently attested current-validator lifecycle | Seven confirmed transactions in 25.717 seconds; source and artifact identities checked | [Report](candidate-report.json), [attestation](candidate-attestation.json), [summary](candidate-summary.json), [original artifact](candidate-current-validator.zip), [run 43600724665](https://github.com/TheTradoor/outright/actions/runs/43600724665) |
| Local client and qualification verifiers | 525 client tests and 53 verifier tests passed | [Client log](client-local.log), [verifier log](verifier-local.log) |

The added 29 client cases exercise durable discovery sweeps, additions,
closures and reinitialization; receipt reconciliation during scan outages;
fee/duplicate protection across scans and restart; stale/malformed/oversized RPC
responses; and independent CLI processes. Both static-target configuration and
opt-in discovery remain available. There are 129 keeper tests in the full suite.

Validator tests use Agave 4.4.1, platform-tools v1.58 and SBPF v3. Initial and
final trader collateral are 1,000,000,000 atoms, final trader capital is zero,
and maker capital is 10,000,000,000 atoms. They use synthetic TEST collateral,
a controlled price and generated local signers. The legacy SBF suite uses its
separate v0 build. Test counts overlap and are not independent production cases.

The downloaded candidate-validator artifact matches GitHub SHA256
`c19364d8965d3e7bf2dc3289a242f4caaa99ec600f4219de482218a681db56d6`.
The current report verifier checked the exact source identity, tested tree,
binary hashes and transaction/balance report. The v3 program hash remains
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`;
the earlier independently reproduced binary is retained in the
[published-program packet](../2026-11-14-published-program/README.md).

The [read-only mainnet observation](mainnet-rent.json) records network genesis
and rent for exact account sizes. It is not a deployment, funding request or
complete launch budget. [Production setup inputs](../../PRODUCTION_INPUTS.md)
records its limits and the remaining operator decisions.

The hosted profile remains null. No mainnet transaction, funded production
counterparty, hosted oracle/keeper, physical-wallet acceptance or independent
security review is established by these results.

The [website publication record](site-publication.json) confirms successful version
31 deployment from `1517db4e58f0fb51ceedb3e7d8ffed5577e6e32f`. All 67 canonical
protocol files match this qualified client; 17 routes, 754 links/assets, four
mechanics tests and 525 client tests passed. Access remains owner-only. This
update did not repeat browser visual QA or physical-wallet acceptance.
