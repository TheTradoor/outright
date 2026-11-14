# Hybrid funding and oracle outage verification

This follow-up extends the JavaScript keeper's SBF integration coverage. Engine,
wrapper, matcher, client runtime, instruction builders and custody code are
unchanged. The qualification manifest now requires all 19 application SBF tests.

## Local results

| Check | Result |
| --- | --- |
| Application SBF | 19 passed, zero failed, ignored or filtered; 24.66 seconds. [Log](svm-local.log). |
| Client | 594 passed, zero failed, cancelled or skipped. [Log](client-tests.log). |
| Qualification verifier | 41 passed. [Log](qualification-verifier.log). |
| Candidate verifier | 12 passed. [Log](candidate-verifier.log). |
| Source equivalence | Engine matches `a712af767eeb217876a3d3c50e3849b60ea54462`. Program remains `72dd8948b116e9e16a85c830e1e2a7915f12d542`. |
| Previous oracle merge | All 46 post-merge checks passed for PR #34. [Check identities](pr34-postmerge-checks.json). This is earlier-source evidence. |

[verification.json](verification.json) binds the modified harness, manifest and
unchanged runtime pins. Local execution used the retained, digest-verified
PR #34 SBPF v0 program and authenticated matcher, with Rust 1.95.0 and the current
JavaScript driver. It did not rebuild SBF locally. Native SVM and wrapper CI
rebuild those programs from the pinned sources for the published revision.
Remote results must retain their own exact revision; prior passing runs do not
qualify this changed harness.

## Remote results

[PR #36](https://github.com/TheTradoor/outright/pull/36) merged after all 51 checks
passed. Head `1d31c86bb2c497b0f67cff756f5fa9a305a83119` was tested at PR merge
`536fb39f90f5df1b9b9406f47eba2ced1d28a43d`. Published merge
`0c49df8518aee63bafc57fc35fb7f4e6a54aa4ae` has the identical complete tree,
`651a853825b9b35d8120cf19fa0166c258591145`.

| Check | Result |
| --- | --- |
| [Native client](https://github.com/TheTradoor/outright/actions/runs/43646089202) | 594 passed, zero failed, cancelled or skipped. All 31 shared oracle vectors match the actual Rust wrapper. Source equivalence, wire contract and terminal build passed. [Log](native-client.log). |
| [Native SBF](https://github.com/TheTradoor/outright/actions/runs/43646089235) | 19 passed, zero failed, ignored or filtered; 58.34 seconds. Both added Hybrid cases pass on rebuilt SBF. [Log](native-svm.log). |
| [Current validator](https://github.com/TheTradoor/outright/actions/runs/43646089181) | Seven confirmed lifecycle transactions, conserved test collateral, zero final trader capital, real RPC discovery and capacity rejection. [Log](native-validator.log). |
| [Candidate validator](https://github.com/TheTradoor/outright/actions/runs/43646089176) | Passed in 25.715 seconds. Downloaded digest, exact tree, 79 protocol file hashes, binary attestations and the seven-transaction report checked. [Archive](candidate-current-validator.zip). |
| [Full wrapper qualification](https://github.com/TheTradoor/outright/actions/runs/43646089193) | All 37 shards, 2,122 executions and aggregate passed. The application suite contains 19 cases, including both new Hybrid tests. [Aggregate](wrapper-qualification.json). |
| [Engine](https://github.com/TheTradoor/outright/actions/runs/43646089182) | Default and fuzz checks passed. |

[ci-verification.json](ci-verification.json) records all 51 checks and GitHub
digests for the three retained archives. The archive bytes match those digests;
the four SBF binary hashes match their attestation. The program and authenticated
matcher also match the retained binaries used for local testing. The aggregate
matches the current source identity, harness/target inventories, program hashes
and all 37 shard identities. Its eight suite lists total 2,122 executions.
Individual raw wrapper logs were not separately downloaded or independently
verified for this run.

The candidate validator's SBPF v3 binary is checked against its own attestation;
the full wrapper matrix uses its separately pinned v0 build. The candidate
program hash remains
`1fe81f6d8f31954b2abb56dd38650c1dcbfba2a39cbee9c7d6ae569595e3490e`.
Both validator paths use the synthetic fixed-price TEST market.

Recheck the retained evidence from the repository root:

```sh
python3 docs/qualification/2026-11-15-hybrid-funding/verify_remote_evidence.py
```

This reads the retained artifacts and current source; it does not rerun the
Rust or SBF tests. [remote-verification.log](remote-verification.log) records the
result. Documentation-only successors preserve the qualified protocol and
runner identity.

## What the added tests establish

The fixture configures Hybrid before opening positions, advances the public
bounded cranks, and establishes a one-atom mark premium through a paid
after-hours trade. It never edits market or portfolio bytes to create the
premium. Only external Pyth account bytes and the VM Clock are controlled.

Four funding traces cover positive and negative premiums with one 24-slot
settlement or two 12-slot settlements. The small price and 1 bps/slot movement
cap isolate funding from price PnL. The independent expectation is 2.962962936
collateral atoms: three charged to the debtor and two booked to the creditor.
Both schedules retain fractional carry and arrive at those exact amounts.

The split trace ignores a displaced stale quote and uses the retained mark.
Recovery to the original index preserves funding through the recovery boundary,
resets the premium, and adds no funding over the following 24 slots. The tests
also check exact funding indices, JavaScript account decoding, insurance and
capital totals, same-slot retries, SPL custody and mint supply. An invalid later
instruction must roll back an earlier successful funding settlement completely.

A separate case rejects stale data before and exactly at the ten-slot fallback
threshold, then permits fallback strictly after it. Wrong feed identity, wrong
owner, excessive confidence and partial verification remain errors after the
delay. Each rejection preserves the complete market, affected portfolios and
tracked token accounts; restoring only the external feed permits progress.

The [first development attempt](rejected-fixture-setup.log) tried to configure
Hybrid over existing exposure. The wrapper correctly rejected that setup with
`EngineLockActive`. The fixture was corrected to configure before trading and
reach the premium through public instructions. No production guard was relaxed.

## Remaining scope

These are controlled local-VM traces, not a live publisher or production risk
approval. They do not qualify every mark-movement/backing-fee path, real market
parameters, general insolvency or production matcher policy. QUAL-02 and OPS-01
remain open for the actual release configuration. No production wallet was
loaded and no mainnet transaction was submitted.

[SHA256SUMS](SHA256SUMS) covers the retained files.
