#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateKeeperConfig } from "../src/keeper.mjs";
import { readPrivateJson, evaluateKeeperHealth } from "./monitor.mjs";

const options = {
  "--max-age-ms": "maxAgeMs", "--max-pending-ms": "maxPendingMs",
  "--max-sweep-ms": "maxSweepMs", "--max-slot-stall-ms": "maxSlotStallMs",
  "--max-cycle-ms": "maxCycleMs", "--min-targets": "minTargets",
};
async function main() {
  const argv = process.argv.slice(2), args = {}, limits = {};
  if (!argv.length || argv.includes("--help")) {
    console.log(`Usage: node protocol/operator/health.mjs --config PATH --state-dir PATH
  [--max-age-ms 15000] [--max-pending-ms 60000] [--max-sweep-ms 300000]
  [--max-slot-stall-ms 30000] [--max-cycle-ms 15000] [--min-targets 1]

Read-only local service check. Exit 0 means the send-mode worker meets these
operational thresholds. Exit 1 means unhealthy, unavailable or invalid evidence.
No RPC requests, signatures, file writes, lock removal or journal reset.
These thresholds are examples, not a production market risk policy.`);
    return;
  }
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if ((!options[flag] && !["--config", "--state-dir"].includes(flag)) ||
        args[flag] !== undefined || !value || value.startsWith("--"))
      throw new Error("Invalid health options");
    args[flag] = value;
    if (options[flag]) {
      if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid health threshold");
      limits[options[flag]] = Number(value);
    }
  }
  if (!args["--config"] || !args["--state-dir"]) throw new Error("Missing health options");
  const config = validateKeeperConfig(JSON.parse(await readFile(args["--config"], "utf8")));
  const report = await readPrivateJson(args["--state-dir"], "health.json");
  const state = await readPrivateJson(args["--state-dir"], "state.json");
  const result = evaluateKeeperHealth(report, state, config, limits);
  console.log(JSON.stringify(result));
  if (result.status !== "healthy") process.exitCode = 1;
}

main().catch(() => {
  // Raw parser/storage/provider messages can contain paths or credentials.
  console.log(JSON.stringify({ version: 1, status: "unhealthy", reasons: ["healthEvidenceUnavailable"] }));
  process.exitCode = 1;
});
