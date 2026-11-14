import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, chmod, symlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { validateKeeperConfig, emptyKeeperState } from "../src/keeper.mjs";
import { vaultAuthority } from "../src/instructions.mjs";
import { getAssociatedTokenAddressSync } from "../src/token.mjs";
import contract from "../upstream-contract.json" with { type: "json" };
import { openKeeperMonitor, readPrivateJson, evaluateKeeperHealth } from "../operator/monitor.mjs";

const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const key = (n) => new PublicKey(Buffer.alloc(32, n));
const address = (n) => key(n).toBase58();
const origin = 1_790_000_000_000;
async function setup(t, { discovery = false, send = true, targets = 2 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "outright-monitor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = validateKeeperConfig({
    version: 1,
    deployment: {
      version: 1, cluster: "localnet", rpcUrl: "http://127.0.0.1:1", genesisHash: address(31),
      engineCommit: contract.engineCommit, wrapperCommit: contract.wrapperCommit,
      program: { address: address(9), programData: address(8), sha256: "a".repeat(64), upgradeAuthority: null },
      market: address(1), collateral: { mint: address(5), decimals: 6, symbol: "TEST", mintAuthority: null, freezeAuthority: null },
      vault: getAssociatedTokenAddressSync(key(5), vaultAuthority(key(9), key(1)), true).toBase58(), maxOracleAgeSlots: 20,
    },
    feePayer: address(21),
    targets: discovery ? [] : Array.from({ length: targets }, (_, i) => ({ address: address(i + 2), owner: address(3), portfolioId: String(i + 17) })),
    assets: [{ index: 0, marketId: "1", oracleMode: 0, feeds: [] }],
    intervalMs: 2000, maxFeeLamports: "5000", feeBudgetLamports: "100000", reserveLamports: "1000000",
    ...(discovery ? { discovery: { mode: "programAccounts", maxTargets: 10 } } : {}),
  });
  const f = { directory, config, state: null, now: origin };
  f.open = async (sendMode = send) => {
    f.monitor = await openKeeperMonitor(directory, config, f.state, { send: sendMode, now: () => f.now });
  };
  await f.open();
  f.report = () => readPrivateJson(directory, "health.json");
  f.health = async (limits = {}) => evaluateKeeperHealth(await f.report(), f.state, config, limits, f.now);
  f.tick = async (status = "idle", changes = {}, resultFields = {}, count = undefined, cycleMs = 100) => {
    const before = structuredClone(f.state);
    f.state = { ...(f.state ?? emptyKeeperState(hash(config))), minimumSlot: (f.state?.minimumSlot ?? 100) + 1, ...changes };
    f.now += 2000;
    await writeFile(join(directory, "state.json"), JSON.stringify(f.state), { mode: 0o600 });
    await f.monitor.record({ status, ...resultFields }, before, f.state, f.now - cycleMs, count);
  };
  return f;
}

test("send-mode status is tied to exact configuration and durable state", async (t) => {
  const f = await setup(t);
  await f.tick();
  assert.equal((await f.health()).status, "healthy");
  f.state.reservedFees = "5000";
  assert((await f.health()).reasons.includes("journalChanged"));
  const changed = { ...f.config, feeBudgetLamports: "200000" };
  assert(evaluateKeeperHealth(await f.report(), f.state, changed, {}, f.now).reasons.includes("configurationMismatch"));
});

test("missing ticks, frozen slots and slow cycles are independent failures", async (t) => {
  const f = await setup(t);
  await f.tick("idle", {}, {}, undefined, 16000);
  assert((await f.health()).reasons.includes("cycleSlow"));
  f.now += 31000;
  await f.tick("idle", { minimumSlot: f.state.minimumSlot });
  const health = await f.health();
  assert.equal(health.reasons.includes("heartbeatStale"), false);
  assert(health.reasons.includes("slotStalled"));
  f.now += 16000;
  assert((await f.health()).reasons.includes("heartbeatStale"));
});

test("pending receipt age and fee reservation survive restart", async (t) => {
  const f = await setup(t);
  const pending = { status: "submitted", createdAt: new Date(f.now).toISOString() };
  await f.tick("submitted", { pending, reservedFees: "5000", cursor: 1 });
  await f.monitor.stop();
  f.now += 61000;
  await f.open();
  await f.tick("pending", { pending: { ...pending, status: "pending" } });
  const health = await f.health();
  assert(health.reasons.includes("receiptOverdue"));
  assert.equal(health.reservedFeeLamports, "5000");
  assert.equal(health.remainingFeeLamports, "95000");
  assert(health.pendingAgeMs >= 61000);
  await f.tick("expiredUnresolved", { pending: { ...pending, status: "expiredUnresolved" } });
  assert((await f.health()).reasons.includes("receiptUnresolved"));
});

