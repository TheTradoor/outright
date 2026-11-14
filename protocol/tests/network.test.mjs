import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { validateProfile, OutrightClient } from "../src/client.mjs";
import { validateKeeperConfig } from "../src/keeper.mjs";
import {
  validateNetwork,
  walletChain,
  transactionExplorerUrl,
} from "../src/network.mjs";
import { fixture } from "./support/client-fixture.mjs";

const mainnet = {
  cluster: "mainnet-beta",
  rpcUrl: "https://rpc.example.invalid/?api-key=fixture-only",
  genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};
const devnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

test("mainnet profile preserves exact deployment identity and custody pins", async () => {
  const f = await fixture();
  const profile = validateProfile({ ...f.profile, ...mainnet });
  assert.equal(profile.genesisHash, mainnet.genesisHash);
  assert.deepEqual(profile.program, f.profile.program);
  assert.deepEqual(profile.collateral, f.profile.collateral);
  assert.equal(profile.vault, f.profile.vault);
  for (const mutation of [
    { engineCommit: "0".repeat(40) },
    { wrapperCommit: "0".repeat(40) },
    { program: { ...profile.program, sha256: "" } },
    { vault: profile.market },
  ])
    assert.throws(() => validateProfile({ ...profile, ...mutation }));
});

test("mainnet rejects wrong, shortened and substituted genesis identities", () => {
  for (const genesisHash of [
    devnetGenesis,
    mainnet.genesisHash.slice(0, 32),
    "1".repeat(32),
    null,
  ])
    assert.throws(
      () => validateNetwork({ ...mainnet, genesisHash }),
      /genesis/,
    );
  assert.throws(
    () => validateNetwork({ ...mainnet, cluster: "devnet" }),
    /genesis/,
  );
});

test("mainnet RPC requires HTTPS and forbids URL credentials", () => {
  for (const rpcUrl of [
    "http://rpc.example.invalid",
    "http://127.0.0.1:8899",
    "https://user:password@rpc.example.invalid",
  ])
    assert.throws(() => validateNetwork({ ...mainnet, rpcUrl }), /HTTPS/);
});

