import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import vectors from "./fixtures/pyth-oracle.json" with { type: "json" };
import contract from "../upstream-contract.json" with { type: "json" };
import { PYTH_RECEIVER, OracleInspectionError, pythFeedAddress, readPythPriceE6,
  validateOracleConfig, inspectPythOracle } from "../operator/pyth.mjs";

const base = vectors.cases[0];
const config = {
  version: 1, cluster: "mainnet-beta", rpcUrl: "https://rpc.example.invalid/?token=fixture-private-token",
  genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  feedId: base.feedId, shard: 0, maxAgeSeconds: "30", maxConfidenceBps: 100,
};
const cli = new URL("../operator/oracle.mjs", import.meta.url).pathname;
const run = promisify(execFile);
const isCode = (code) => (error) => error instanceof OracleInspectionError && error.code === code;

function fixture() {
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(1000n);
  clock.writeBigInt64LE(BigInt(base.nowUnixSeconds), 32);
  const snapshot = { context: { slot: 1000 }, value: [
    { owner: new PublicKey("Sysvar1111111111111111111111111111111111111"), executable: false, data: clock },
    { owner: new PublicKey(PYTH_RECEIVER), executable: false, data: Buffer.from(base.dataHex, "hex") },
  ] };
  const calls = [];
  const connection = {
    async getGenesisHash() { calls.push("getGenesisHash"); return config.genesisHash; },
    async getSlot(commitment) { calls.push("getSlot"); assert.equal(commitment, "confirmed"); return 1000; },
    async getMultipleAccountsInfoAndContext(keys, options) {
      calls.push("getMultipleAccounts");
      assert.deepEqual(keys.map(k => k.toBase58()), [SYSVAR_CLOCK_PUBKEY.toBase58(), pythFeedAddress(config.feedId, 0).toBase58()]);
      assert.deepEqual(options, { commitment: "confirmed", minContextSlot: 1000 });
      return snapshot;
    },
  };
  return { snapshot, connection, calls };
}

test("oracle vectors identify the pinned engine and wrapper", () => {
  assert.equal(vectors.engineCommit, contract.engineCommit);
  assert.equal(vectors.wrapperCommit, contract.wrapperCommit);
  assert(contract.keeper.oracleOwners.includes(PYTH_RECEIVER));
});

for (const vector of vectors.cases) {
  test(`Pyth wrapper conformance: ${vector.name}`, () => {
    const input = { ...vector, data: Buffer.from(vector.dataHex, "hex"), nowUnixSeconds: BigInt(vector.nowUnixSeconds) };
    if (vector.expected.code) assert.throws(() => readPythPriceE6(input), isCode(vector.expected.code));
    else {
      const result = readPythPriceE6(input);
      assert.equal(result.priceE6, vector.expected.priceE6);
      assert.equal(result.publishTime, vector.expected.publishTime);
    }
  });
}

test("Core feed derivation matches the observed mainnet account and distinguishes shards", () => {
  assert.equal(pythFeedAddress(config.feedId, 0).toBase58(), vectors.liveSnapshot.address);
  assert.equal(pythFeedAddress(`0x${config.feedId.toUpperCase()}`, 0).toBase58(), vectors.liveSnapshot.address);
  assert.notEqual(pythFeedAddress(config.feedId, 1).toBase58(), vectors.liveSnapshot.address);
  assert.notEqual(pythFeedAddress(config.feedId, 65535).toBase58(), vectors.liveSnapshot.address);
});

test("configuration requires explicit bounded age, active confidence checks, feed and shard", () => {
  assert.equal(validateOracleConfig(config).account, vectors.liveSnapshot.address);
  for (const patch of [
    { version: 2 }, { shard: undefined }, { shard: -1 }, { shard: 65536 }, { shard: 0.5 },
    { feedId: "00".repeat(32) }, { feedId: "f".repeat(63) }, { feedId: "g".repeat(64) },
    { maxAgeSeconds: undefined }, { maxAgeSeconds: 30 }, { maxAgeSeconds: "01" },
    { maxAgeSeconds: "18446744073709551616" }, { maxAgeSeconds: "-1" },
    { maxConfidenceBps: undefined }, { maxConfidenceBps: 0 }, { maxConfidenceBps: 10001 },
    { maxConfidenceBps: 0.5 }, { rpcUrl: "http://rpc.example.invalid" },
    { genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" },
  ]) assert.throws(() => validateOracleConfig({ ...config, ...patch }), OracleInspectionError);
});

test("inspection uses a coherent confirmed Clock and feed, exact integer output and only read methods", async () => {
  const f = fixture(), result = await inspectPythOracle(config, f.connection);
  assert.deepEqual(f.calls, ["getGenesisHash", "getSlot", "getMultipleAccounts"]);
  assert.equal(result.status, "accepted");
  assert.equal(result.priceE6, "150000000");
  assert.equal(result.chainTime, base.nowUnixSeconds);
  assert.equal(result.ageSeconds, "30");
  assert.equal(result.keeperFeedId, new PublicKey(Buffer.from(config.feedId, "hex")).toBase58());
  assert.match(result.accountSha256, /^[a-f0-9]{64}$/);
  assert.match(result.clockSha256, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(result).includes("fixture-private-token"));
  assert(!Object.hasOwn(result, "rpcUrl"));
});

test("archived live SOL USD account is inspected at its original coherent bank", async () => {
  const raw = vectors.liveSnapshot;
  const connection = {
    async getGenesisHash() { return raw.genesisHash; },
    async getSlot() { return raw.context.slot; },
    async getMultipleAccountsInfoAndContext() {
      return { context: raw.context, value: raw.accounts.map(a => ({ ...a,
        owner: new PublicKey(a.owner), data: Buffer.from(a.data, "base64") })) };
    },
  };
  const result = await inspectPythOracle({ ...config, maxAgeSeconds: "60" }, connection);
  assert.equal(result.status, "accepted");
  assert.equal(result.bankSlot, raw.context.slot);
  assert.equal(result.priceE6, vectors.cases.at(-1).expected.priceE6);
});

test("wrong-network endpoint stops before reading any account", async () => {
  const f = fixture();
  f.connection.getGenesisHash = async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  await assert.rejects(inspectPythOracle(config, f.connection), isCode("oracleNetworkMismatch"));
  assert.equal(f.calls.length, 0);
});

for (const [name, change, reason] of [
  ["stale bank", f => f.snapshot.context.slot--, "oracleBankInvalid"],
  ["missing context", f => delete f.snapshot.context, "oracleBankInvalid"],
  ["wrong account count", f => f.snapshot.value.pop(), "oracleBankInvalid"],
  ["missing Clock", f => f.snapshot.value[0] = null, "oracleClockInvalid"],
  ["Clock owner", f => f.snapshot.value[0].owner = new PublicKey(Buffer.alloc(32)), "oracleClockInvalid"],
  ["executable Clock", f => f.snapshot.value[0].executable = true, "oracleClockInvalid"],
  ["truncated Clock", f => f.snapshot.value[0].data = Buffer.alloc(39), "oracleClockInvalid"],
  ["Clock from another bank", f => f.snapshot.value[0].data.writeBigUInt64LE(999n), "oracleClockInvalid"],
  ["nonpositive chain time", f => f.snapshot.value[0].data.writeBigInt64LE(-1n, 32), "oracleClockInvalid"],
]) test(`inspection rejects ${name}`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(inspectPythOracle(config, f.connection), isCode(reason));
});

