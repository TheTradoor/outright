import assert from "node:assert/strict";
import { join } from "node:path";
import { OutrightClient } from "../src/client.mjs";
import { clientJournal, clientAction, saveJson } from "./runtime.mjs";
import { refreshMark } from "./market.mjs";
import { discoverPortfolios } from "../src/discovery.mjs";

export async function smoke(env) {
  const client = new OutrightClient(env.profile, {
    connection: env.rpc,
    journal: clientJournal(env.root),
  });
  const owner = env.config.trader;
  const before = await client.snapshot(owner);
  assert.equal(
    before.portfolio,
    null,
    "Use a fresh local market for the complete lifecycle check",
  );
  const discoveryBefore = await discoverPortfolios(env.rpc, env.profile, {
    maxTargets: 8,
    minimumSlot: before.slot,
  });
  assert.deepEqual(discoveryBefore.targets, [{
    address: before.maker.address,
    owner: before.maker.owner,
    portfolioId: before.maker.portfolioId.toString(),
  }]);
  const signatures = [];
  const act = async (action) => {
    await refreshMark(env);
    const signature = await clientAction(client, env.keys.trader, action);
    signatures.push({
      action: action.type,
      ...(action.side ? { side: action.side } : {}),
      signature,
    });
    return client.snapshot(owner);
  };
  let snapshot = await act({ type: "initialize" });
  assert.equal(snapshot.portfolio.capital, 0n);
  snapshot = await act({ type: "deposit", amount: "100" });
  assert.equal(snapshot.portfolio.capital, 100_000_000n);
  assert.equal(snapshot.tokenBalance, before.tokenBalance - 100_000_000n);
  const fundedBalance = snapshot.tokenBalance;
  await assert.rejects(
    client.prepare(owner, { type: "deposit", amount: "999999999" }),
  );
  assert.equal((await client.snapshot(owner)).tokenBalance, fundedBalance);
  for (const side of ["buy", "sell"]) {
    snapshot = await act({
      type: "trade",
      side,
      assetIndex: 0,
      size: "1",
      limitPrice: "1",
    });
    const position = snapshot.positions.find((p) => p.asset_index === 0);
    assert(
      position,
      "A position must be returned from confirmed account state",
    );
    assert.equal(
      position.effectiveSizeQ,
      side === "buy" ? 1_000_000n : -1_000_000n,
    );
    snapshot = await act({
      type: "trade",
      side: side === "buy" ? "sell" : "buy",
      assetIndex: 0,
      size: "1",
      limitPrice: "1",
    });
    assert(snapshot.positions.every((p) => p.effectiveSizeQ === 0n));
  }
  snapshot = await act({ type: "withdraw", amount: "100" });
  assert.equal(snapshot.portfolio.capital, 0n);
  assert.equal(snapshot.tokenBalance, before.tokenBalance);
  assert.equal(snapshot.maker.capital, 10_000_000_000n);
  const unique = new Set(signatures.map((r) => r.signature));
  assert.equal(unique.size, signatures.length);
  for (const receipt of signatures) {
    const result = await env.rpc.getTransaction(receipt.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert(
      result?.meta && result.meta.err === null,
      "Each lifecycle signature must have a successful recorded transaction",
    );
  }
  const discoveryAfter = await discoverPortfolios(env.rpc, env.profile, {
    maxTargets: 8,
    minimumSlot: snapshot.slot,
  });
  assert.deepEqual(discoveryAfter.targets, [snapshot.maker, snapshot.portfolio]
    .map(p => ({ address: p.address, owner: p.owner, portfolioId: p.portfolioId.toString() }))
    .sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  await assert.rejects(discoverPortfolios(env.rpc, env.profile, {
    maxTargets: 1, minimumSlot: discoveryAfter.slot,
  }), /target limit exceeded/);
  const report = {
    network: "localnet",
    genesisHash: env.config.genesisHash,
    program: env.config.program,
    market: env.config.market,
    trader: owner,
    instrument: "TEST/USD, fixed test price",
    signatures,
    beforeTokenAtoms: before.tokenBalance.toString(),
    afterTokenAtoms: snapshot.tokenBalance.toString(),
    finalPortfolioCapital: snapshot.portfolio.capital.toString(),
    makerCapital: snapshot.maker.capital.toString(),
    discovery: {
      before: discoveryBefore,
      after: discoveryAfter,
      overflowRejected: true,
      status: "passed",
    },
    status: "passed",
    at: new Date().toISOString(),
  };
  await saveJson(join(env.root, "lifecycle-report.json"), report);
  return report;
}
