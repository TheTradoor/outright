# Candidate current-validator qualification

The candidate wrapper is identified by the immutable upstream commit, reviewed
patch digest and resulting Git tree in `qualification/wrapper-source.json`.
This gate builds that exact source for platform-tools v1.58 / SBPF v3 and runs
it on Agave 4.4.1. It is separate from the v1.52 / v0 LiteSVM qualification.

The ordinary localnet runner intentionally requires the application's enrolled
wrapper commit. Calling its CLI directly with an overlay would write that old
commit into a deployment profile. This qualification instead uses a private,
fixed-price TEST market and in-memory instruction/snapshot settings. It never
exports a deployment profile, changes the runtime source pin, or enables a
public network. The release remains unenrolled.

The harness reuses the current instruction planner, authenticated account
readers, binary/loader verification, transaction submission and receipt
reconciliation functions. It checks portfolio creation, a 100 TEST deposit,
long open/close, short open/close and the 100 TEST withdrawal. It also requires
an oversized deposit to be rejected before signing. All seven unique lifecycle
signatures must have successful confirmed transaction metadata. Starting/final
trader collateral is exactly 1,000,000,000 atoms, final portfolio capital zero,
and maker capital 10,000,000,000 atoms.

Source checks run before and after execution. Both deployed programs must match
their supplied binaries byte-for-byte, with only zero trailing padding, and
have their local upgrade authorities revoked. Raw binary hashes and padded
ProgramData hashes are recorded separately. Generated test signing keys stay
in process memory; the workflow uploads selected public evidence, never the
ledger or private state directory.

The report verifier rejects missing or duplicate transactions, incorrect trade
directions, changed candidate identity, failed/interrupted runs, incomplete
collateral reconciliation and retained program authorities. A zero shell exit
without the complete verified report cannot pass.

Run the `Candidate validator` GitHub workflow. Its result is evidence only for
this synthetic lifecycle and exact artifact; it is not a security audit, a
real-wallet acceptance test, a full oracle/Recovery campaign or mainnet approval.
