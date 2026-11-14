#!/usr/bin/env node
// Qualification only: no deployment profile is generated or source pin changed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { open, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import contract from "../protocol/upstream-contract.json" with { type: "json" };
import { planAction, readSnapshot, portfolioAddress } from "../protocol/src/client.mjs";
import { TOKEN_PROGRAM_ID, vaultAuthority } from "../protocol/src/instructions.mjs";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "../protocol/src/token.mjs";
import { initializeMarket, initializeMint, mintTokens, initializeMatcher, matcherConsent, finalizeProgram } from "../protocol/localnet/instructions.mjs";
import { refreshMark } from "../protocol/localnet/market.mjs";
import { connection, privateDirectory, saveJson, programPin, send } from "../protocol/localnet/runtime.mjs";

const require = createRequire(new URL("../protocol/package.json", import.meta.url));
const { Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const args = process.argv.slice(2);
assert.equal(args.length, 5, "Pass validator, program, matcher, fresh private state directory and attestation");
const [validator, programBinary, matcherBinary, root, attestationPath] = args.map(value => resolve(value));
const attestation = JSON.parse(await readFile(attestationPath, "utf8"));
assert.equal(attestation.scope, "candidate-current-validator");
assert.equal(attestation.toolchain.platform_tools, "v1.58");
assert.equal(attestation.toolchain.sbf_arch, "v3");
assert.equal(attestation.toolchain.validator, "4.4.1");

async function verifyFiles() {
  for (const [name, path] of [["program", programBinary], ["matcher", matcherBinary]]) {
    const bytes = await readFile(path);
    assert(bytes.length > 0);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), attestation.binary_sha256[name], `${name} artifact changed`);
  }
}

async function bootstrap(env) {
  const { rpc, keys: k, config: c } = env;
  const pins = {};
  for (const [name, binary] of [["program", programBinary], ["matcher", matcherBinary]]) {
    const pin = await programPin(rpc, c[name], binary, [c.admin]);
    await send(rpc, root, `finalize-candidate-${name}`, [finalizeProgram(pin.programData, c.admin)], [k.admin]);
    pins[name] = await programPin(rpc, c[name], binary);
  }
  await send(rpc, root, "fund-local-fee-payers", ["maker", "trader"].map(name => SystemProgram.transfer({
    fromPubkey: k.admin.publicKey, toPubkey: k[name].publicKey, lamports: 2_000_000_000,
  })), [k.admin]);
  const allocation = async (signer, owner, space) => SystemProgram.createAccount({
    fromPubkey: k.admin.publicKey, newAccountPubkey: signer.publicKey,
    lamports: await rpc.getMinimumBalanceForRentExemption(space), space, programId: new PublicKey(owner),
  });
  await send(rpc, root, "create-test-mint", [await allocation(k.mint, TOKEN_PROGRAM_ID, 82), initializeMint(c.mint, c.admin)], [k.admin, k.mint]);
  await send(rpc, root, "initialize-test-market", [
    await allocation(k.market, c.program, contract.localnet.marketAccountLength), initializeMarket(c.program, c.admin, c.market, c.mint),
  ], [k.admin, k.market]);
  const vaultOwner = vaultAuthority(c.program, c.market);
  const vault = getAssociatedTokenAddressSync(k.mint.publicKey, vaultOwner, true);
  await send(rpc, root, "create-collateral-vault", [
    createAssociatedTokenAccountIdempotentInstruction(k.admin.publicKey, vault, vaultOwner, k.mint.publicKey),
  ], [k.admin]);
  for (const name of ["maker", "trader"]) {
    const owner = k[name].publicKey;
    const ata = getAssociatedTokenAddressSync(k.mint.publicKey, owner);
    await send(rpc, root, `fund-test-${name}`, [
      createAssociatedTokenAccountIdempotentInstruction(k.admin.publicKey, ata, owner, k.mint.publicKey),
      mintTokens(c.mint, ata, c.admin, name === "maker" ? 10_000_000_000n : 1_000_000_000n),
    ], [k.admin]);
  }
  await refreshMark(env, true);
  // In-memory instruction/snapshot settings, deliberately not a deployment
  // profile. Candidate identity is base + patch + tree in the attestation.
  const settings = {
    genesisHash: c.genesisHash, program: pins.program, market: c.market,
    collateral: { mint: c.mint, decimals: 6, symbol: "TEST", mintAuthority: c.admin, freezeAuthority: null },
    vault: vault.toBase58(), maker: null, maxOracleAgeSlots: 30,
    assets: [{ index: 0, marketId: "1", symbol: "TEST/USD" }],
  };
  const act = async (signer, action, label) => {
    const snapshot = await readSnapshot(rpc, settings, signer.publicKey);
    const rent = action.type === "initialize" ? await rpc.getMinimumBalanceForRentExemption(contract.constants.portfolioLength) : 0;
    const plan = planAction(settings, snapshot, action, rent);
    return send(rpc, root, label, plan.instructions, [signer]);
  };
  await act(k.maker, { type: "initialize" }, "initialize-maker");
  await act(k.maker, { type: "deposit", amount: "10000" }, "fund-maker-capital");
  const makerPortfolio = (await portfolioAddress(c.maker, c.market, c.program)).address;
  await send(rpc, root, "initialize-test-matcher", [
    await allocation(k.context, c.matcher, 256),
    initializeMatcher(c.program, c.matcher, c.context, c.maker, c.market, makerPortfolio),
  ], [k.admin, k.context, k.maker]);
  const makerSnapshot = await readSnapshot(rpc, settings, c.maker);
  await send(rpc, root, "authorize-test-maker", [matcherConsent(
    c.program, c.matcher, c.context, c.maker, c.market, makerPortfolio,
    makerSnapshot.portfolio, makerSnapshot.market.next_market_id, makerSnapshot.slot + 1_000_000,
  )], [k.maker]);
  settings.maker = {
    program: pins.matcher, context: c.context, portfolio: makerPortfolio.toBase58(), owner: c.maker,
    feeBps: 100, backingFeeCapBps: 0,
  };
  const ready = await readSnapshot(rpc, settings, c.trader);
  assert.equal(ready.makerError, null);
  assert.equal(ready.maker.capital, 10_000_000_000n);
  return { settings, act, pins };
}

