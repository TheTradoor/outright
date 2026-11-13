import test from "node:test";
import assert from "node:assert/strict";
import {
  SystemProgram,
  SystemInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import contract from "../upstream-contract.json" with { type: "json" };
import {
  OutrightClient,
  readSnapshot,
  validateProfile,
  planAction,
} from "../src/client.mjs";
import { readMarket, positionForMarket } from "../src/market.mjs";
import { readPortfolio } from "../src/accounts.mjs";

import { fixture, info, pub, withMaker } from "./support/client-fixture.mjs";

test("CPI fee consent compares both parties with the on-chain base fee", async () => {
  const f = await withMaker(await fixture());
  const profile = { ...f.profile, maker: { ...f.profile.maker, feeBps: 50 } };
  const observed = await f.client.snapshot(f.owner.publicKey);
  const snapshot = {
    ...observed,
    maker: { ...observed.maker, matcherFeeCapBps: 37 },
    market: {
      ...observed.market,
      wrapper: { ...observed.market.wrapper, trade_fee_base_bps: 37n },
    },
  };
  const action = {
    type: "trade",
    side: "buy",
    size: "0.1",
    limitPrice: "150",
    assetIndex: 0,
  };
  assert.equal(planAction(profile, snapshot, action).instructions.length, 1);
  snapshot.maker.matcherFeeCapBps = 36;
  assert.throws(() => planAction(profile, snapshot, action), /fee.*consent/);
  snapshot.maker.matcherFeeCapBps = 100;
  snapshot.market.wrapper.trade_fee_base_bps = 51n;
  assert.throws(() => planAction(profile, snapshot, action), /fee.*consent/);
});

test("a base fee change during signing requires a fresh review even within consent", async () => {
  const f = await withMaker(await fixture());
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "trade",
    side: "buy",
    size: "0.1",
    limitPrice: "150",
    assetIndex: 0,
  });
  await assert.rejects(
    f.client.submit(review, async (bytes) => {
      f.accounts
        .get(f.market.toBase58())
        .data.writeBigUInt64LE(
          1n,
          contract.constants.headerLength +
            contract.layouts.wrapper.trade_fee_base_bps.offset,
        );
      return f.sign(bytes);
    }),
    /Trading fee policy changed/,
  );
  assert.equal(f.rpc.sent.length, 0);
  assert.equal(await f.client.pending(f.owner.publicKey), null);
});

test("Rust market fixture exposes collateral, assets and risk configuration", () => {
  const m = readMarket(
    info(pub(9), Buffer.from(contract.marketFixtureHex, "hex")),
    { programId: pub(9), address: pub(1), collateralMint: pub(5) },
  );
  assert.equal(m.current_slot, 123n);
  assert.equal(m.assets[0].effective_price, 150_000_000n);
  assert.equal(m.config.initial_margin_bps, 10_000n);
  assert.equal(m.mode, "live");
});
for (const mutation of ["identity", "length", "capacity", "mode", "mint"])
  test(`market rejects ${mutation} mismatch`, () => {
    const b = Buffer.from(contract.marketFixtureHex, "hex");
    let expected = {
        programId: pub(9),
        address: pub(1),
        collateralMint: pub(5),
      },
      data = b;
    if (mutation === "identity") expected.address = pub(11);
    if (mutation === "mint") expected.collateralMint = pub(11);
    if (mutation === "length") data = b.subarray(0, b.length - 1);
    if (mutation === "capacity")
      b.writeUInt32LE(2, contract.constants.marketCapacityOffset);
    if (mutation === "mode") b[contract.constants.marketModeOffset] = 3;
    assert.throws(() => readMarket(info(pub(9), data), expected));
  });
