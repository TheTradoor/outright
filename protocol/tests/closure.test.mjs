import test from "node:test";
import assert from "node:assert/strict";
import contract from "../upstream-contract.json" with { type: "json" };
import { OutrightClient, planAction } from "../src/client.mjs";
import { readMarket } from "../src/market.mjs";
import { canReviewPortfolioClosure } from "../src/settlement.mjs";
import {
  buildInstruction,
  encodeInstruction,
  TOKEN_PROGRAM_ID,
  vaultAuthority,
} from "../src/instructions.mjs";
import { fixture, pub } from "./support/client-fixture.mjs";
import { setSettlement } from "./support/settlement-fixture.mjs";

async function emptyFixture() {
  return setSettlement(await fixture(), {
    receipt: { paid_effective: 2000n, finalized: true },
  });
}

test("a failed closure cannot reuse its blockhash after reload", async () => {
  const f = await emptyFixture();
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "closePortfolio",
  });
  await f.client.submit(review, f.sign);
  f.rpc.status = {
    slot: 123,
    confirmations: 1,
    err: { InstructionError: [2, { Custom: 12 }] },
    confirmationStatus: "confirmed",
  };
  assert.equal((await f.client.reconcile(f.owner.publicKey)).status, "failed");
  const client = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  await assert.rejects(
    client.prepare(f.owner.publicKey, { type: "closePortfolio" }),
    /new blockhash.*closure/,
  );
  f.rpc.getLatestBlockhashAndContext = async () => ({
    context: { slot: 123 },
    value: { blockhash: pub(24).toBase58(), lastValidBlockHeight: 201 },
  });
  const next = await client.prepare(f.owner.publicKey, {
    type: "closePortfolio",
  });
  const record = await client.submit(next, f.sign);
  assert.notEqual(record.messageHash, review.messageHash);
  assert.equal(f.rpc.sent.length, 2);
});

test("a final receipt in another tab prevents closure replay before the wallet prompt", async () => {
  const f = await emptyFixture();
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "closePortfolio",
  });
  const scope = f.client.scope(f.owner.publicKey);
  await f.journal.write(scope, {
    scope,
    status: "failed",
    blockhash: pub(23).toBase58(),
    minimumSlot: 123,
  });
  let prompts = 0;
  await assert.rejects(
    f.client.submit(review, async (bytes) => {
      prompts++;
      return f.sign(bytes);
    }),
    /new blockhash.*closure/,
  );
  assert.equal(prompts, 0);
  assert.equal(f.rpc.sent.length, 0);
});

test("a Rust-generated closed-market tombstone stops wallet actions with a clear message", async () => {
  const f = await fixture();
  const account = f.accounts.get(f.market.toBase58());
  account.data = Buffer.from(contract.closedMarketFixtureHex, "hex");
  await assert.rejects(
    f.client.snapshot(f.owner.publicKey),
    /Market has been closed/,
  );
  await assert.rejects(
    f.client.prepare(f.owner.publicKey, { type: "closePortfolio" }),
    /Market has been closed/,
  );
  assert.equal(f.rpc.sent.length, 0);
  for (const malformed of [
    { ...account, owner: pub(30) },
    { ...account, executable: true },
    { ...account, data: Buffer.from(account.data).fill(0, 0, 8) },
    { ...account, data: Buffer.from(account.data).fill(0, 8, 10) },
  ]) {
    assert.throws(
      () =>
        readMarket(malformed, {
          programId: f.programId,
          address: f.market,
          collateralMint: f.mint,
        }),
      (error) => !/Market has been closed/.test(error.message),
    );
  }
});

test("resolved account closure binds owner and incarnation without allocating a token account", async () => {
  const f = await emptyFixture();
  f.accounts.delete(f.userToken.toBase58());
  f.rpc.getMinimumBalanceForRentExemption = async () =>
    assert.fail("closure must not quote rent");
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "closePortfolio",
  });
  const plan = planAction(f.profile, review.snapshot, review.action);
  assert.equal(plan.rentLamports, 0);
  assert.equal(plan.instructions.length, 1);
  assert.match(plan.summary, /all account SOL goes to the market/);
  const ix = plan.instructions[0],
    p = review.snapshot.portfolio;
  assert.equal(ix.data[0], 8);
  assert.equal(ix.data.readBigUInt64LE(1), p.portfolioId);
  assert.equal(ix.data.readBigUInt64LE(9), p.expectedSequence);
  assert.equal(ix.data.readBigUInt64LE(17), p.positionEpoch);
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [f.owner.publicKey.toBase58(), true, false],
      [f.market.toBase58(), false, true],
      [f.identity.address.toBase58(), false, true],
    ],
  );
  const record = await f.client.submit(review, f.sign);
  assert.equal(record.status, "submitted");
  assert.equal(f.rpc.sent.length, 1);
  f.rpc.status = {
    slot: 123,
    confirmations: 1,
    err: null,
    confirmationStatus: "confirmed",
  };
  await f.client.reconcile(f.owner.publicKey);
  f.accounts.delete(f.identity.address.toBase58());
  const closed = await f.client.snapshot(f.owner.publicKey);
  assert.equal(closed.portfolio, null);
  assert.equal(canReviewPortfolioClosure(closed), false);
});

