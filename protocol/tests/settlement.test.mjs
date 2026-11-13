import test from "node:test";
import assert from "node:assert/strict";
import { OutrightClient, planAction } from "../src/client.mjs";
import { recordedSettlementPayout } from "../src/settlement.mjs";
import contract from "../upstream-contract.json" with { type: "json" };
import { fixture, pub } from "./support/client-fixture.mjs";
import { setSettlement } from "./support/settlement-fixture.mjs";

test("resolved reads keep face value, paid value and additional payout separate", async () => {
  const f = setSettlement(await fixture());
  const s = await f.client.snapshot(f.owner.publicKey);
  assert.equal(s.portfolio.resolvedPayout.terminal_positive_claim_face, 2000n);
  assert.equal(s.portfolio.resolvedPayout.paid_effective, 1250n);
  assert.equal(s.recordedSettlementPayout, 250n);
  assert.equal(s.market.resolved_slot, 123n);
  assert.equal(s.market.resolvedPayout.current_payout_rate_den, 4n);
});

test("payout floors exactly above Number precision and never exceeds recorded custody", async () => {
  const f = setSettlement(await fixture());
  const s = await f.client.snapshot(f.owner.publicKey);
  const face = (1n << 100n) + 7n;
  const p = {
    resolvedPayout: {
      ...s.portfolio.resolvedPayout,
      terminal_positive_claim_face: face,
      paid_effective: 1n,
    },
  };
  const m = { ...s.market, vault: face };
  assert.equal(recordedSettlementPayout(m, p), (face * 3n) / 4n - 1n);
  assert.equal(recordedSettlementPayout({ ...m, vault: 5n }, p), 5n);
});

for (const [name, mutation, pattern] of [
  ["hidden receipt", { receipt: { present: false } }, /Hidden/],
  ["invalid receipt flag", { receipt: { present: 2 } }, /Invalid present/],
  [
    "payment above face",
    { receipt: { paid_effective: 2001n } },
    /Invalid resolved payout receipt/,
  ],
  [
    "premature finalization",
    { receipt: { finalized: true } },
    /Invalid resolved payout receipt/,
  ],
  [
    "insufficient bound",
    { receipt: { prior_bound_contribution_num: 1n } },
    /Invalid resolved payout receipt/,
  ],
  [
    "overflowing face bound",
    { receipt: { terminal_positive_claim_face: (1n << 128n) - 1n } },
    /Invalid resolved payout receipt/,
  ],
  [
    "zero denominator",
    { ledger: { current_payout_rate_den: 0n } },
    /Invalid resolved payout rate/,
  ],
  [
    "rate above one",
    { ledger: { current_payout_rate_num: 5n } },
    /Invalid resolved payout rate/,
  ],
  [
    "rate below prior payment",
    { ledger: { current_payout_rate_num: 1n } },
    /below the recorded payment/,
  ],
])
  test(`resolved snapshot rejects ${name}`, async () => {
    const f = setSettlement(await fixture(), mutation);
    await assert.rejects(f.client.snapshot(f.owner.publicKey), pattern);
  });

test("resolved planner creates a missing ATA and binds both payout instructions to wallet custody", async () => {
  const f = setSettlement(await fixture());
  f.accounts.delete(f.userToken.toBase58());
  const s = await f.client.snapshot(f.owner.publicKey);
  for (const type of ["closeResolved", "claimResolvedPayoutTopup"]) {
    const plan = planAction(f.profile, s, { type }, 2_039_280);
    assert.equal(plan.rentLamports, 2_039_280);
    assert.equal(plan.instructions.length, 2);
    const ix = plan.instructions[1];
    assert.equal(ix.keys.length, 7);
    assert.equal(ix.keys[0].pubkey.toBase58(), f.owner.publicKey.toBase58());
    assert.equal(ix.keys[0].isSigner, true);
    assert.equal(ix.keys[3].pubkey.toBase58(), f.userToken.toBase58());
    assert.equal(ix.keys[4].pubkey.toBase58(), f.vault.toBase58());
  }
});