test("ADL quantity rounds conservatively and prior-reset obligations have no live exposure", () => {
  const m = {
    assets: [
      {
        market_id: 1n,
        a_long: 500_000_000_000_000n,
        epoch_long: 4n,
        mode_long: 0,
        effective_price: 150_000_000n,
      },
    ],
  };
  const leg = {
    active: true,
    asset_index: 0,
    market_id: 1n,
    side: 0,
    basis_pos_q: 3n,
    a_basis: 1_000_000_000_000_000n,
    epoch_snap: 4n,
  };
  assert.equal(positionForMarket(leg, m).effectiveSizeQ, 2n);
  m.assets[0].epoch_long = 5n;
  m.assets[0].mode_long = 2;
  assert.equal(positionForMarket(leg, m).effectiveSizeQ, 0n);
  m.assets[0].mode_long = 0;
  assert.throws(() => positionForMarket(leg, m), /epoch/);
});
test("inactive positions must match the upstream empty leg", () => {
  const b = Buffer.from(contract.portfolioFixtureHex, "hex");
  b[
    contract.constants.headerLength +
      contract.layouts.legsOffset +
      contract.layouts.leg.asset_index.offset
  ] = 1;
  assert.throws(
    () =>
      readPortfolio(info(pub(9), b), {
        programId: pub(9),
        address: pub(2),
        market: pub(1),
      }),
    /Hidden/,
  );
});

test("wallet lifecycle persists the signature before send and confirms only on a confirmed bank", async () => {
  const f = await fixture();
  const originalSend = f.rpc.sendRawTransaction;
  f.rpc.sendRawTransaction = async (bytes) => {
    assert.equal((await f.client.pending(f.owner.publicKey)).status, "signed");
    return originalSend(bytes);
  };
  const prepared = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1.123456",
  });
  assert.equal(prepared.networkFeeLamports, 5000);
  const sent = await f.client.submit(prepared, f.sign);
  assert.equal(sent.status, "submitted");
  assert.equal(f.rpc.sent.length, 1);
  await assert.rejects(() => f.client.submit(prepared, f.sign), /again/);
  await assert.rejects(
    () => f.client.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
    /Reconcile/,
  );
  f.rpc.slot = 124;
  f.rpc.status = { confirmationStatus: "processed", slot: 124, err: null };
  assert.equal((await f.client.reconcile(f.owner.publicKey)).status, "pending");
  f.rpc.status = { confirmationStatus: "confirmed", slot: 124, err: null };
  assert.equal(
    (await f.client.reconcile(f.owner.publicKey)).status,
    "confirmed",
  );
  assert.equal(await f.client.pending(f.owner.publicKey), null);
});
test("a lost send response survives reload and never produces a second deposit", async () => {
  const f = await fixture();
  f.rpc.sendRawTransaction = async (bytes) => {
    f.rpc.sent.push(bytes);
    throw new Error("response lost");
  };
  const prepared = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  assert.equal((await f.client.submit(prepared, f.sign)).status, "unknown");
  const reloaded = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  await assert.rejects(
    () => reloaded.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
    /Reconcile/,
  );
  f.rpc.height = 201;
  assert.equal(
    (await reloaded.reconcile(f.owner.publicKey)).status,
    "expiredUnresolved",
  );
  await assert.rejects(
    () => reloaded.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
    /Reconcile/,
  );
  f.rpc.slot = 124;
  f.rpc.status = { confirmationStatus: "finalized", slot: 124, err: null };
  assert.equal(
    (await reloaded.reconcile(f.owner.publicKey)).status,
    "finalized",
  );
  assert.equal(f.rpc.sent.length, 1);
});
test("simulation failure, wallet rejection, changed message and journal failure cannot broadcast", async () => {
  for (const failure of [
    "simulation",
    "wallet",
    "message",
    "journal",
    "signature",
    "network",
    "code",
    "expired",
  ]) {
    const f = await fixture();
    if (failure === "simulation") {
      f.rpc.simulateTransaction = async () => ({
        context: { slot: 123 },
        value: {
          err: { InstructionError: [2, "Custom"] },
          logs: ["insufficient margin"],
        },
      });
      await assert.rejects(
        () =>
          f.client.prepare(f.owner.publicKey, {
            type: "withdraw",
            amount: "1",
          }),
        /Simulation rejected/,
      );
    } else {
      const p = await f.client.prepare(f.owner.publicKey, {
        type: "deposit",
        amount: "1",
      });
      let sign = f.sign;
      if (failure === "wallet")
        sign = async () => {
          throw new Error("Rejected by wallet");
        };
      if (failure === "message")
        sign = async (bytes) => {
          const tx = VersionedTransaction.deserialize(bytes);
          tx.message.recentBlockhash = pub(24).toBase58();
          tx.sign([f.owner]);
          return tx.serialize();
        };
      if (failure === "signature") sign = async (bytes) => bytes;
      if (failure === "journal")
        f.journal.write = async () => {
          throw new Error("Storage unavailable");
        };
      if (failure === "network")
        f.rpc.getGenesisHash = async () => pub(32).toBase58();
      if (failure === "code")
        f.accounts.get(f.programData.toBase58()).data[45] ^= 1;
      if (failure === "expired") f.rpc.height = 201;
      await assert.rejects(() => f.client.submit(p, sign), undefined, failure);
    }
    assert.equal(f.rpc.sent.length, 0, failure);
  }
});
for (const mutation of [
  "owner",
  "mint",
  "vaultDelegate",
  "freeze",
  "program",
  "stale",
])
  test(`coherent snapshot rejects ${mutation}`, async () => {
    const f = await fixture();
    if (mutation === "owner")
      f.accounts.get(f.identity.address.toBase58()).owner = pub(10);
    if (mutation === "mint") f.accounts.get(f.mint.toBase58()).data[44] = 9;
    if (mutation === "vaultDelegate") {
      const b = f.accounts.get(f.vault.toBase58()).data;
      b.writeUInt32LE(1, 72);
      pub(11).toBuffer().copy(b, 76);
    }
    if (mutation === "freeze")
      f.accounts.get(f.userToken.toBase58()).data[108] = 2;
    if (mutation === "program")
      f.accounts.get(f.programId.toBase58()).executable = false;
    await assert.rejects(() =>
      readSnapshot(
        f.rpc,
        f.profile,
        f.owner.publicKey,
        mutation === "stale" ? 124 : 0,
      ),
    );
  });
