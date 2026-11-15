import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKeeperJournal } from "../operator/journal.mjs";
import { stopKeeper } from "../operator/keeper.mjs";

test("a replacement worker cannot start before the old health writer finishes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "outright-shutdown-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = await openKeeperJournal(directory);
  await journal.write({ pending: { signature: "durable receipt" } });
  let entered, release, replacement;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const closing = stopKeeper(journal, {
    async stop(failed) {
      assert.equal(failed, false);
      entered();
      await gate;
      await writeFile(join(directory, "health.json"), JSON.stringify({ phase: "stopped" }), { mode: 0o600 });
    },
  });
  try {
    await writing;
    await assert.rejects(async () => {
      replacement = await openKeeperJournal(directory);
    }, /locked/);
  } finally {
    release();
    await closing;
    if (replacement) await replacement.close();
  }
  replacement = await openKeeperJournal(directory);
  try {
    assert.equal((await replacement.read()).pending.signature, "durable receipt");
    assert.equal(JSON.parse(await readFile(join(directory, "health.json"), "utf8")).phase, "stopped");
    await writeFile(join(directory, "health.json"), JSON.stringify({ phase: "running" }), { mode: 0o600 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(JSON.parse(await readFile(join(directory, "health.json"), "utf8")).phase, "running");
  } finally {
    await replacement.close();
  }
});

test("a health write failure still closes the journal without losing its receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "outright-shutdown-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = await openKeeperJournal(directory);
  await journal.write({ pending: { signature: "durable receipt" } });
  await assert.rejects(stopKeeper(journal, {
    async stop(failed) {
      assert.equal(failed, true);
      throw new Error("Health storage failed");
    },
  }, true), /Health storage failed/);
  const replacement = await openKeeperJournal(directory);
  try { assert.equal((await replacement.read()).pending.signature, "durable receipt"); }
  finally { await replacement.close(); }
});

test("shutdown retains a poisoned journal lock for receipt recovery", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "outright-shutdown-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = await openKeeperJournal(directory);
  await mkdir(join(directory, "state.json"));
  await assert.rejects(journal.write({ pending: { signature: "receipt" } }));
  let stopped = false;
  await stopKeeper(journal, { async stop(failed) { stopped = failed; } }, true);
  assert.equal(stopped, true);
  await assert.rejects(openKeeperJournal(directory), /locked/);
});