for (const [name, change, reason] of [
  ["missing feed", f => f.snapshot.value[1] = null, "oracleAccountMissing"],
  ["wrong receiver", f => f.snapshot.value[1].owner = new PublicKey(Buffer.alloc(32)), "oracleWrongOwner"],
  ["executable feed", f => f.snapshot.value[1].executable = true, "oracleInvalidData"],
  ["stale publication", f => f.snapshot.value[1].data.writeBigInt64LE(1699999999n, 93), "oracleStale"],
  ["partial verification", f => f.snapshot.value[1].data[40] = 0, "oracleVerificationIncomplete"],
]) test(`inspection reports rejected ${name} without a usable price`, async () => {
  const f = fixture(); change(f);
  const result = await inspectPythOracle(config, f.connection);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.reasons, [reason]);
  assert(!Object.hasOwn(result, "priceE6"));
});

test("RPC errors cannot expose a credential-bearing provider response", async () => {
  for (const method of ["getGenesisHash", "getSlot", "getMultipleAccountsInfoAndContext"]) {
    const f = fixture();
    f.connection[method] = async () => { throw Error(`provider body: ${config.rpcUrl}`); };
    await assert.rejects(inspectPythOracle(config, f.connection), isCode("oracleRpcUnavailable"));
  }
});

test("real oracle CLI reads RPC without signing or modifying files and exits on stale evidence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "outright-oracle-"));
  const f = fixture(), methods = [];
  const genesis = new PublicKey(Buffer.alloc(32, 77)).toBase58();
  let stale = false;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); methods.push(request.method);
    let result;
    if (request.method === "getGenesisHash") result = genesis;
    else if (request.method === "getSlot") result = 1000;
    else if (request.method === "getMultipleAccounts") {
      assert.deepEqual(request.params[0], [SYSVAR_CLOCK_PUBKEY.toBase58(), vectors.liveSnapshot.address]);
      assert.equal(request.params[1].minContextSlot, 1000);
      const snap = f.snapshot;
      if (stale) snap.value[1].data.writeBigInt64LE(1699999999n, 93);
      result = { context: snap.context, value: snap.value.map(a => ({ ...a, lamports: 1, rentEpoch: 0,
        owner: a.owner.toBase58(), data: [a.data.toString("base64"), "base64"] })) };
    } else throw Error(`Unexpected RPC method ${request.method}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "oracle.json");
  const contents = JSON.stringify({ ...config, cluster: "localnet", genesisHash: genesis,
    rpcUrl: `http://127.0.0.1:${server.address().port}/?token=fixture-private-token` });
  await writeFile(path, contents, { mode: 0o600 });
  const first = await run(process.execPath, [cli, "--config", path], { timeout: 20000 });
  assert.equal(JSON.parse(first.stdout).status, "accepted");
  assert.equal(first.stderr, "");
  stale = true;
  await assert.rejects(run(process.execPath, [cli, "--config", path], { timeout: 20000 }), error => {
    assert.equal(error.code, 1);
    assert.deepEqual(JSON.parse(error.stdout).reasons, ["oracleStale"]);
    assert(!error.stdout.includes("fixture-private-token"));
    return true;
  });
  assert.deepEqual(methods, Array(2).fill(["getGenesisHash", "getSlot", "getMultipleAccounts"]).flat());
  assert.equal(await readFile(path, "utf8"), contents);
  assert.deepEqual(await readdir(directory), ["oracle.json"]);
});

test("oracle CLI rejects signing options without opening a keypair or contacting RPC", async () => {
  await assert.rejects(run(process.execPath, [cli, "--send", "--keypair", "fixture-private-path"]), error => {
    assert.equal(error.code, 1);
    assert.deepEqual(JSON.parse(error.stdout).reasons, ["oracleOptionsInvalid"]);
    assert(!error.stdout.includes("fixture-private-path"));
    assert.equal(error.stderr, "");
    return true;
  });
});