test("creation and ATA withdrawal plans include rent; missing makers never fabricate liquidity", async () => {
  const f = await fixture();
  const snapshot = await f.client.snapshot(f.owner.publicKey);
  assert.throws(
    () =>
      planAction(f.profile, snapshot, {
        type: "trade",
        side: "buy",
        size: "1",
        limitPrice: "150",
        assetIndex: 0,
      }),
    /maker/,
  );
  f.accounts.delete(f.identity.address.toBase58());
  const init = await f.client.prepare(f.owner.publicKey, {
    type: "initialize",
  });
  assert.equal(init.rentLamports, 10_000_000);
  assert.equal(init.snapshot.portfolio, null);
  assert.throws(
    () => validateProfile({ ...f.profile, cluster: "mainnet-beta" }),
    /supports/,
  );
});

test("two browser clients cannot sign the same wallet concurrently", async () => {
  const f = await fixture();
  const second = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  const firstReview = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  const secondReview = await second.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  let resume;
  const wait = new Promise((resolve) => {
    resume = resolve;
  });
  let entered;
  const signing = new Promise((resolve) => {
    entered = resolve;
  });
  const first = f.client.submit(firstReview, async (bytes) => {
    entered();
    await wait;
    return f.sign(bytes);
  });
  await signing;
  await assert.rejects(
    () => second.submit(secondReview, f.sign),
    /Another tab/,
  );
  resume();
  await first;
  assert.equal(f.rpc.sent.length, 1);
});

