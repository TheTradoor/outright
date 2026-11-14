#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import { keeperFetch } from "./rpc.mjs";
import { inspectPythOracle, validateOracleConfig, OracleInspectionError } from "./pyth.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log(`Usage: node protocol/operator/oracle.mjs --config PATH

Read one confirmed bank containing the Solana Clock and a Pyth Core price feed.
The configuration must specify the network, feed ID, shard and explicit age and
confidence limits. Exit 0 means this observation passes those limits; exit 1
means rejected or unavailable. It does not establish production readiness.
No wallet, keypair, signing, transaction submission or file writes.`);
    return;
  }
  if (args.length !== 2 || args[0] !== "--config" || !args[1] || args[1].startsWith("--"))
    throw new OracleInspectionError("oracleOptionsInvalid");
  const config = validateOracleConfig(JSON.parse(await readFile(args[1], "utf8")));
  const connection = new Connection(config.rpcUrl, {
    commitment: "confirmed", disableRetryOnRateLimit: true, fetch: keeperFetch(),
  });
  const result = await inspectPythOracle(config, connection);
  console.log(JSON.stringify(result));
  if (result.status !== "accepted") process.exitCode = 1;
}

main().catch((error) => {
  // Never echo credential-bearing URLs, provider errors or private file paths.
  console.log(JSON.stringify({ version: 1, scope: "pyth-feed-inspection", status: "unavailable",
    reasons: [error instanceof OracleInspectionError ? error.code : "oracleEvidenceUnavailable"] }));
  process.exitCode = 1;
});