test("a loopback proxy cannot relabel a known public network as localnet", () => {
  for (const genesisHash of [
    mainnet.genesisHash,
    devnetGenesis,
    "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  ])
    assert.throws(
      () =>
        validateNetwork({
          cluster: "localnet",
          rpcUrl: "http://127.0.0.1:8899",
          genesisHash,
        }),
      /public-network genesis/,
    );
});

test("wallet chain mapping fails closed for unsupported cluster names", () => {
  assert.equal(walletChain("mainnet-beta"), "solana:mainnet");
  assert.equal(walletChain("devnet"), "solana:devnet");
  assert.equal(walletChain("localnet"), null);
  for (const cluster of [
    "mainnet",
    "testnet",
    "__proto__",
    "constructor",
    undefined,
  ])
    assert.throws(() => walletChain(cluster), /supports/);
});

test("mainnet explorer links do not disclose the configured RPC or query credentials", () => {
  assert.equal(
    transactionExplorerUrl(mainnet, "signature"),
    "https://explorer.solana.com/tx/signature",
  );
  const devnet = new URL(
    transactionExplorerUrl({ ...mainnet, cluster: "devnet" }, "signature"),
  );
  assert.equal(devnet.search, "?cluster=devnet");
  const localnet = new URL(
    transactionExplorerUrl(
      { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899/" },
      "signature",
    ),
  );
  assert.equal(localnet.searchParams.get("cluster"), "custom");
  assert.equal(
    localnet.searchParams.get("customUrl"),
    "http://127.0.0.1:8899/",
  );
});

test("wrong-network RPC is rejected before mainnet balances or preparation", async () => {
  const f = await fixture();
  const client = new OutrightClient(
    { ...f.profile, ...mainnet },
    { connection: f.rpc, journal: f.journal },
  );
  let accountReads = 0;
  f.rpc.getMultipleAccountsInfoAndContext = async () => {
    accountReads++;
    throw new Error("unexpected account read");
  };
  await assert.rejects(() => client.snapshot(f.owner.publicKey), /network/);
  await assert.rejects(
    () => client.prepare(f.owner.publicKey, { type: "deposit", amount: "1" }),
    /network/,
  );
  assert.equal(accountReads, 0);
  assert.equal(f.rpc.sent.length, 0);
});

test("network change after mainnet review cannot reach the signer", async () => {
  const f = await fixture();
  const client = new OutrightClient(
    { ...f.profile, ...mainnet },
    { connection: f.rpc, journal: f.journal },
  );
  f.rpc.getGenesisHash = async () => mainnet.genesisHash;
  const review = await client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  f.rpc.getGenesisHash = async () => devnetGenesis;
  let signed = false;
  await assert.rejects(
    () =>
      client.submit(review, async () => {
        signed = true;
        throw new Error("unexpected signing");
      }),
    /network/,
  );
  assert.equal(signed, false);
  assert.equal(f.rpc.sent.length, 0);
});

test("profile enrollment rejects unsupported networks before RPC use", () => {
  const result = spawnSync(
    process.execPath,
    [
      "protocol/profile.mjs",
      "--rpc",
      "http://127.0.0.1:1",
      "--cluster",
      "testnet",
      "--program",
      "placeholder",
      "--program-binary",
      "missing",
      "--market",
      "placeholder",
      "--wallet",
      "placeholder",
      "--symbol",
      "TEST",
      "--max-oracle-age-slots",
      "20",
    ],
    { cwd: new URL("../..", import.meta.url), encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /This release supports/);
  assert.doesNotMatch(result.stderr, /fetch failed|ECONNREFUSED|ENOENT/);
});

test("a slow pre-sign network response cannot reopen an expired mainnet review", async () => {
  const f = await fixture();
  const client = new OutrightClient(
    { ...f.profile, ...mainnet },
    { connection: f.rpc, journal: f.journal },
  );
  f.rpc.getGenesisHash = async () => mainnet.genesisHash;
  const review = await client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  const now = Date.now;
  let signed = false;
  f.rpc.getGenesisHash = async () => {
    Date.now = () => review.expiresAt + 1;
    return mainnet.genesisHash;
  };
  try {
    await assert.rejects(
      () =>
        client.submit(review, async () => {
          signed = true;
          throw new Error("unexpected signing");
        }),
      /expired/,
    );
    assert.equal(signed, false);
    assert.equal(f.rpc.sent.length, 0);
  } finally {
    Date.now = now;
  }
});

test("network change inside the mainnet wallet prompt still prevents broadcast", async () => {
  const f = await fixture();
  const client = new OutrightClient(
    { ...f.profile, ...mainnet },
    { connection: f.rpc, journal: f.journal },
  );
  f.rpc.getGenesisHash = async () => mainnet.genesisHash;
  const review = await client.prepare(f.owner.publicKey, {
    type: "deposit",
    amount: "1",
  });
  let signed = false;
  await assert.rejects(
    () =>
      client.submit(review, async (bytes) => {
        signed = true;
        f.rpc.getGenesisHash = async () => devnetGenesis;
        return f.sign(bytes);
      }),
    /network/,
  );
  assert.equal(signed, true);
  assert.equal(f.rpc.sent.length, 0);
});

test("mainnet support does not install a hosted deployment profile", async () => {
  assert.equal(
    JSON.parse(
      await readFile(
        new URL("../terminal/deployment.json", import.meta.url),
        "utf8",
      ),
    ),
    null,
  );
});

test("mainnet keeper cannot use the local fixed-price oracle mode", async () => {
  const f = await fixture();
  assert.throws(
    () =>
      validateKeeperConfig({
        version: 1,
        deployment: { ...f.profile, ...mainnet },
        targets: [
          {
            address: f.identity.address,
            owner: f.owner.publicKey,
            portfolioId: "17",
          },
        ],
        assets: [{ index: 0, marketId: "1", oracleMode: 0, feeds: [] }],
      }),
    /manual prices are localnet-only/,
  );
});