test("confirmed failures are recorded without being reported as a successful fill", async () => {
  const f = await fixture();
  const p = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  await f.client.submit(p, f.sign);
  f.rpc.slot = 124;
  f.rpc.status = {
    confirmationStatus: "confirmed",
    slot: 124,
    err: { InstructionError: [2, "InvalidArgument"] },
  };
  const record = await f.client.reconcile(f.owner.publicKey);
  assert.equal(record.status, "failed");
  assert.deepEqual(record.error, f.rpc.status.err);
  assert.equal(await f.client.pending(f.owner.publicKey), null);
});

test("devnet pins require the complete genesis hash and localnet cannot alias a remote cluster", async () => {
  const f = await fixture();
  assert.doesNotThrow(() =>
    validateProfile({
      ...f.profile,
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    }),
  );
  assert.throws(
    () =>
      validateProfile({
        ...f.profile,
        rpcUrl: "https://api.mainnet-beta.solana.com",
      }),
    /loopback/,
  );
});

test("reconciliation holds the wallet lock until the receipt update completes", async () => {
  const f = await fixture();
  const second = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  const sent = await f.client.submit(review, f.sign);
  let release, entered;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  f.rpc.getSignatureStatuses = async () => {
    if (++calls === 1) {
      entered();
      await blocked;
    }
    return {
      context: { slot: 123 },
      value: [{ confirmationStatus: "confirmed", slot: 123, err: null }],
    };
  };
  const firstRead = f.client.reconcile(f.owner.publicKey);
  await reading;
  try {
    await assert.rejects(
      () => second.reconcile(f.owner.publicKey),
      /Another tab/,
    );
    assert.equal(
      (await second.pending(f.owner.publicKey)).signature,
      sent.signature,
    );
  } finally {
    release();
    await firstRead;
  }
  f.rpc.getLatestBlockhashAndContext = async () => ({
    context: { slot: 123 },
    value: { blockhash: pub(24).toBase58(), lastValidBlockHeight: 201 },
  });
  const nextReview = await second.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "2",
  });
  const next = await second.submit(nextReview, f.sign);
  assert.notEqual(next.signature, sent.signature);
  assert.equal(
    (await f.client.pending(f.owner.publicKey)).signature,
    next.signature,
  );
  assert.equal(f.rpc.sent.length, 2);
});

for (const lamports of [1, 10_000_000, 10_000_001])
  test(`a portfolio funded with ${lamports} lamports can still be initialized`, async () => {
    const f = await fixture();
    f.accounts.set(f.identity.address.toBase58(), {
      ...info(SystemProgram.programId, Buffer.alloc(0)),
      lamports,
    });
    const prepared = await f.client.prepare(f.owner.publicKey, {
      type: "initialize",
    });
    assert.equal(prepared.snapshot.portfolio, null);
    assert.equal(prepared.rentLamports, Math.max(0, 10_000_000 - lamports));
    const plan = planAction(
      f.profile,
      prepared.snapshot,
      { type: "initialize" },
      10_000_000,
    );
    const allocation = plan.instructions.find(
      (ix) =>
        ix.programId.equals(SystemProgram.programId) &&
        SystemInstruction.decodeInstructionType(ix) === "AllocateWithSeed",
    );
    assert.equal(
      SystemInstruction.decodeAllocateWithSeed(
        allocation,
      ).accountPubkey.toBase58(),
      f.identity.address.toBase58(),
    );
    await f.client.submit(prepared, f.sign);
    assert.equal(f.rpc.sent.length, 1);
  });

