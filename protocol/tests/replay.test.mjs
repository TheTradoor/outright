import test from "node:test";
import assert from "node:assert/strict";
import contract from "../upstream-contract.json" with { type: "json" };
import { OutrightClient } from "../src/client.mjs";
import { fixture, pub, withMaker } from "./support/client-fixture.mjs";

const actions = [
  { type: "initialize" },
  { type: "deposit", amount: "1" },
  { type: "withdraw", amount: "1" },
  { type: "trade", side: "buy", size: "0.1", limitPrice: "150", assetIndex: 0 },
];
async function setup(action) {
  const f =
    action.type === "trade"
      ? await withMaker(await fixture())
      : await fixture();
  if (action.type === "initialize")
    f.accounts.delete(f.identity.address.toBase58());
  if (action.type === "withdraw")
    f.accounts
      .get(f.identity.address.toBase58())
      .data.writeBigUInt64LE(
        2_000_000n,
        contract.constants.portfolioCapitalOffset,
      );
  return f;
}
async function failOnChain(f, action) {
  const review = await f.client.prepare(f.owner.publicKey, action);
  const record = await f.client.submit(review, f.sign);
  f.rpc.status = {
    slot: 123,
    confirmationStatus: "confirmed",
    confirmations: 1,
    err: { InstructionError: [2, "InvalidArgument"] },
  };
  const failed = await f.client.reconcile(f.owner.publicKey);
  assert.equal(failed.status, "failed");
  return { record, failed };
}

for (const action of actions)
  for (const lostResponse of [false, true])
    test(`${action.type} requires a fresh blockhash after a confirmed failure${lostResponse ? " and lost send response" : ""}`, async () => {
      const f = await setup(action);
      const send = f.rpc.sendRawTransaction;
      if (lostResponse)
        f.rpc.sendRawTransaction = async (bytes) => {
          await send(bytes);
          throw new Error("response lost");
        };
      const { record, failed } = await failOnChain(f, action);
      assert.equal(record.status, lostResponse ? "unknown" : "submitted");
      f.rpc.sendRawTransaction = send;
      const client = new OutrightClient(f.profile, {
        connection: f.rpc,
        journal: f.journal,
      });
      let simulations = 0;
      const simulate = f.rpc.simulateTransaction;
      f.rpc.simulateTransaction = async (...args) => {
        simulations++;
        return simulate(...args);
      };
      await assert.rejects(
        client.prepare(f.owner.publicKey, action),
        /new blockhash/,
      );
      assert.equal(simulations, 0);
      assert.equal(f.rpc.sent.length, 1);
      assert.deepEqual(
        await f.journal.read(client.scope(f.owner.publicKey)),
        failed,
      );
      f.rpc.getLatestBlockhashAndContext = async () => ({
        context: { slot: 123 },
        value: { blockhash: pub(24).toBase58(), lastValidBlockHeight: 201 },
      });
      const next = await client.prepare(f.owner.publicKey, action);
      const sent = await client.submit(next, f.sign);
      assert.equal(simulations, 1);
      assert.notEqual(sent.signature, record.signature);
      assert.notEqual(sent.messageHash, record.messageHash);
      assert.equal(f.rpc.sent.length, 2);
    });

for (const action of actions)
  test(`${action.type} rejects an old review after another tab records a final failure`, async () => {
    const f = await setup(action);
    const second = new OutrightClient(f.profile, {
      connection: f.rpc,
      journal: f.journal,
    });
    const review = await second.prepare(f.owner.publicKey, action);
    const { failed } = await failOnChain(f, action);
    let prompts = 0;
    await assert.rejects(
      second.submit(review, async (bytes) => {
        prompts++;
        return f.sign(bytes);
      }),
      /new blockhash/,
    );
    assert.equal(prompts, 0);
    assert.equal(f.rpc.sent.length, 1);
    assert.deepEqual(
      await f.journal.read(second.scope(f.owner.publicKey)),
      failed,
    );
  });

for (const status of ["confirmed", "finalized"])
  test(`a ${status} action also requires a fresh blockhash for a different request`, async () => {
    const f = await fixture();
    const review = await f.client.prepare(f.owner.publicKey, actions[1]);
    await f.client.submit(review, f.sign);
    f.rpc.status = { slot: 123, confirmationStatus: status, err: null };
    await f.client.reconcile(f.owner.publicKey);
    await assert.rejects(
      f.client.prepare(f.owner.publicKey, { type: "deposit", amount: "2" }),
      /new blockhash/,
    );
    assert.equal(f.rpc.sent.length, 1);
  });

test("a wallet rejection before receipt persistence does not consume the blockhash", async () => {
  const f = await fixture();
  const review = await f.client.prepare(f.owner.publicKey, actions[1]);
  await assert.rejects(
    f.client.submit(review, async () => {
      throw new Error("User declined");
    }),
    /User declined/,
  );
  assert.equal(f.records.size, 0);
  const next = await f.client.prepare(f.owner.publicKey, actions[1]);
  assert.equal(next.messageHash, review.messageHash);
  assert.equal((await f.client.submit(next, f.sign)).status, "submitted");
  assert.equal(f.rpc.sent.length, 1);
});