for (const [name, mutate] of [
  ["live market", (s) => (s.market.mode = "live")],
  ["Recovery market", (s) => (s.market.mode = "recovery")],
  ["absent account", (s) => (s.portfolio = null)],
  ["capital", (s) => (s.portfolio.capital = 1n)],
  ["positive PnL", (s) => (s.portfolio.pnl = 1n)],
  ["negative PnL", (s) => (s.portfolio.pnl = -1n)],
  ["position", (s) => (s.portfolio.positions = [{}])],
  ["unpaid receipt", (s) => (s.portfolio.resolvedPayout.finalized = false)],
  ...["reserved_pnl", "fee_credits", "active_bitmap"].map((k) => [
    k,
    (s) => (s.portfolio.state[k] = 1n),
  ]),
  ...["stale_state", "b_stale_state", "rebalance_lock", "liquidation_lock"].map(
    (k) => [k, (s) => (s.portfolio.state[k] = true)],
  ),
])
  test(`account closure review refuses ${name}`, async () => {
    const f = await emptyFixture(),
      s = structuredClone(await f.client.snapshot(f.owner.publicKey));
    mutate(s);
    assert.equal(canReviewPortfolioClosure(s), false);
    assert.throws(() => planAction(f.profile, s, { type: "closePortfolio" }));
  });

for (const target of ["market", "portfolio"])
  test(`account closure refuses changed ${target} accounting after signing`, async () => {
    const f = await emptyFixture();
    const review = await f.client.prepare(f.owner.publicKey, {
      type: "closePortfolio",
    });
    const key = target === "market" ? f.market : f.identity.address;
    const offset =
      target === "market"
        ? contract.constants.marketGroupOffset +
          contract.layouts.market.insurance.offset
        : contract.constants.headerLength +
          contract.layouts.reviewAccountingOffsets.sourceBacking;
    await assert.rejects(
      f.client.submit(review, async (bytes) => {
        f.accounts.get(key.toBase58()).data[offset] ^= 1;
        return f.sign(bytes);
      }),
      /Portfolio accounting changed/,
    );
    assert.equal(f.rpc.sent.length, 0);
    assert.equal(f.records.size, 0);
  });

test("engine simulation can refuse closure beyond the preliminary display checks", async () => {
  const f = await emptyFixture();
  assert.equal(
    canReviewPortfolioClosure(await f.client.snapshot(f.owner.publicKey)),
    true,
  );
  f.rpc.simulateTransaction = async () => ({
    context: { slot: 123 },
    value: {
      err: { InstructionError: [2, { Custom: 12 }] },
      logs: ["account remains encumbered"],
    },
  });
  await assert.rejects(
    f.client.prepare(f.owner.publicKey, { type: "closePortfolio" }),
    /Simulation/i,
  );
  assert.equal(f.rpc.sent.length, 0);
});

test("closure encoders reject ambiguous or out-of-range bindings", () => {
  const valid = { portfolioId: "1", expectedSequence: "0", positionEpoch: "0" };
  for (const value of [0, "0", "-1", (1n << 64n).toString()])
    assert.throws(() =>
      encodeInstruction("closePortfolio", { ...valid, portfolioId: value }),
    );
  for (const value of [1, "-1", (1n << 64n).toString()])
    assert.throws(() =>
      encodeInstruction("closePortfolio", {
        ...valid,
        expectedSequence: value,
      }),
    );
  for (const value of [1, "-1", (1n << 49n).toString()])
    assert.throws(() =>
      encodeInstruction("closePortfolio", { ...valid, positionEpoch: value }),
    );
  for (const value of [1, "-1", (1n << 64n).toString()])
    assert.throws(() =>
      encodeInstruction("closeSlab", { authorityEpoch: value }),
    );
  assert.throws(
    () =>
      buildInstruction(pub(9), "closePortfolio", valid, {
        owner: pub(1),
        market: pub(1),
        portfolio: pub(2),
      }),
    /identities/,
  );
});

test("market closure binds the authority, writable mint and canonical vault authority", () => {
  const a = {
    owner: pub(1),
    market: pub(2),
    vault: pub(3),
    userToken: pub(4),
    mint: pub(5),
  };
  const ix = buildInstruction(pub(9), "closeSlab", { authorityEpoch: "7" }, a);
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [a.owner.toBase58(), true, true],
      [a.market.toBase58(), false, true],
      [a.vault.toBase58(), false, true],
      [vaultAuthority(pub(9), a.market).toBase58(), false, false],
      [a.userToken.toBase58(), false, true],
      [TOKEN_PROGRAM_ID.toBase58(), false, false],
      [a.mint.toBase58(), false, true],
    ],
  );
  for (const name of ["market", "vault", "userToken", "mint"])
    assert.throws(
      () =>
        buildInstruction(
          pub(9),
          "closeSlab",
          { authorityEpoch: "7" },
          { ...a, [name]: a.owner },
        ),
      /identities/,
    );
  assert.throws(
    () =>
      buildInstruction(
        pub(9),
        "closeSlab",
        { authorityEpoch: "7" },
        { ...a, mint: "So11111111111111111111111111111111111111112" },
      ),
    /Native collateral/,
  );
});
