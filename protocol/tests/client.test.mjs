import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import contract from "../upstream-contract.json" with { type: "json" };
import {
  OutrightClient,
  portfolioAddress,
  readSnapshot,
  validateProfile,
  sha256,
  planAction,
} from "../src/client.mjs";
import { readMarket, positionForMarket } from "../src/market.mjs";
import { readPortfolio } from "../src/accounts.mjs";
import {
  ENGINE_COMMIT,
  WRAPPER_COMMIT,
  vaultAuthority,
  TOKEN_PROGRAM_ID,
} from "../src/instructions.mjs";

const pub = (n) => new PublicKey(Buffer.alloc(32, n));
const info = (owner, data, executable = false) => ({
  owner,
  data,
  executable,
  lamports: 1_000_000_000,
  rentEpoch: 0,
});
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
function token(mint, owner, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b);
  owner.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1;
  return info(TOKEN_PROGRAM_ID, b);
}
export async function fixture() {
  const owner = Keypair.fromSeed(Buffer.alloc(32, 17)),
    programId = pub(9),
    programData = pub(8),
    market = pub(1),
    mint = pub(5);
  const identity = await portfolioAddress(owner.publicKey, market, programId);
  const vault = getAssociatedTokenAddressSync(
    mint,
    vaultAuthority(programId, market),
    true,
  );
  const userToken = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const code = Buffer.from(
    "test program image; SBF execution is covered separately",
  );
  const p = Buffer.alloc(36);
  p.writeUInt32LE(2);
  programData.toBuffer().copy(p, 4);
  const pd = Buffer.alloc(45 + code.length);
  pd.writeUInt32LE(3);
  pd.writeBigUInt64LE(100n, 4);
  code.copy(pd, 45);
  const mintBytes = Buffer.alloc(82);
  mintBytes[44] = 6;
  mintBytes[45] = 1;
  const portfolio = Buffer.from(contract.portfolioFixtureHex, "hex");
  identity.address
    .toBuffer()
    .copy(portfolio, contract.constants.portfolioAddressOffset);
  owner.publicKey
    .toBuffer()
    .copy(portfolio, contract.constants.portfolioOwnerOffset);
  owner.publicKey
    .toBuffer()
    .copy(portfolio, contract.constants.portfolioProvenanceOwnerOffset);
  const accounts = new Map([
    [programId.toBase58(), info(loader, p, true)],
    [programData.toBase58(), info(loader, pd)],
    [
      market.toBase58(),
      info(programId, Buffer.from(contract.marketFixtureHex, "hex")),
    ],
    [mint.toBase58(), info(TOKEN_PROGRAM_ID, mintBytes)],
    [
      vault.toBase58(),
      token(mint, vaultAuthority(programId, market), 1_000_000_000n),
    ],
    [userToken.toBase58(), token(mint, owner.publicKey, 1_000_000_000n)],
    [
      owner.publicKey.toBase58(),
      info(SystemProgram.programId, Buffer.alloc(0)),
    ],
    [identity.address.toBase58(), info(programId, portfolio)],
  ]);
  const profile = validateProfile({
    version: 1,
    cluster: "localnet",
    rpcUrl: "http://127.0.0.1:8899",
    genesisHash: pub(31).toBase58(),
    engineCommit: ENGINE_COMMIT,
    wrapperCommit: WRAPPER_COMMIT,
    program: {
      address: programId,
      programData,
      sha256: await sha256(code),
      upgradeAuthority: null,
    },
    market,
    vault,
    collateral: {
      mint,
      decimals: 6,
      symbol: "TEST",
      mintAuthority: null,
      freezeAuthority: null,
    },
    assets: [{ index: 0, marketId: "1", symbol: "SOL/USD" }],
    maxOracleAgeSlots: 20,
  });
  const records = new Map();
  let locked = false;
  const journal = {
    read: async (k) => structuredClone(records.get(k) || null),
    write: async (k, r) => {
      records.set(k, structuredClone(r));
    },
    withLock: async (scope, work) => {
      if (locked) throw new Error("Another tab is signing");
      locked = true;
      try {
        return await work();
      } finally {
        locked = false;
      }
    },
  };
  const rpc = {
    slot: 123,
    height: 100,
    sent: [],
    status: null,
    getGenesisHash: async () => profile.genesisHash,
    getMultipleAccountsInfoAndContext: async (keys) => ({
      context: { slot: rpc.slot },
      value: keys.map((k) => accounts.get(k.toBase58()) || null),
    }),
    getLatestBlockhashAndContext: async () => ({
      context: { slot: rpc.slot },
      value: { blockhash: pub(23).toBase58(), lastValidBlockHeight: 200 },
    }),
    getMinimumBalanceForRentExemption: async () => 10_000_000,
    simulateTransaction: async () => ({
      context: { slot: rpc.slot },
      value: { err: null, unitsConsumed: 140_000 },
    }),
    getFeeForMessage: async () => ({
      context: { slot: rpc.slot },
      value: 5000,
    }),
    getBlockHeight: async () => rpc.height,
    sendRawTransaction: async (bytes) => {
      rpc.sent.push(bytes);
      return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);
    },
    getSignatureStatuses: async () => ({
      context: { slot: rpc.slot },
      value: [rpc.status],
    }),
  };
  const sign = async (bytes) => {
    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([owner]);
    return tx.serialize();
  };
  const client = new OutrightClient(profile, { connection: rpc, journal });
  return {
    profile,
    rpc,
    owner,
    accounts,
    identity,
    client,
    journal,
    records,
    sign,
    programId,
    market,
    mint,
    vault,
    userToken,
    programData,
  };
}

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