async function lifecycle(env, settings, act, pins) {
  const owner = env.config.trader;
  const before = await readSnapshot(env.rpc, settings, owner);
  assert.equal(before.portfolio, null);
  assert.equal(before.tokenBalance, 1_000_000_000n);
  const signatures = [];
  const action = async value => {
    await refreshMark(env);
    const signature = await act(env.keys.trader, value, `candidate-${signatures.length}-${value.type}`);
    signatures.push({ action: value.type, ...(value.side ? { side: value.side } : {}), signature });
    return readSnapshot(env.rpc, settings, owner);
  };
  let snapshot = await action({ type: "initialize" });
  assert.equal(snapshot.portfolio.capital, 0n);
  snapshot = await action({ type: "deposit", amount: "100" });
  assert.equal(snapshot.portfolio.capital, 100_000_000n);
  assert.equal(snapshot.tokenBalance, before.tokenBalance - 100_000_000n);
  const fundedBalance = snapshot.tokenBalance;
  assert.throws(() => planAction(settings, snapshot, { type: "deposit", amount: "999999999" }), /Insufficient wallet collateral/);
  assert.equal((await readSnapshot(env.rpc, settings, owner)).tokenBalance, fundedBalance);
  for (const side of ["buy", "sell"]) {
    snapshot = await action({ type: "trade", side, assetIndex: 0, size: "1", limitPrice: "1" });
    const position = snapshot.positions.find(p => p.asset_index === 0);
    assert(position);
    assert.equal(position.effectiveSizeQ, side === "buy" ? 1_000_000n : -1_000_000n);
    snapshot = await action({ type: "trade", side: side === "buy" ? "sell" : "buy", assetIndex: 0, size: "1", limitPrice: "1" });
    assert(snapshot.positions.every(p => p.effectiveSizeQ === 0n));
  }
  snapshot = await action({ type: "withdraw", amount: "100" });
  assert.equal(snapshot.portfolio.capital, 0n);
  assert.equal(snapshot.tokenBalance, before.tokenBalance);
  assert.equal(snapshot.maker.capital, 10_000_000_000n);
  assert.equal(signatures.length, 7);
  assert.equal(new Set(signatures.map(r => r.signature)).size, 7);
  for (const receipt of signatures) {
    const result = await env.rpc.getTransaction(receipt.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    assert(result?.meta && result.meta.err === null, "Every lifecycle signature must have successful transaction metadata");
  }
  await verifyFiles();
  // programPin compares complete deployed bytes and zero padding, then checks
  // loader/account identity and revoked upgrade authority again after execution.
  assert.deepEqual(await programPin(env.rpc, env.config.program, programBinary), pins.program);
  assert.deepEqual(await programPin(env.rpc, env.config.matcher, matcherBinary), pins.matcher);
  return {
    scope: "candidate-current-validator", status: "passed", network: "localnet",
    instrument: "TEST/USD, fixed test price", identity: attestation, deployed: pins,
    genesisHash: env.config.genesisHash, signatures,
    oversizedDepositRejected: true, beforeTokenAtoms: before.tokenBalance.toString(),
    afterTokenAtoms: snapshot.tokenBalance.toString(), finalPortfolioCapital: snapshot.portfolio.capital.toString(),
    makerCapital: snapshot.maker.capital.toString(), at: new Date().toISOString(),
  };
}

async function main() {
  await verifyFiles();
  await privateDirectory(root);
  assert.equal((await readdir(root)).length, 0, "Use an empty private state directory");
  const rpc = connection("http://127.0.0.1:8899");
  let listening = false;
  try { await rpc.getVersion(); listening = true; } catch {}
  assert(!listening, "An RPC is already listening; qualification requires a fresh validator");
  const keys = Object.fromEntries(["admin", "maker", "trader", "market", "mint", "context"].map(name => [name, Keypair.generate()]));
  const config = {
    program: Keypair.generate().publicKey.toBase58(), matcher: Keypair.generate().publicKey.toBase58(),
    ...Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, key.publicKey.toBase58()])),
  };
  const log = await open(join(root, "validator-output.log"), "wx", 0o600);
  const child = spawn(validator, ["--ledger", join(root, "ledger"), "--bind-address", "127.0.0.1", "--rpc-port", "8899", "--faucet-port", "8901", "--quiet", "--mint", config.admin,
    "--upgradeable-program", config.program, programBinary, config.admin,
    "--upgradeable-program", config.matcher, matcherBinary, config.admin,
  ], { stdio: ["ignore", log.fd, log.fd] });
  let startError, stopped = false;
  child.on("error", error => { startError = error; });
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await log.close();
    let ready = false;
    const until = Date.now() + 60000;
    while (!stopped && Date.now() < until) {
      assert(!startError && child.exitCode === null && child.signalCode === null, "Validator failed to start; inspect validator logs");
      try {
        config.genesisHash = await rpc.getGenesisHash();
        if ((await rpc.getSlot("finalized")) > 0) { ready = true; break; }
      } catch {}
      await pause(300);
    }
    assert(ready && !stopped, "Validator did not become ready");
    const env = { root, rpc, keys, config };
    const { settings, act, pins } = await bootstrap(env);
    const report = await lifecycle(env, settings, act, pins);
    assert(!stopped, "Qualification was interrupted");
    await saveJson(join(root, "lifecycle-report.json"), report, { exclusive: true });
    console.log(JSON.stringify(report));
  } finally {
    await log.close().catch(() => {});
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const until = Date.now() + 10000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < until) await pause(100);
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(done => child.once("exit", done));
        child.kill("SIGKILL");
        await exited;
      }
    }
  }
}
main().catch(error => {
  console.error(error.stack || error.message);
  if (error.logs) console.error(error.logs.join("\n"));
  process.exitCode = 1;
});
