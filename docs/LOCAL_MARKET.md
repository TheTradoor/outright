# Run a funded local market

This starts a Solana validator and a complete, funded Outright test market on
your machine. The terminal uses real RPC transactions against compiled program
code. No public cluster or real assets are involved.

The instrument is **TEST/USD at a fixed synthetic price of 1**, with six-decimal
TEST collateral, 100% initial and maintenance margin, zero base trading fees
and zero funding. The maker uses the upstream `auth_matcher` test fixture.
This configuration is for exercising application flows, not price discovery,
market making or economic stress testing.

## Requirements

- Linux with `io_uring` available to the validator. Restricted containers can
  reject this even when the kernel supports it; use a suitable development
  machine or the repository's Native validator CI job.
- Node.js 22.12 or newer and the repository's pinned Rust toolchain.
- `cargo-build-sbf` 4.6.0. The runner downloads platform-tools v1.58 and builds
  SBPF v3, separately from the older LiteSVM fixture.
- Agave `solana-test-validator` 4.4.1 from the
  [official release](https://github.com/anza-xyz/agave/releases/tag/v4.4.1).
  CI verifies the Linux x86_64 archive against SHA-256
  `5b0f0fc7e4eedace05f6455de00aa1f2f3d1642068f1e8d50760ba49112c3941`.

From the Outright checkout:

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
cargo install cargo-build-sbf --version 4.6.0 --locked
git clone https://github.com/aeyakovenko/percolator-prog.git ../percolator-prog
git -C ../percolator-prog checkout --detach b42fe017c2bc953778f90d0cb85cd1d426b6e783
bash protocol/localnet/run.sh ../percolator-prog \
  --validator "$(command -v solana-test-validator)" \
  --state-dir "$PWD/protocol/localnet-state"
```

The runner checks the engine and wrapper source pins, builds the two programs,
starts an isolated validator, and verifies its deployed bytes and immutable
program authorities. Its setup authority receives local test SOL at genesis;
no faucet is needed. It creates the mint, market and collateral vault, then
funds a maker with 10,000 TEST and grants consent for the test matcher.
The `ready` message gives the public deployment profile path. Keep the command
running: it refreshes the synthetic price approximately every two seconds.

## Use the wallet terminal

Use a separate test wallet in a Wallet Standard-compatible browser. In another
terminal, fund its public address with local test SOL and 1,000 TEST:

```sh
node protocol/localnet/cli.mjs fund \
  --state-dir "$PWD/protocol/localnet-state" --wallet YOUR_PUBLIC_WALLET_ADDRESS
npm run build --prefix protocol
python3 -m http.server 8080 --bind 127.0.0.1 --directory protocol/dist
```

Open `http://localhost:8080`. In **Deployment settings**, load
`protocol/localnet-state/deployment.json`, then connect the test wallet.
Create a portfolio, deposit 100 TEST, and review a buy or sell of size 1 with
limit price 1. Confirm the resulting position, use the opposite side and the
same size to close it, then withdraw 100 TEST. Each action requires its own
review and wallet signature. Never repeat a pending action before its receipt
has reconciled.

The profile points to `127.0.0.1` on the browser's machine. A phone or a remote
browser cannot reach another computer's validator through that address. A
hosted page may also be prevented from reaching localhost by browser policy;
serve the terminal locally for this workflow.

The maker consent lasts 1,000,000 slots from setup. If it expires, create a
fresh test environment. The worker does not silently renew authority or grant
new consent.

## Execute the complete RPC check

Use a fresh directory and add `--test`:

```sh
bash protocol/localnet/run.sh ../percolator-prog \
  --validator "$(command -v solana-test-validator)" \
  --state-dir "$PWD/protocol/localnet-state/rpc-check" --port 8999 --test
```

The check creates a portfolio, deposits 100 TEST, rejects an oversized deposit,
opens and closes one long and one short, and withdraws the deposit. It verifies
the confirmed account state, exact final token balance, unchanged maker
capital, unique signatures and successful transaction records. The resulting
`lifecycle-report.json` contains public addresses and signatures. The validator
is stopped when the check exits, including on failure.

This uses a generated local signer through the same client as the terminal.
It is not a browser-extension or mobile-wallet test.

## State and recovery

The state directory must be private (0700); keys and receipts are written as
0600 files. `keys.json` contains disposable local signing keys. Never upload
it, the ledger or the whole state directory to a website, repository or issue.
The default `protocol/localnet-state` path is ignored by Git.

Setup saves each signed transaction's signature before broadcasting. A
confirmed result is recorded durably. Unknown sends stop the worker; restart
checks a saved pending setup signature before continuing. Setup cannot replace
an existing receipt with the same signature. Client actions retain the
client's own journal and blockhash replay protection.

Ctrl-C stops the owned validator and releases the state lock. Restarting the
same directory preserves its ledger and checks the genesis and program pins.
It does not reset balances or repeat bootstrap issuance. If setup was interrupted
before a complete profile was saved, inspect its receipts and preserve that
directory; use a new directory for a fresh test. A stale lock after a hard crash
requires inspecting and stopping the old process before removing the lock.

No public RPC endpoint is accepted by these commands. Public devnet needs its
own deployment, test SOL, provider oracle integration and operational services.
