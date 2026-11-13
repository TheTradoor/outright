import test from "node:test";
import assert from "node:assert/strict";
import { OutrightClient, planAction } from "../src/client.mjs";
import { encodeInstruction, buildInstruction } from "../src/instructions.mjs";
import { recoveryPosition } from "../src/recovery.mjs";
import contract from "../upstream-contract.json" with { type: "json" };
import { fixture, pub } from "./support/client-fixture.mjs";
import { setRecovery } from "./support/recovery-fixture.mjs";

const action = {
  type: "forfeitRecoveryLeg",
  assetIndex: 0,
  marketId: "1",
  budget: "0.000001",
  acceptForfeiture: true,
};

for (const side of [0, 1])
  for (const [name, options, eligible] of [
    ["asset Recovery", {}, true],
    ["market Recovery", { mode: 2, lifecycle: 2 }, true],
    ["DrainOnly", { lifecycle: 3, sideMode: 1 }, true],
    ["active side", { lifecycle: 2 }, false],
  ])
    test(`zero-basis ${side === 0 ? "long" : "short"} obligation remains readable in ${name}`, async () => {
      const f = setRecovery(await fixture(), {
        ...options,
        side,
        leg: { basis_pos_q: 0n },
      });
      const s = await f.client.snapshot(f.owner.publicKey);
      assert.equal(s.portfolio.positions.length, 1);
      assert.equal(s.positions[0].effectiveSizeQ, 0n);
      assert.equal(s.positions[0].needsCleanup, true);
      assert.equal(s.positions[0].loss_weight, 10_000_000n);
      assert.equal(Boolean(recoveryPosition(s, 0)), eligible);
      if (eligible)
        assert.equal(planAction(f.profile, s, action).instructions.length, 1);
    });

for (const [name, leg] of [
  ["zero loss weight", { basis_pos_q: 0n, loss_weight: 0n }],
  [
    "excess loss weight",
    {
      basis_pos_q: 0n,
      loss_weight: BigInt(contract.layouts.socialLossDen) + 1n,
    },
  ],
  [
    "excess remainder",
    { basis_pos_q: 0n, b_rem: BigInt(contract.layouts.socialLossDen) },
  ],
  ["mismatched B epoch", { basis_pos_q: 0n, b_epoch_snap: 1n }],
  ["zero A basis", { basis_pos_q: 0n, a_basis: 0n }],
  [
    "oversized A basis",
    { basis_pos_q: 0n, a_basis: BigInt(contract.layouts.adlOne) + 1n },
  ],
  ["insufficient retained weight", { loss_weight: 1n }],
  [
    "out-of-range basis",
    { basis_pos_q: BigInt(contract.layouts.maxPositionAbsQ) + 1n },
  ],
  ["minimum K snapshot", { basis_pos_q: 0n, k_snap: -(1n << 127n) }],
  ["minimum F snapshot", { basis_pos_q: 0n, f_snap: -(1n << 127n) }],
])
  test(`obligation support still rejects ${name}`, async () => {
    const f = setRecovery(await fixture(), { leg });
    await assert.rejects(
      f.client.snapshot(f.owner.publicKey),
      /Invalid active position|loss weight/,
    );
    assert.equal(f.rpc.sent.length, 0);
  });

test("zero exposure does not bypass asset incarnation or epoch validation", async () => {
  for (const leg of [{ market_id: 2n }, { epoch_snap: 2n, b_epoch_snap: 2n }]) {
    const f = setRecovery(await fixture(), {
      leg: { basis_pos_q: 0n, ...leg },
    });
    await assert.rejects(
      f.client.snapshot(f.owner.publicKey),
      /identity|epoch/,
    );
  }
});

for (const [name, options, allowed] of [
  ["asset Recovery", {}, true],
  ["market Recovery", { mode: 2, lifecycle: 2 }, true],
  ["reset obligation", { lifecycle: 2, sideMode: 2 }, true],
  ["active trading position", { lifecycle: 2 }, false],
  ["live DrainOnly exposure", { lifecycle: 3, sideMode: 1 }, false],
  ["resolved market", { mode: 1 }, false],
])
  test(`recovery admission handles ${name}`, async () => {
    const f = setRecovery(await fixture(), options);
    const s = await f.client.snapshot(f.owner.publicKey);
    assert.equal(Boolean(recoveryPosition(s, 0)), allowed);
    if (!allowed)
      assert.throws(
        () => planAction(f.profile, s, action),
        /eligible|live or recovery/,
      );
  });