for (const change of [
  "matcher code",
  "maker consent",
  "maker expiry",
  "maker sequence",
  "oracle age",
  "market mode",
  "SOL balance",
])
  test(`trade submission rejects changed ${change} after the wallet prompt`, async () => {
    const f = await withMaker(await fixture());
    const prepared = await f.client.prepare(f.owner.publicKey, {
      type: "trade",
      side: "buy",
      size: "0.1",
      limitPrice: "150",
      assetIndex: 0,
    });
    await assert.rejects(() =>
      f.client.submit(prepared, async (bytes) => {
        const data = f.accounts.get(f.maker.portfolio.toBase58()).data,
          c = contract.constants;
        if (change === "matcher code")
          f.accounts.get(f.maker.programData.toBase58()).data[45] ^= 1;
        if (change === "maker consent")
          data.writeBigUInt64LE(
            data.readBigUInt64LE(c.portfolioControlOffset) & ~1n,
            c.portfolioControlOffset,
          );
        if (change === "maker expiry")
          data.writeBigUInt64LE(123n, contract.layouts.matcherExpiryOffset);
        if (change === "maker sequence")
          data.writeBigUInt64LE(
            data.readBigUInt64LE(c.portfolioSequenceOffset) + 1n,
            c.portfolioSequenceOffset,
          );
        if (change === "oracle age") f.rpc.slot += 21;
        if (change === "market mode")
          f.accounts.get(f.market.toBase58()).data[c.marketModeOffset] = 2;
        if (change === "SOL balance")
          f.accounts.get(f.owner.publicKey.toBase58()).lamports = 0;
        return f.sign(bytes);
      }),
    );
    assert.equal(f.rpc.sent.length, 0);
    assert.equal(f.records.size, 0);
  });

test("an unchanged trade still broadcasts after the fresh-state check", async () => {
  const f = await withMaker(await fixture());
  const prepared = await f.client.prepare(f.owner.publicKey, {
    type: "trade",
    side: "buy",
    size: "0.1",
    limitPrice: "150",
    assetIndex: 0,
  });
  assert.equal((await f.client.submit(prepared, f.sign)).status, "submitted");
  assert.equal(f.rpc.sent.length, 1);
});

test("a deposit sequence change during signing requires a new review", async () => {
  const f = await fixture();
  const prepared = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  await assert.rejects(
    () =>
      f.client.submit(prepared, async (bytes) => {
        const data = f.accounts.get(f.identity.address.toBase58()).data,
          off = contract.constants.portfolioSequenceOffset;
        data.writeBigUInt64LE(data.readBigUInt64LE(off) + 1n, off);
        return f.sign(bytes);
      }),
    /state changed/,
  );
  assert.equal(f.rpc.sent.length, 0);
});

test("funding a missing portfolio during the wallet prompt requires a new review", async () => {
  const f = await fixture();
  f.accounts.delete(f.identity.address.toBase58());
  const prepared = await f.client.prepare(f.owner.publicKey, {
    type: "initialize",
  });
  await assert.rejects(
    () =>
      f.client.submit(prepared, async (bytes) => {
        f.accounts.set(
          f.identity.address.toBase58(),
          info(SystemProgram.programId, Buffer.alloc(0)),
        );
        return f.sign(bytes);
      }),
    /state changed/,
  );
  assert.equal(f.rpc.sent.length, 0);
});

test("the review captures intent before asynchronous RPC work", async () => {
  const f = await fixture(),
    action = { type: "deposit", amount: "1" };
  const pending = f.client.prepare(f.owner.publicKey, action);
  action.amount = "2";
  const prepared = await pending;
  assert.equal(prepared.action.amount, "1");
  assert.equal(prepared.summary, "Deposit 1 TEST");
});

for (const state of ["executable", "data", "owner", "negative balance"])
  test(`allocation rejects a System account with invalid ${state}`, async () => {
    const f = await fixture();
    const value = info(SystemProgram.programId, Buffer.alloc(0));
    if (state === "executable") value.executable = true;
    if (state === "data") value.data = Buffer.alloc(1);
    if (state === "owner") value.owner = pub(40);
    if (state === "negative balance") value.lamports = -1;
    f.accounts.set(f.identity.address.toBase58(), value);
    await assert.rejects(() =>
      f.client.prepare(f.owner.publicKey, { type: "initialize" }),
    );
    assert.equal(f.rpc.sent.length, 0);
  });

