#!/usr/bin/env node
import { readFile, open } from "node:fs/promises";
import { constants } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { Connection, Keypair } from "@solana/web3.js";
import { OutrightKeeper, validateKeeperConfig } from "../src/keeper.mjs";
import { openKeeperJournal } from "./journal.mjs";
import { keeperFetch } from "./rpc.mjs";
import { openKeeperMonitor } from "./monitor.mjs";

async function main() {
  const argv = process.argv.slice(2),
    args = {};
  if (!argv.length || argv.includes("--help")) {
    console.log(`Usage: node protocol/operator/keeper.mjs --config PATH --state-dir PATH
  [--send --keypair PATH] [--watch]

Default: simulate one bounded crank without signing. --watch polls the configured
targets or discovers portfolios within the configured market. --send requires
the dedicated fee payer for an enrolled deployment. Never use a trader,
maker, oracle-authority or upgrade-authority wallet. JSON lines go to stdout.
The state directory must be private, durable and used by exactly one worker.
health.json records local operational status for operator/health.mjs.`);
    return;
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (
      !["--config", "--state-dir", "--keypair", "--send", "--watch"].includes(
        flag,
      ) ||
      args[flag] !== undefined
    )
      throw new Error("Unknown or repeated keeper option");
    if (["--send", "--watch"].includes(flag)) args[flag] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${flag}`);
      args[flag] = argv[++i];
    }
  }
  if (!args["--config"] || !args["--state-dir"])
    throw new Error("--config and --state-dir are required");
  if (!!args["--send"] !== !!args["--keypair"])
    throw new Error("Use --send and --keypair together");
  const config = validateKeeperConfig(
    JSON.parse(await readFile(args["--config"], "utf8")),
  );
  let signer = null;
  if (args["--keypair"]) {
    const file = await open(
      args["--keypair"],
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 || stat.mode & 0o077)
        throw new Error("Keypair must be a private file (mode 0600)");
      const bytes = JSON.parse(await file.readFile("utf8"));
      if (
        !Array.isArray(bytes) ||
        bytes.length !== 64 ||
        bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
      )
        throw new Error("Invalid Solana keypair file");
      signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
    } finally {
      await file.close();
    }
  }
  const rpc = new Connection(config.deployment.rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: keeperFetch(),
  });
  const journal = await openKeeperJournal(args["--state-dir"]);
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let monitor, failed = false, discoveredTargets;
  try {
    monitor = await openKeeperMonitor(args["--state-dir"], config, await journal.read(), {
      send: !!args["--send"],
    });
    const keeper = new OutrightKeeper(config, {
      connection: rpc,
      journal: {
        ...journal,
        async write(state) {
          await journal.write(state);
          // Capture the verified scan before a single-step sweep clears it.
          if (state.discovery) discoveredTargets = state.discovery.targets.length;
        },
      },
      signer,
    });
    do {
      const before = await journal.read(), startedAtMs = Date.now();
      discoveredTargets = before?.discovery?.targets.length;
      const result = await keeper.tick({ send: !!args["--send"] });
      await monitor.record(result, before, await journal.read(), startedAtMs, discoveredTargets);
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      if (result.status === "expiredUnresolved")
        throw new Error(
          "Transaction expired with an unresolved outcome; preserve state and reconcile its signature",
        );
      if (!args["--watch"] || stopped.signal.aborted) break;
      await setTimeout(config.intervalMs, undefined, {
        signal: stopped.signal,
      }).catch((e) => {
        if (e.name !== "AbortError") throw e;
      });
    } while (!stopped.signal.aborted);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    try {
      await journal.close();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (monitor) await monitor.stop(failed);
    }
  }
}

main().catch((error) => {
  // Do not echo RPC response bodies, key material or credential-bearing URLs.
  const safe =
    /^(Keeper|Crank|Market|Portfolio|Asset|On-chain|Oracle|Resolved|Sending|Transaction|Collateral|Token|Invalid|Unsupported|Configure|Duplicate|Devnet|Use |Unknown|Missing|--)/.test(
      error.message,
    );
  console.error(
    JSON.stringify({
      status: "stopped",
      error: safe
        ? error.message
        : "Keeper stopped after a configuration, storage or RPC failure; no automatic retry was scheduled",
    }),
  );
  process.exitCode = 1;
});
