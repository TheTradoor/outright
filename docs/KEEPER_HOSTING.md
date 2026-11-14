# Keeper health and host setup

The keeper now writes a private `health.json` beside its durable transaction
journal. The health command reads those two files and the operator configuration.
It does not contact an RPC, sign, write files, acquire the worker lock, start a
worker or reset receipts and fee reservations.

```sh
node protocol/operator/health.mjs \
  --config /etc/outright/keeper.json \
  --state-dir /var/lib/outright-keeper
```

Exit code `0` means the send-mode worker meets the requested operational limits.
Exit code `1` means it is unhealthy or its evidence is unavailable. JSON output
contains fixed reason codes, timing, target counts and fee headroom. It excludes
keys, account addresses, RPC URLs, provider messages and transaction error bodies.
This reports the enrolled worker's observations, not a proof of market safety,
complete RPC enumeration, valid prices or successful liquidation of every account.

## What is checked

| Check | Failure signal |
| --- | --- |
| Active send-mode worker with recent completed cycles | `starting`, `stopped`, `failed`, `simulationOnly`, `heartbeatStale` |
| Exact configuration and transaction journal | `configurationMismatch`, `journalChanged`, `healthEvidenceUnavailable` |
| Increasing verified RPC bank and bounded cycle duration | `slotStalled`, `cycleSlow` |
| Unresolved receipts within the selected time limit | `receiptOverdue`, `receiptUnresolved`, `receiptTimeMissing` |
| Complete visits across configured targets and assets | `sweepOverdue`, `sweepHistoryMissing` |
| Failed or deferred visits, even when another target succeeds | `sweepHadFailures` plus the current rejection or deferral |
| Expected target population and discovery headroom | `tooFewTargets`, `discoveryCapacityReached` |
| Remaining lifetime fee allowance covers another maximum-fee attempt | `feeBudgetLow` |
| Consistent wall-clock observations | `clockMovedBackwards` |

The defaults are 15 seconds since the last completed cycle, 15 seconds per cycle,
30 seconds without slot progress, 60 seconds for a pending receipt and five
minutes for a sweep. At least one target is expected. These are operator examples,
not qualified market risk parameters. Override them with the options in
`node protocol/operator/health.mjs --help` and record the chosen values in the
market's operating policy. `--min-targets 0` is an explicit allowance for an
empty market; it does not establish enumeration completeness.

A sweep means every selected target/asset pair was attempted. Rejected or
deferred work still advances the cursor and is counted as a failure. That failure
remains visible through the rest of the sweep and clears only after a subsequent
complete clean sweep. A confirmed transaction does not prove that every engine
obligation is settled. An idle engine can be healthy if verified banks advance
and complete sweeps continue.

Partial-sweep and slot-progress timestamps survive normal restarts. Receipt age
comes from its original journal timestamp, not process startup. A crash between
journal and health writes can leave timing unknown; monitoring reports that
condition until verified progress reestablishes it. Missing or unreadable files
cannot produce a healthy result. A concurrent journal update can briefly report
`journalChanged`; resample without editing either file. Sustained disagreement
requires investigation.

Health publication follows the durable journal write. A health write failure
stops the CLI; any already signed transaction retains its original pending receipt
and reserved fees. The previous health report becomes stale. SIGINT/SIGTERM stop
after the current bounded cycle, release the journal lock and publish `stopped`.
A process kill may instead leave a stale report and lock for operator inspection.

## Linux service templates

[The service files](../protocol/operator/systemd/) target a systemd host with
Node.js 22.12 or newer at `/usr/bin/node`, an immutable release checkout at
`/opt/outright`, and a dedicated system account named `outright-keeper`.
They have not been installed on a production host.

Before installation, the host operator must provide the enrolled configuration,
funded dedicated fee payer, live oracle publisher, durable filesystem and reviewed
health thresholds. Install locked dependencies with `npm ci --prefix protocol
--ignore-scripts` in the release checkout. Keep code and dependencies owned by
the host administrator and unwritable by the service account. The configuration
is `/etc/outright/keeper.json`; the dedicated keypair is
`/etc/outright/keeper.keypair.json`, owned by the service account with mode `0600`.
Neither file belongs in the repository.

The keeper service creates `/var/lib/outright-keeper` with mode `0700`. It runs
with an unprivileged account and a read-only system filesystem, with its state
directory as the managed writable exception. It does not automatically restart
after a failure. It never removes an existing lock or resets a budget. Use the
[receipt and restart procedure](MARKET_OPERATIONS.md#receipts-fees-and-restart)
before starting a stopped worker again.

The health service has no dependency that starts the signing worker. It has a
private network namespace, read-only state access and no access to the keypair
path. The timer samples every 15 seconds after a two-minute boot delay. Route
its failed exit status and JSON reasons into the selected host alerting system;
the timer alone does not deliver notifications or page an operator. Also monitor
the host and timer externally so a dead machine cannot look healthy.

Validate the paths and units on the selected host before installation:

```sh
systemd-analyze verify protocol/operator/systemd/outright-keeper.service \
  protocol/operator/systemd/outright-keeper-health.service \
  protocol/operator/systemd/outright-keeper-health.timer
```

First run one simulation with a separate simulation-state directory and no
keypair. Its health correctly reports `simulationOnly` and `stopped`. For a funded
send-mode worker, exercise start, clean stop, restart with a pending receipt,
provider outage, stale feed, fee exhaustion and a simulated host failure under the
approved deployment before accepting production operation. Preserve the journal
across release upgrades and follow the existing configuration-change procedure.

Service directives follow the official [systemd execution environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
and [service configuration](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
references. Unit syntax validation does not establish successful hosted operation.

## Release boundary

This completes the local health tooling and host templates. OPS-02 still needs
the actual host, RPC/provider completeness monitoring, funded payer, live feeds,
capacity measurements and outage acceptance. PROD-05 still needs assigned
operators, delivered alerts and exercised incident response. The unchanged
Percolator engine and program enforce the transaction rules. No production
market is enrolled and the terminal deployment profile remains `null`.
