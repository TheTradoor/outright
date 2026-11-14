# Real-wallet acceptance runbook

**Status: not executed; desktop and physical-mobile acceptance remain unverified.**
This runbook originated at client revision `f6fd6e0bb8a66fc947d4b760dc4ce94dec57df2c`.
The hosted profile is `null`, so its wallet and transaction flow is currently
blocked by unavailable-market state. The implemented [mainnet client transport](MAINNET_CLIENT.md)
adds mainnet network and signing support; production enrollment and actual
mainnet wallet acceptance remain incomplete.
Automated DOM, generated-signer and validator results do not count as the
real-wallet executions below.

Track results against [WAL-02, WAL-03 and PROD-06 in the repair checklist](REPAIR_CHECKLIST.md#remaining-release-and-acceptance-work).
No wallet brand or version is claimed supported by this document.

## 1. Establish one reproducible environment

| Surface | Setup and current limit |
| --- | --- |
| Desktop extension | Provision the [funded local market](LOCAL_MARKET.md) on a machine where Agave can run; fund the external test wallet's public address using that guide. Serve the terminal locally. First use explicit operator mode to verify setup, then test a separate built copy with its verified public profile installed automatically and no `?operator=1`. Record which mode each case used. |
| Physical iPhone/mobile | Use an actual wallet browser and a reachable HTTPS test site/RPC for an initialized devnet market. Desktop `127.0.0.1` does not identify the desktop from a phone; localnet profiles cannot be changed to arbitrary LAN/public RPCs. This mobile environment has not been provisioned or exercised. |
| Hosted release | With the current `null` profile, verify only the unavailable/retry states. Do not count this as successful wallet acceptance. |
| Mainnet release | Blocked by [PROD-06](REPAIR_CHECKLIST.md#remaining-release-and-acceptance-work) and the [mainnet release requirements](MAINNET_RELEASE.md). Repeat acceptance on the exact enrolled production release after those requirements are satisfied. |

The ordinary local-market runner now requires the published repaired wrapper
`72dd8948b116e9e16a85c830e1e2a7915f12d542`, tree
`8b54b827082b2b838beacd88d4d99bd12878d2ca`. Rebuild and enroll this exact source
before attributing wallet results to it. Profiles built for the original upstream
revision are deliberately incompatible with the new client source pin. The
candidate-validator CI deliberately exports no deployment profile. Never relabel
a binary or a profile to bypass source verification.

Use disposable test funds and keep the test environment isolated while measuring
balances. The test operator supplies the profile, oracle updates and maker;
ordinary testers use the normal trader page and do not upload configuration.
For mobile, the operator must independently document the devnet fixture and its
parameters; the local runner does not deploy devnet resources.

## 2. Record evidence before testing

Create one result record per wallet/version/browser/device combination. Every
case below starts **NOT RUN**; record **PASS**, **FAIL**, or **BLOCKED** with a
reason and evidence, rather than marking an unavailable path passed.

| Evidence | Required record |
| --- | --- |
| Execution | Tester, UTC start/end, case ID and observed result; screenshot/video or error/log reference. |
| Release | Client Git commit/tree, terminal build/site version and exact URL/origin; operator or normal trader mode. |
| Chain and deployment | Cluster, genesis hash, public RPC host, market/mint/vault/maker addresses, source pins or candidate identity, raw SBF and enrolled ProgramData hashes, upgrade authorities and risk/fee parameters. |
| Wallet/browser | Wallet name and exact version, extension/app version, browser version, OS version; physical phone model and orientation. Do not substitute an emulated viewport for a phone. |
| Browser capabilities | Persistent local storage, Web Locks and Web Crypto Ed25519 work in this actual browser. Wallet advertises Wallet Standard connect, version-0 `solana:signTransaction`, and the required account chain. Record absent capability as unsupported/blocked. |
| Transactions | Public wallet address, review action/amount/limit, signature, confirmed slot, successful or failed transaction metadata, fee and exact pre/post balances. Preserve unresolved receipt evidence separately. Never collect seed phrases, private keys or full operator state directories. |

Mainnet signing explicitly requests `solana:mainnet`; devnet requests
`solana:devnet`. Localnet signing omits the chain field and sends through the
configured loopback RPC, whose genesis cannot identify a known public network. A sign-and-send-only
wallet cannot exercise this client. Registration alone does not prove that a
wallet can complete signing and receipt recovery.

## 3. Connect, review and interrupt

Run these cases separately on desktop and the physical phone. Keep the public
wallet address and market constant unless the case explicitly changes them.

| ID | Action | Required observation |
| --- | --- | --- |
| W01 | Open the normal trader page with no market, then with the verified test market and select Connect Wallet. | Missing configuration shows trading unavailable and retry; no deployment-file request. With a configured market, Connect Wallet opens the wallet chooser. |
| W02 | Approve connection; repeat with rejection. | Approval connects only the selected, still-authorized account. Connection signs/sends no transaction. Rejection appears inside the chooser and permits a fresh attempt. |
| W03 | Close the chooser while approval is pending, then approve or reject the wallet prompt. | The late result does not connect or overwrite the current session. The page can remain busy until the wallet request settles; closing the chooser does not revoke wallet permission. |
| W04 | Choose among accounts; remove/switch the chosen account or disconnect during a refresh and during a pending review simulation. | Obsolete balances/reviews disappear; late responses do not restore them. Reconnect the intended account and load fresh verified state. |
| W05 | Change the wallet's selected network/account-chain support. Separately make the controlled test RPC return a different genesis. | An unsupported account is rejected/cleared. A multi-chain account may remain connected, but the review/signing network must match the configured deployment. A wrong RPC genesis blocks preparation/submission. Record the wallet's actual network prompt; do not assume every network toggle emits an account-change event. |
| W06 | Prepare an action, cancel its review, then prepare again. Reject the actual signing request on the next attempt. | Cancel before signing produces no wallet request. Wallet rejection produces no client broadcast and consumes the old review; a fresh review works. During signing, dismiss/reject in the wallet: the page's close/Escape controls intentionally remain disabled until that request ends. |
| W07 | Wait more than 30 seconds after review before signing. Separately keep the wallet prompt open beyond that review lifetime, then approve. | Expired review is rejected; the client sends no transaction. Inspect app/RPC evidence rather than assuming that a wallet window closing establishes the outcome. |
| W08 | Pause only test price updates while chain/RPC continues; wait beyond the profile's oracle-age limit and refresh. Resume updates and refresh again. | Stale data disables trade review with a visible reason. Fresh data restores it. Deposits retain their own custody/simulation checks; stale trade pricing alone does not disable them. |
| W09 | In the controlled RPC fixture, exercise future-slot and zero-price observations; attempt a direct trade-form event as well as the button. | Neither path opens a usable trade review or signing prompt. These are injected-data checks, labeled separately from real-chain price behavior. If unavailable, retain NOT RUN; existing DOM tests do not become physical-wallet passes. |
| W10 | Repeat connection, review and signing on the physical iPhone; background/foreground the wallet browser, lock/unlock the phone and return during a wallet request. | No duplicate prompt/action, obsolete account or phantom success. Controls, amounts, fee/limit text, errors and recovery actions remain visible and usable with the keyboard open, portrait/landscape and safe-area insets. Record any browser reload or lost storage. |

## 4. Complete and reconcile the funded lifecycle

For the documented fixed-price local fixture, use six-decimal TEST at price 1,
zero funding/base fees, a fresh trader portfolio and the funded 10,000 TEST
maker. Fund the external test wallet once with 1,000 TEST before the baseline
measurement. Review and sign each row independently; reconcile its signature
and refresh confirmed state before the next row. If the next review reports a
reused blockhash, wait for a new blockhash and review again.

| Step | Action | Wallet TEST atoms | Portfolio capital atoms | Effective position Q |
| --- | --- | ---: | ---: | ---: |
| Baseline | Record balances; portfolio absent | 1,000,000,000 | Absent | 0 |
| 1 | Create portfolio | 1,000,000,000 | 0 | 0 |
| 2 | Deposit 100 TEST | 900,000,000 | 100,000,000 | 0 |
| 3 | Buy size 1, maximum price 1 | 900,000,000 | 100,000,000 | +1,000,000 |
| 4 | Sell size 1, minimum price 1, closing the long | 900,000,000 | 100,000,000 | 0 |
| 5 | Sell size 1, minimum price 1 | 900,000,000 | 100,000,000 | −1,000,000 |
| 6 | Buy size 1, maximum price 1, closing the short | 900,000,000 | 100,000,000 | 0 |
| 7 | Withdraw 100 TEST | 1,000,000,000 | 0 | 0 |

Require seven distinct successful confirmed signatures. Maker capital must end
at 10,000,000,000 atoms; the vault must return to its recorded baseline. Compare
raw token/portfolio/vault account values with the UI; do not reconcile using
rounded display strings alone. Reject an oversized deposit before signing and
verify that it changes neither collateral nor the receipt history.

Reconcile wallet SOL separately: starting lamports minus confirmed transaction
fees and net account rent must equal ending lamports. Record portfolio rent
from the actual transaction; this sequence leaves the portfolio account open.
Do not require SOL to return to its starting balance or count operator price
updates as trader fees.

The table applies only to that exact zero-fee, fixed-price fixture. For a devnet
fixture with different funding, fees, prices or execution, document expected
integer-atom changes from its actual rules and reconcile each confirmed
transaction; do not reuse the table's balances or introduce an unexplained
tolerance. No production profit/fee expectation is inferred from this test.

## 5. Receipt and recovery acceptance

Use a controlled test RPC/provider to inject faults at a known point. Record
whether a transaction reached the RPC and preserve its signature. On a phone,
use the same origin/storage context when returning to the terminal.

| ID | Action | Required observation |
| --- | --- | --- |
| R01 | Interrupt RPC before review and after a review, then restore it. | Failed reads clear actionable data. A restored connection loads fresh state; no action is signed automatically. |
| R02 | Allow one signed transaction to reach RPC, suppress the send response, then restore access and reconcile. | Signature was saved before send. Unknown/pending outcome blocks replacement actions; reconciliation finds the original transaction and restores balances without re-signing or another economic action. |
| R03 | Refresh/close/reopen after a signed or unresolved receipt, reconnect the same account, and reconcile. | The same signature and slot bound survive. A missing status is not treated as failure. If its blockhash expires without an established outcome, show expired/unresolved and keep new actions blocked. |
| R04 | Open two tabs at the same origin for the same wallet/market. Start signing in one; attempt another action/reconcile in the other. | Web Locks prevent concurrent signing/reconciliation. A final receipt written by either tab constrains later reads in the other; an older delayed RPC response cannot restore stale actionable balances. Test actual shared storage, not two unrelated browser contexts. |
| R05 | In a disposable browser profile, deny receipt writes before submission; separately inject a receipt-update failure after send and restore storage. | Before-send persistence failure prevents broadcast. After-send failure retains or recovers the already saved signature; unreadable storage shows receipt unavailable, clears actionable balances and cannot imply no transaction was sent. Restore storage and reconcile; do not erase the receipt to unblock trading. |
| R06 | Switch/disconnect accounts while signing or reconciliation is pending, then reconnect each account. | Any already submitted transaction remains associated with its original wallet/market. Late results do not repopulate another session. No repeat signature or automatic replacement transaction occurs. |

If a wallet browser lacks shared tabs, persistent storage or required APIs,
record the limitation and the affected cases as blocked. A successful desktop
run cannot close the mobile row. Mobile completion requires its own lifecycle
and interruption/recovery evidence.

## Completion record

Close [WAL-02 or WAL-03](REPAIR_CHECKLIST.md#remaining-release-and-acceptance-work)
only for the exact directly tested combinations, with every required case
resolved and linked evidence. File failures with the case ID, exact source and
environment, reproduction and last known signature; preserve unresolved funds
and receipts while investigating. Mainnet [PROD-06](REPAIR_CHECKLIST.md#remaining-release-and-acceptance-work)
remains open until the production implementation, enrollment and fresh
end-to-end acceptance are complete. All cases in this document remain
**NOT RUN / UNVERIFIED** at publication.