test("recovery plan binds the owner, incarnation, epoch and exact shared-loss budget", async () => {
  const f = setRecovery(await fixture());
  const s = await f.client.snapshot(f.owner.publicKey);
  const plan = planAction(f.profile, s, action);
  assert.equal(plan.rentLamports, 0);
  assert.equal(plan.instructions.length, 1);
  const ix = plan.instructions[0];
  assert.deepEqual(
    ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    [
      [f.owner.publicKey.toBase58(), true, false],
      [f.market.toBase58(), false, true],
      [f.identity.address.toBase58(), false, true],
    ],
  );
  assert.equal(ix.data[0], 43);
  assert.equal(ix.data.readBigUInt64LE(1), s.portfolio.portfolioId);
  assert.equal(ix.data.readBigUInt64LE(9), s.portfolio.positionEpoch);
  assert.equal(ix.data.readBigUInt64LE(19), 1n);
  assert.equal(ix.data.length, 35);
  assert.match(plan.summary, /Forfeit unbooked gains/);
});

for (const [name, value] of [
  ["missing consent", { acceptForfeiture: undefined }],
  ["false consent", { acceptForfeiture: false }],
  ["string consent", { acceptForfeiture: "true" }],
  ["stale asset incarnation", { marketId: "2" }],
  ["missing asset incarnation", { marketId: undefined }],
  ["unknown asset", { assetIndex: 1 }],
  ["zero budget", { budget: "0" }],
  ["excess precision", { budget: "0.0000001" }],
  ["numeric budget", { budget: 1 }],
])
  test(`recovery review rejects ${name}`, async () => {
    const f = setRecovery(await fixture());
    await assert.rejects(
      f.client.prepare(f.owner.publicKey, { ...action, ...value }),
    );
    assert.equal(f.rpc.sent.length, 0);
  });

test("recovery encoder rejects zero budgets, invalid epochs and aliased accounts", () => {
  const args = {
    portfolioId: "1",
    positionEpoch: "0",
    assetIndex: 0,
    bDeltaBudget: "1",
  };
  for (const value of ["0", "-1", (1n << 128n).toString(), 1])
    assert.throws(() =>
      encodeInstruction(action.type, { ...args, bDeltaBudget: value }),
    );
  assert.throws(() =>
    encodeInstruction(action.type, {
      ...args,
      positionEpoch: (1n << 49n).toString(),
    }),
  );
  assert.throws(
    () =>
      buildInstruction(pub(9), action.type, args, {
        owner: pub(1),
        market: pub(1),
        portfolio: pub(2),
      }),
    /identities/,
  );
});

for (const target of ["market", "portfolio"])
  test(`full ${target} accounting changes during signing invalidate recovery review`, async () => {
    const f = setRecovery(await fixture());
    const prepared = await f.client.prepare(f.owner.publicKey, action);
    // These bytes are outside the projected UI reader. They still matter to SBF.
    const bytes = f.accounts.get(
      target === "market" ? f.market.toBase58() : f.identity.address.toBase58(),
    ).data;
    const before = Buffer.from(bytes);
    const offset =
      target === "market"
        ? bytes.length - 1
        : contract.constants.headerLength +
          contract.layouts.healthOffset +
          contract.layouts.health.certified_equity.offset;
    await assert.rejects(
      f.client.submit(prepared, async (wire) => {
        bytes[offset] ^= 1;
        return f.sign(wire);
      }),
      /Recovery accounting changed/,
    );
    assert.equal(f.rpc.sent.length, 0);
    assert.equal(await f.client.pending(f.owner.publicKey), null);
    before.copy(bytes);
  });

test("unchanged recovery review submits one signed transaction and reconciles normally", async () => {
  const f = setRecovery(await fixture());
  const prepared = await f.client.prepare(f.owner.publicKey, action);
  const record = await f.client.submit(prepared, f.sign);
  assert.equal(record.status, "submitted");
  assert.equal(f.rpc.sent.length, 1);
  await assert.rejects(
    f.client.submit(prepared, f.sign),
    /Review this action again/,
  );
  f.rpc.status = {
    slot: 123,
    confirmations: 1,
    err: null,
    confirmationStatus: "confirmed",
  };
  assert.equal(
    (await f.client.reconcile(f.owner.publicKey)).status,
    "confirmed",
  );
  assert.equal(await f.client.pending(f.owner.publicKey), null);
});

test("a failed recovery receipt cannot be replayed as a new attempt after reload", async () => {
  const f = setRecovery(await fixture());
  const prepared = await f.client.prepare(f.owner.publicKey, action);
  await f.client.submit(prepared, f.sign);
  f.rpc.status = {
    slot: 123,
    confirmations: 1,
    err: { InstructionError: [2, { Custom: 21 }] },
    confirmationStatus: "confirmed",
  };
  assert.equal((await f.client.reconcile(f.owner.publicKey)).status, "failed");
  const reloaded = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  await assert.rejects(
    reloaded.prepare(f.owner.publicKey, action),
    /new blockhash.*recovery/,
  );
  assert.equal(f.rpc.sent.length, 1);
  f.rpc.getLatestBlockhashAndContext = async () => ({
    context: { slot: 123 },
    value: { blockhash: pub(24).toBase58(), lastValidBlockHeight: 200 },
  });
  const next = await reloaded.prepare(f.owner.publicKey, action);
  await reloaded.submit(next, f.sign);
  assert.equal(f.rpc.sent.length, 2);
});