test("settlement and ordinary custody actions are restricted to their market modes", async () => {
  const f = await fixture();
  for (const mode of [0, 1, 2]) {
    setSettlement(f, { market: { mode } });
    const s = await f.client.snapshot(f.owner.publicKey);
    for (const type of ["closeResolved", "claimResolvedPayoutTopup"])
      if (mode !== 1)
        assert.throws(
          () => planAction(f.profile, s, { type }),
          /resolved market/,
        );
    for (const type of ["deposit", "withdraw"])
      if (mode !== 0)
        assert.throws(
          () => planAction(f.profile, s, { type, amount: "1" }),
          /live market/,
        );
  }
});

for (const [name, mutation] of [
  ["fully paid", { receipt: { paid_effective: 2000n, finalized: true } }],
  ["no amount due", { receipt: { paid_effective: 1500n } }],
  ["halted payout", { ledger: { payout_halted: true } }],
  ["empty vault", { market: { vault: 0n } }],
])
  test(`claim review refuses ${name}`, async () => {
    const f = setSettlement(await fixture(), mutation);
    await assert.rejects(
      f.client.prepare(f.owner.publicKey, { type: "claimResolvedPayoutTopup" }),
      /No additional/,
    );
    assert.equal(f.rpc.sent.length, 0);
  });

for (const [name, mutation] of [
  ["receipt payment", { receipt: { paid_effective: 1251n } }],
  ["payout rate", { ledger: { current_payout_rate_num: 4n } }],
  ["recorded custody", { market: { vault: 300n } }],
  ["resolved slot", { market: { resolved_slot: 124n } }],
  ["maintenance fee", { wrapper: { maintenance_fee_per_slot: 1n } }],
])
  test(`a ${name} change while signing requires a new review`, async () => {
    const f = setSettlement(await fixture());
    const review = await f.client.prepare(f.owner.publicKey, {
      type: "closeResolved",
    });
    await assert.rejects(
      f.client.submit(review, async (bytes) => {
        setSettlement(f, mutation);
        return f.sign(bytes);
      }),
      /Settlement state changed/,
    );
    assert.equal(f.rpc.sent.length, 0);
    assert.equal(await f.client.pending(f.owner.publicKey), null);
  });

test("confirmed settlement cannot reuse its blockhash after a client reload", async () => {
  const f = setSettlement(await fixture());
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "closeResolved",
  });
  await f.client.submit(review, f.sign);
  f.rpc.status = {
    slot: 123,
    confirmations: 1,
    err: null,
    confirmationStatus: "confirmed",
  };
  await f.client.reconcile(f.owner.publicKey);
  const client = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  for (const type of ["closeResolved", "claimResolvedPayoutTopup"])
    await assert.rejects(
      client.prepare(f.owner.publicKey, { type }),
      /new blockhash/,
    );
  f.rpc.getLatestBlockhashAndContext = async () => ({
    context: { slot: 123 },
    value: { blockhash: pub(24).toBase58(), lastValidBlockHeight: 201 },
  });
  const next = await client.prepare(f.owner.publicKey, {
    type: "closeResolved",
  });
  const receipt = await client.submit(next, f.sign);
  assert.notEqual(receipt.messageHash, review.messageHash);
  assert.equal(f.rpc.sent.length, 2);
});

test("a final receipt from another tab blocks a same-blockhash settlement review before signing", async () => {
  const f = setSettlement(await fixture());
  const review = await f.client.prepare(f.owner.publicKey, {
    type: "closeResolved",
  });
  const scope = f.client.scope(f.owner.publicKey);
  await f.journal.write(scope, {
    scope,
    status: "confirmed",
    blockhash: pub(23).toBase58(),
    minimumSlot: 123,
  });
  let prompted = false;
  await assert.rejects(
    f.client.submit(review, async (bytes) => {
      prompted = true;
      return f.sign(bytes);
    }),
    /new blockhash/,
  );
  assert.equal(prompted, false);
  assert.equal(f.rpc.sent.length, 0);
});