test("partial sweep age survives restart and completes only on the last visit", async (t) => {
  const f = await setup(t);
  await f.tick("idle", { cursor: 1 });
  const started = (await f.report()).sweepStartedAtMs;
  await f.monitor.stop();
  f.now += 301000;
  await f.open();
  await f.tick("waitingForBlockhash", { cursor: 1 });
  assert.equal((await f.report()).sweepStartedAtMs, started);
  assert((await f.health()).reasons.includes("sweepOverdue"));
  await f.tick("idle", { cursor: 0 });
  assert.equal((await f.health()).status, "healthy");
});

test("a rejected target remains visible while other targets succeed", async (t) => {
  const f = await setup(t);
  await f.tick("simulationRejected", { cursor: 1 });
  await f.tick("idle", { cursor: 0 });
  assert((await f.health()).reasons.includes("sweepHadFailures"));
  await f.monitor.stop();
  await f.open();
  await f.tick("idle", { cursor: 1 });
  assert((await f.health()).reasons.includes("sweepHadFailures"));
  await f.tick("idle", { cursor: 0 });
  assert.equal((await f.health()).status, "healthy");
});

test("failed receipts and deferred payouts remain unhealthy through a clean partial sweep", async (t) => {
  const f = await setup(t);
  await f.tick("failed");
  await f.tick("idle", { cursor: 1 });
  assert((await f.health()).reasons.includes("sweepHadFailures"));
  await f.tick("deferred", { cursor: 0 }, { reason: "payoutHalted" });
  assert((await f.health()).reasons.includes("payoutHalted"));
  assert.equal((await f.health()).lastSweepFailures, 2);
});

test("discovery counts a completed single-step scan without retaining old target counts", async (t) => {
  const f = await setup(t, { discovery: true });
  await f.tick("idle", { cursor: 1, discovery: { targets: Array(5).fill({}) } });
  assert.equal((await f.health()).targetCount, 5);
  await f.tick("idle", { cursor: 0, discovery: null }, {}, 5);
  await f.tick("idle", { cursor: 0, discovery: null }, {}, 1);
  assert.equal((await f.health()).targetCount, 1);
  assert.equal((await f.health()).totalSteps, 1);
  assert.equal((await f.health()).status, "healthy");
});

test("empty discovery and reaching its configured capacity are explicit alerts", async (t) => {
  const f = await setup(t, { discovery: true });
  await f.tick("noTargets");
  assert((await f.health()).reasons.includes("tooFewTargets"));
  assert.equal((await f.health({ minTargets: 0 })).status, "healthy");
  await f.tick("idle", { cursor: 1, discovery: { targets: Array(10).fill({}) } });
  assert((await f.health()).reasons.includes("discoveryCapacityReached"));
});

test("a missing or lagging monitor cannot reset partial-sweep history to healthy", async (t) => {
  const f = await setup(t);
  await f.tick("idle", { cursor: 1 });
  // Simulate a durable journal write followed by a crash before health publication.
  f.state.minimumSlot++;
  await f.open();
  await f.tick("waitingForBlockhash", { cursor: 1 });
  assert((await f.health()).reasons.includes("sweepHistoryMissing"));
  await rm(join(f.directory, "health.json"));
  await f.open();
  await f.tick("waitingForBlockhash", { cursor: 1 });
  assert((await f.health()).reasons.includes("sweepHistoryMissing"));
  await f.tick("idle", { cursor: 0 });
  assert((await f.health()).reasons.includes("sweepHadFailures"), "unknown prior visits require a new clean sweep");
  await f.tick("idle", { cursor: 1 });
  await f.tick("idle", { cursor: 0 });
  assert.equal((await f.health()).status, "healthy");
});

test("lost discovery timing is unhealthy even before the first cursor advances", async (t) => {
  const f = await setup(t, { discovery: true });
  await f.tick("idle", {}, {}, 1);
  f.state.discovery = { targets: [{}, {}] };
  await f.open();
  await f.tick("waitingForBlockhash");
  assert((await f.health()).reasons.includes("sweepHistoryMissing"));
});

