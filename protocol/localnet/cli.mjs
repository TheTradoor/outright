#!/usr/bin/env node
import { Keypair } from "@solana/web3.js";
import { spawn } from "node:child_process";
import { open, unlink, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import {
  connection,
  privateDirectory,
  loadJson,
  saveJson,
  localRpcUrl,
} from "./runtime.mjs";
import { loadMarket, bootstrap, refreshMark, fundWallet } from "./market.mjs";
import { smoke } from "./smoke.mjs";

const [command, ...argv] = process.argv.slice(2);
const args = {};
if (!command || command === "--help") {
  console.log(`Usage:
  node protocol/localnet/cli.mjs start --validator PATH --program-binary PATH --matcher-binary PATH --state-dir PATH [--port 8899] [--test]
  node protocol/localnet/cli.mjs fund --state-dir PATH --wallet ADDRESS

Starts a private local validator, creates a funded TEST market and writes a
deployment.json for the wallet terminal. The price is fixed at 1 TEST; this is
not live SOL pricing. --test verifies both trade directions and exits. The fund
command gives a local wallet test SOL and 1,000 TEST. No public network is used.
Use a fresh, private state directory. Never publish its keys or ledger.`);
  process.exit(0);
}
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  if (
    ![
      "--validator",
      "--program-binary",
      "--matcher-binary",
      "--state-dir",
      "--port",
      "--test",
      "--wallet",
    ].includes(flag) ||
    args[flag] !== undefined
  )
    throw new Error("Unknown or repeated local validator option");
  if (flag === "--test") args[flag] = true;
  else {
    if (!argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error(`Missing ${flag}`);
    args[flag] = argv[++i];
  }
}

async function main() {
  if (!args["--state-dir"]) throw new Error("--state-dir is required");
  const root = resolve(args["--state-dir"]);
  await privateDirectory(root);
  if (command === "fund") {
    if (!args["--wallet"]) throw new Error("--wallet is required");
    const env = await loadMarket(root);
    console.log(
      JSON.stringify({
        status: "funded",
        wallet: args["--wallet"],
        signature: await fundWallet(env, args["--wallet"]),
      }),
    );
    return;
  }
  if (command !== "start") throw new Error("Choose start or fund");
  for (const flag of ["--validator", "--program-binary", "--matcher-binary"])
    if (!args[flag]) throw new Error(`${flag} is required`);
  const port = Number(args["--port"] || 8899);
  if (!Number.isInteger(port) || port < 1024 || port > 65000)
    throw new Error("Invalid local RPC port");
  const rpcUrl = localRpcUrl(`http://127.0.0.1:${port}`);
  const lockPath = join(root, "localnet.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST")
      throw new Error(
        "Local validator state is locked; stop the worker or inspect it before removing the lock",
      );
    throw error;
  });
  let child;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    await lock.sync();
    let state;
    try {
      state = await loadJson(join(root, "public.json"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await access(join(root, "keys.json"));
        throw new Error(
          "Incomplete local state: preserve its keys and use a fresh directory",
        );
      } catch (keyError) {
        if (keyError.code !== "ENOENT") throw keyError;
      }
      const keys = Object.fromEntries(
        ["admin", "maker", "trader", "market", "mint", "context"].map(
          (name) => [name, Keypair.generate()],
        ),
      );
      state = {
        version: 1,
        rpcUrl,
        program: Keypair.generate().publicKey.toBase58(),
        matcher: Keypair.generate().publicKey.toBase58(),
        ...Object.fromEntries(
          Object.entries(keys).map(([name, key]) => [
            name,
            key.publicKey.toBase58(),
          ]),
        ),
      };
      await saveJson(
        join(root, "keys.json"),
        Object.fromEntries(
          Object.entries(keys).map(([name, key]) => [name, [...key.secretKey]]),
        ),
        { exclusive: true },
      );
      await saveJson(join(root, "public.json"), state, { exclusive: true });
    }
    if (state.rpcUrl !== rpcUrl)
      throw new Error("Local RPC URL differs from the saved state");
    const rpc = connection(rpcUrl);
    try {
      await rpc.getVersion();
      throw new Error(
        "An RPC is already listening on this port; choose a different port",
      );
    } catch (error) {
      if (error.message.includes("already listening")) throw error;
    }
    const log = await open(join(root, "validator-output.log"), "a", 0o600);
    child = spawn(
      resolve(args["--validator"]),
      [
        "--ledger",
        join(root, "ledger"),
        "--bind-address",
        "127.0.0.1",
        "--rpc-port",
        String(port),
        "--faucet-port",
        String(port + 2),
        "--quiet",
        "--mint",
        state.admin,
        "--upgradeable-program",
        state.program,
        resolve(args["--program-binary"]),
        state.admin,
        "--upgradeable-program",
        state.matcher,
        resolve(args["--matcher-binary"]),
        state.admin,
      ],
      { stdio: ["ignore", log.fd, log.fd] },
    );
    await log.close();
    let startError;
    child.on("error", (error) => {
      startError = error;
    });
    const until = Date.now() + 60000;
    let genesisHash,
      ready = false;
    while (!stopped && Date.now() < until) {
      if (startError || child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          "Validator failed to start; inspect validator-output.log and ledger/validator.log",
        );
      try {
        genesisHash = await rpc.getGenesisHash();
        if ((await rpc.getSlot("finalized")) > 0) {
          ready = true;
          break;
        }
      } catch {}
      await pause(300);
    }
    if (!ready || stopped)
      throw new Error("Local validator did not become ready");
    if (state.genesisHash && state.genesisHash !== genesisHash)
      throw new Error(
        "Local ledger genesis changed; preserve the old state and use a fresh directory",
      );
    if (!state.genesisHash) {
      state.genesisHash = genesisHash;
      await saveJson(join(root, "public.json"), state);
    }
    const env = await loadMarket(root);
    await bootstrap(env, args["--program-binary"], args["--matcher-binary"]);
    console.log(
      JSON.stringify({
        status: "ready",
        network: "localnet",
        rpcUrl,
        genesisHash,
        market: state.market,
        profile: join(root, "deployment.json"),
        instrument: "TEST/USD, fixed test price",
      }),
    );
    if (args["--test"]) {
      console.log(JSON.stringify(await smoke(env)));
      return;
    }
    while (!stopped) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Local validator stopped");
      await refreshMark(env);
      await pause(2000);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const until = Date.now() + 10000;
      while (
        child.exitCode === null &&
        child.signalCode === null &&
        Date.now() < until
      )
        await pause(100);
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGKILL");
        await exited;
      }
    }
    await lock.close();
    await unlink(lockPath);
  }
}
main().catch((error) => {
  console.error(error.message);
  if (error.logs) console.error(error.logs.join("\n"));
  process.exitCode = 1;
});