for (const response of [
  "blockhash slot",
  "simulation slot",
  "fee slot",
  "blockhash height",
])
  test(`review rejects malformed RPC ${response}`, async () => {
    const f = await fixture();
    const name = response.startsWith("blockhash")
      ? "getLatestBlockhashAndContext"
      : response === "simulation slot"
        ? "simulateTransaction"
        : "getFeeForMessage";
    const original = f.rpc[name];
    f.rpc[name] = async (...args) => {
      const result = await original(...args);
      if (response === "blockhash height")
        result.value.lastValidBlockHeight = -1;
      else result.context.slot = NaN;
      return result;
    };
    await assert.rejects(
      () =>
        f.client.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
      /Invalid/,
    );
    assert.equal(f.rpc.sent.length, 0);
  });
test("an unreadable action releases the wallet action lock", async () => {
  const f = await fixture();
  await assert.rejects(
    f.client.prepare(f.owner.publicKey, {
      get type() {
        throw new Error("Action unavailable");
      },
    }),
    /Action unavailable/,
  );
  const next = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  assert.equal(next.summary, "Deposit 1 TEST");
  assert.equal(f.rpc.sent.length, 0);
});

for (const malformed of [
  "stale bank",
  "invalid bank",
  "future landing slot",
  "invalid landing slot",
  "missing error",
  "unknown commitment",
  "missing result",
  "extra result",
])
  test(`wallet preserves the pending receipt on ${malformed}`, async () => {
    const f = await fixture();
    const review = await f.client.prepare(f.owner.publicKey, {
      type: "deposit",
      amount: "1",
    });
    await f.client.submit(review, f.sign);
    const before = await f.client.pending(f.owner.publicKey);
    const response = {
      context: { slot: 124 },
      value: [{ confirmationStatus: "confirmed", slot: 124, err: null }],
    };
    if (malformed === "stale bank") response.context.slot = 122;
    if (malformed === "invalid bank") response.context.slot = NaN;
    if (malformed === "future landing slot") response.value[0].slot = 125;
    if (malformed === "invalid landing slot") response.value[0].slot = -1;
    if (malformed === "missing error") delete response.value[0].err;
    if (malformed === "unknown commitment")
      response.value[0].confirmationStatus = "unknown";
    if (malformed === "missing result") response.value = [];
    if (malformed === "extra result") response.value.push(null);
    f.rpc.getSignatureStatuses = async () => response;
    const reloaded = new OutrightClient(f.profile, {
      connection: f.rpc,
      journal: f.journal,
    });
    await assert.rejects(reloaded.reconcile(f.owner.publicKey), /Invalid/);
    assert.deepEqual(await reloaded.pending(f.owner.publicKey), before);
    await assert.rejects(
      reloaded.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
      /Reconcile/,
    );
    assert.equal(f.rpc.sent.length, 1);
  });

test("wallet accepts a landed transaction older than the current response bank", async () => {
  const f = await fixture();
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  await f.client.submit(review, f.sign);
  f.rpc.slot = 130;
  await f.client.snapshot(f.owner.publicKey);
  f.rpc.status = { confirmationStatus: "confirmed", slot: 124, err: null };
  assert.equal(
    (await f.client.reconcile(f.owner.publicKey)).confirmedSlot,
    124,
  );
});

