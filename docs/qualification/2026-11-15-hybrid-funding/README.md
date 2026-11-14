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
remain open for the actual release configuration. No wallet was loaded and no
mainnet transaction was submitted.

[SHA256SUMS](SHA256SUMS) covers the retained local evidence.