test("simulation, startup, shutdown and failure are not send-mode service readiness", async (t) => {
  const f = await setup(t, { send: false });
  assert((await f.health()).reasons.includes("starting"));
  await f.tick("simulated");
  assert((await f.health()).reasons.includes("simulationOnly"));
  await f.monitor.stop();
  assert((await f.health()).reasons.includes("stopped"));
  await f.monitor.stop(true);
  assert((await f.health()).reasons.includes("failed"));
  await f.monitor.stop();
  assert.equal((await f.report()).phase, "failed");
});

test("low fee headroom warns before the next maximum-fee transaction", async (t) => {
  const f = await setup(t);
  await f.tick("idle", { reservedFees: "96000" });
  assert((await f.health()).reasons.includes("feeBudgetLow"));
});

test("clock rollback and invalid timestamps cannot produce a fresh health check", async (t) => {
  const f = await setup(t);
  await f.tick();
  f.now -= 1000;
  assert((await f.health()).reasons.includes("clockMovedBackwards"));
  await assert.rejects(f.open(), /clock moved backwards/);
  const before = (await f.report()).updatedAtMs;
  assert.equal(before, origin + 2000);
  assert.throws(() => evaluateKeeperHealth({}, f.state, f.config), /Invalid/);
  assert.throws(() => evaluateKeeperHealth({}, f.state, f.config, { maxAgeMs: 0 }), /thresholds/);
});

test("health files are private, bounded, atomic and reject symlinks or corrupt history", async (t) => {
  const f = await setup(t);
  await f.tick();
  assert.equal((await readdir(f.directory)).some((n) => n.endsWith(".tmp")), false);
  await chmod(join(f.directory, "health.json"), 0o644);
  await assert.rejects(f.report(), /Invalid/);
  await chmod(join(f.directory, "health.json"), 0o600);
  await writeFile(join(f.directory, "large.json"), " ".repeat(1_048_577), { mode: 0o600 });
  await assert.rejects(readPrivateJson(f.directory, "large.json"), /Invalid/);
  await symlink(join(f.directory, "state.json"), join(f.directory, "linked.json"));
  await assert.rejects(readPrivateJson(f.directory, "linked.json"));
  await writeFile(join(f.directory, "health.json"), "{}");
  await assert.rejects(f.open(), /Invalid keeper health/);
  await chmod(f.directory, 0o755);
  await assert.rejects(readPrivateJson(f.directory, "missing.json", true), /private/);
});

test("health CLI checks durable evidence without RPC, writes, locks or secret output", async (t) => {
  const f = await setup(t);
  f.now = Date.now();
  await f.tick();
  // Use current time, not a future fixture clock, for the subprocess.
  const report = await f.report();
  for (const k of ["updatedAtMs", "lastTickAtMs", "slotAdvancedAtMs", "lastSweepAtMs"]) report[k] = Date.now();
  await writeFile(join(f.directory, "health.json"), JSON.stringify(report));
  const configFile = join(f.directory, "config.json");
  await writeFile(configFile, JSON.stringify(f.config), { mode: 0o600 });
  await writeFile(join(f.directory, "keeper.lock"), "active keeper lock", { mode: 0o600 });
  const names = await readdir(f.directory);
  const contents = await Promise.all(names.map((n) => readFile(join(f.directory, n), "utf8")));
  const script = fileURLToPath(new URL("../operator/health.mjs", import.meta.url));
  const args = [script, "--config", configFile, "--state-dir", f.directory];
  const result = await promisify(execFile)(process.execPath, args);
  assert.equal(JSON.parse(result.stdout).status, "healthy");
  assert.equal(result.stderr, "");
  assert.deepEqual(await readdir(f.directory), names);
  assert.deepEqual(await Promise.all(names.map((n) => readFile(join(f.directory, n), "utf8"))), contents);
  await f.monitor.stop(true);
  await assert.rejects(promisify(execFile)(process.execPath, args), (e) => e.code === 1 && JSON.parse(e.stdout).status === "unhealthy");
  await writeFile(configFile, "PRIVATE_TOKEN_DO_NOT_ECHO");
  await assert.rejects(promisify(execFile)(process.execPath, args), (e) =>
    e.code === 1 && !e.stdout.includes("PRIVATE_TOKEN") && !e.stderr.includes("PRIVATE_TOKEN"));
});