for (const outcome of ["submitted", "confirmed", "finalized", "failed"])
  test(`a reloaded wallet snapshot honors the ${outcome} receipt bank`, async () => {
    const f = await fixture();
    const review = await f.client.prepare(f.owner.publicKey, {
      type: "deposit",
      amount: "1",
    });
    f.rpc.slot = 140;
    await f.client.submit(review, f.sign);
    if (outcome !== "submitted") {
      f.rpc.status = {
        confirmationStatus: outcome === "finalized" ? "finalized" : "confirmed",
        slot: 140,
        err:
          outcome === "failed"
            ? { InstructionError: [2, "InvalidArgument"] }
            : null,
      };
      assert.equal(
        (await f.client.reconcile(f.owner.publicKey)).status,
        outcome,
      );
    }
    const reloaded = new OutrightClient(f.profile, {
      connection: f.rpc,
      journal: f.journal,
    });
    const read = f.rpc.getMultipleAccountsInfoAndContext;
    let requestedSlot;
    f.rpc.getMultipleAccountsInfoAndContext = (keys, options) => {
      requestedSlot = options.minContextSlot;
      return read(keys, options);
    };
    f.rpc.slot = 139;
    await assert.rejects(
      reloaded.snapshot(f.owner.publicKey),
      /older snapshot/,
    );
    assert.equal(requestedSlot, 140);
    if (outcome !== "submitted")
      await assert.rejects(
        reloaded.prepare(f.owner.publicKey, { type: "deposit", amount: "2" }),
        /older snapshot/,
      );
    f.rpc.slot = 140;
    assert.equal((await reloaded.snapshot(f.owner.publicKey)).slot, 140);
    assert.equal(f.rpc.sent.length, 1);
  });

test("a legacy final receipt restores its landing slot before another review", async () => {
  const f = await fixture();
  const scope = f.client.scope(f.owner.publicKey);
  await f.journal.write(scope, {
    scope,
    status: "confirmed",
    confirmedSlot: 140,
  });
  await assert.rejects(
    f.client.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
    /older snapshot/,
  );
  f.rpc.slot = 140;
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  assert.equal(review.snapshot.slot, 140);
  assert.equal(f.rpc.sent.length, 0);
});

for (const field of ["minimumSlot", "confirmedSlot"])
  for (const invalid of [-1, 1.5, "140", null, NaN])
    test(`wallet rejects a final receipt with ${field}=${String(invalid)}`, async () => {
      const f = await fixture();
      const scope = f.client.scope(f.owner.publicKey);
      await f.journal.write(scope, {
        scope,
        status: "confirmed",
        [field]: invalid,
      });
      await assert.rejects(
        f.client.snapshot(f.owner.publicKey),
        /Invalid receipt/,
      );
      assert.equal(f.rpc.sent.length, 0);
    });

test("a late account read cannot return an older bank than a completed read", async () => {
  const f = await fixture();
  const read = f.rpc.getMultipleAccountsInfoAndContext;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let first = true;
  f.rpc.getMultipleAccountsInfoAndContext = async (...args) => {
    const result = await read(...args);
    if (first) {
      first = false;
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  const older = f.client.snapshot(f.owner.publicKey);
  await entered.promise;
  f.rpc.slot = 124;
  assert.equal((await f.client.snapshot(f.owner.publicKey)).slot, 124);
  const rejection = assert.rejects(older, /Invalid snapshot slot/);
  release.resolve();
  await rejection;
});

test("receipt persistence cannot lower a newer snapshot's bank", async () => {
  const f = await fixture();
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  await f.client.submit(review, f.sign);
  f.rpc.slot = 124;
  f.rpc.status = { confirmationStatus: "confirmed", slot: 124, err: null };
  const write = f.journal.write;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.journal.write = async (scope, record) => {
    if (record.status === "confirmed") {
      entered.resolve();
      await release.promise;
    }
    await write(scope, record);
  };
  const confirming = f.client.reconcile(f.owner.publicKey);
  await entered.promise;
  f.rpc.slot = 130;
  assert.equal((await f.client.snapshot(f.owner.publicKey)).slot, 130);
  release.resolve();
  await confirming;
  f.rpc.slot = 125;
  await assert.rejects(f.client.snapshot(f.owner.publicKey), /older snapshot/);
});
