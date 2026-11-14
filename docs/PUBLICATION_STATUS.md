# Publication status

Updated: **14 November 2026 (Asia/Jakarta, UTC+7)**.

The GitHub write-access block is resolved. The existing installation now includes
`TheTradoor/outright-program` in its selected repositories. GitHub confirmed the
saved setting, and subsequent branch creation, blob/tree publication, PR creation
and merge succeeded through the authenticated integration.

| Work | Published result | Scope |
| --- | --- | --- |
| Program qualification and client freshness correction | [Outright PR #25](https://github.com/TheTradoor/outright/pull/25), merged as `c2df58efb9c1985078d0bbc2f3cc87bd2cb22b07` | All 48 reported checks passed before merge. The merge tree equals the checked source tree. |
| Complete qualification evidence | [Outright PR #27](https://github.com/TheTradoor/outright/pull/27), merged as `97a89a247032a3bcf97a164884af7ff48ca1fdfc` | All 58 documentation/evidence files published; all four triggered engine checks passed. Source tree `a1215cef75349e1f978ace27f90e60e5df0dff8a` matches the retained local package. |
| Mainnet client transport | [Outright PR #28](https://github.com/TheTradoor/outright/pull/28), head `5c8373ce5cc01d29f826ff6025da91f83e7f2320` | All 24 changed files published; tree `609b5042f12fc4af6279c900ec80011ca2c25892` matches the tested local source. Affected CI gates are running; do not treat this as release approval. |
| Repaired program fork | [Program PR #1](https://github.com/TheTradoor/outright-program/pull/1), merged as `dab351b19cd463a76b29178cbe1e9c2c485163d1` | Candidate commit `72dd8948b116e9e16a85c830e1e2a7915f12d542` and merge have the exact qualified tree `8b54b827082b2b838beacd88d4d99bd12878d2ca`. Upstream history, license and engine dependency are retained. |

The program-fork publication uses the existing evidence for the identical source
tree: 37 shards, 2,120 passing executions and a verified aggregate. It does not
claim a new test run in the fork. The complete evidence, including prior failed
attempts, is retained in the [qualified-run record](qualification/2026-11-14-repairs/checked-host-run-43563227621/README.md).

Before publishing the mainnet client, the native client suite was rerun:
**495 passed, zero failed, skipped or cancelled**. Source identity and terminal
build passed. The complete Python verifier suite passed **51/51**. An initial
rerun lacked local Node dependencies; restoring the existing dependency tree
after checking the unchanged lockfile resolved that setup failure without a
source change. Earlier 17/17 candidate-SBF evidence is retained in PR #28; it is
not relabeled as a new execution in this publication step.

## Remaining release work

- Finish PR #28's affected CI gates before merging its changed client bytes.
- Adopt the published program revision in the runtime source lock, generated
  contract and build paths; verify the affected integration and validator flows.
- Complete production deployment and authority custody, reviewed market/risk
  configuration, live oracle and keeper operations, funded liquidity,
  independent security review, and physical desktop/mobile wallet acceptance.

The hosted deployment profile remains `null`. Mainnet is not live and public
deposits are not enabled. Restoring GitHub access does not complete those release
requirements. See the [repair checklist](REPAIR_CHECKLIST.md) for their scope.
