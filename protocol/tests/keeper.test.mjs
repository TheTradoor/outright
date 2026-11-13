import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import contract from "../upstream-contract.json" with { type: "json" };
import { sha256 } from "../src/client.mjs";
import { vaultAuthority, buildInstruction } from "../src/instructions.mjs";
import {
  OutrightKeeper,
  validateKeeperConfig,
  readKeeperSnapshot,
  planCrank,
} from "../src/keeper.mjs";
import { openKeeperJournal } from "../operator/journal.mjs";

const pub = (n) => new PublicKey(Buffer.alloc(32, n));
const info = (owner, data, executable = false) => ({
  owner,
  data,
  executable,
  lamports: 1_000_000_000,
});
async function fixture() {
  const signer = Keypair.fromSeed(Buffer.alloc(32, 21)),
    program = pub(9),
    programData = pub(8),
    market = pub(1),
    portfolio = pub(2);
  const code = Buffer.from("keeper RPC fixture, SBF tested separately"),
    programBytes = Buffer.alloc(36),
    dataBytes = Buffer.alloc(45 + code.length);
  programBytes.writeUInt32LE(2);
  programData.toBuffer().copy(programBytes, 4);
  dataBytes.writeUInt32LE(3);
  code.copy(dataBytes, 45);
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const accounts = new Map([
    [program.toBase58(), info(loader, programBytes, true)],
    [programData.toBase58(), info(loader, dataBytes)],
    [
      market.toBase58(),
      info(program, Buffer.from(contract.marketFixtureHex, "hex")),
    ],
    [
      portfolio.toBase58(),
      info(program, Buffer.from(contract.portfolioFixtureHex, "hex")),
    ],
    [
      signer.publicKey.toBase58(),
      info(SystemProgram.programId, Buffer.alloc(0)),
    ],
  ]);
  const raw = {
    version: 1,
    deployment: {
      version: 1,
      cluster: "localnet",
      rpcUrl: "http://127.0.0.1:8899",
      genesisHash: pub(31).toBase58(),
      engineCommit: contract.engineCommit,
      wrapperCommit: contract.wrapperCommit,
      program: {
        address: program.toBase58(),
        programData: programData.toBase58(),
        sha256: await sha256(code),
        upgradeAuthority: null,
      },
      market: market.toBase58(),
      collateral: {
        mint: pub(5).toBase58(),
        decimals: 6,
        symbol: "TEST",
        mintAuthority: null,
        freezeAuthority: null,
      },
      vault: getAssociatedTokenAddressSync(
        pub(5),
        vaultAuthority(program, market),
        true,
      ).toBase58(),
      maxOracleAgeSlots: 20,
    },
    feePayer: signer.publicKey.toBase58(),
    targets: [
      {
        address: portfolio.toBase58(),
        owner: pub(3).toBase58(),
        portfolioId: "17",
      },
    ],
    assets: [{ index: 0, marketId: "1", oracleMode: 0, feeds: [] }],
    intervalMs: 2000,
    maxFeeLamports: "5000",
    feeBudgetLamports: "10000",
    reserveLamports: "1000000",
  };
  let state = null,
    locked = false;
  const journal = {
    read: async () => structuredClone(state),
    write: async (s) => {
      state = structuredClone(s);
    },
    exclusive: async (work) => {
      if (locked) throw new Error("cycle locked");
      locked = true;
      try {
        return await work();
      } finally {
        locked = false;
      }
    },
  };
  const rpc = {
    sent: [],
    slot: 124,
    height: 10,
    status: null,
    getGenesisHash: async () => raw.deployment.genesisHash,
    getMultipleAccountsInfoAndContext: async (keys) => ({
      context: { slot: rpc.slot },
      value: keys.map((k) => accounts.get(k.toBase58()) ?? null),
    }),
    getLatestBlockhashAndContext: async () => ({
      context: { slot: rpc.slot },
      value: { blockhash: pub(23).toBase58(), lastValidBlockHeight: 100 },
    }),
    simulateTransaction: async () => ({
      context: { slot: rpc.slot },
      value: { err: null, unitsConsumed: 100000 },
    }),
    getFeeForMessage: async () => ({
      context: { slot: rpc.slot },
      value: 5000,
    }),
    getBlockHeight: async () => rpc.height,
    getSignatureStatuses: async () => ({
      context: { slot: rpc.slot },
      value: [rpc.status],
    }),
    sendRawTransaction: async (bytes) => {
      assert(state.pending, "receipt must be durable before send");
      const tx = VersionedTransaction.deserialize(bytes);
      assert.equal(state.pending.signature, bs58.encode(tx.signatures[0]));
      rpc.sent.push(bytes);
      return state.pending.signature;
    },
  };
  const keeper = new OutrightKeeper(raw, { connection: rpc, journal, signer });
  return {
    raw,
    keeper,
    journal,
    rpc,
    accounts,
    signer,
    portfolio,
    programData,
    state: () => structuredClone(state),
  };
}

test("keeper simulates without a signer and sends only with an explicit flag", async () => {
  const f = await fixture();
  f.keeper.signer = null;
  assert.equal((await f.keeper.tick()).status, "simulated");
  assert.equal(f.rpc.sent.length, 0);
  assert.equal(f.state().reservedFees, "0");
  await assert.rejects(f.keeper.tick({ send: true }), /requires.*signer/);
});
test("keeper persists before send and reconciles before another signature", async () => {
  const f = await fixture();
  assert.equal((await f.keeper.tick({ send: true })).status, "submitted");
  assert.equal((await f.keeper.tick({ send: true })).status, "pending");
  assert.equal(f.rpc.sent.length, 1);
  f.rpc.status = { confirmationStatus: "confirmed", err: null, slot: 125 };
  assert.equal((await f.keeper.tick({ send: true })).status, "confirmed");
  assert.equal(f.state().minimumSlot, 125);
  assert.equal(f.state().pending, null);
});
test("lost send response and expired unknown receipt remain blocking after restart", async () => {
  const f = await fixture();
  f.rpc.sendRawTransaction = async () => {
    throw new Error("transport lost after broadcast");
  };
  const first = await f.keeper.tick({ send: true });
  assert.equal(first.status, "unknown");
  f.rpc.height = 101;
  const restarted = new OutrightKeeper(f.raw, {
    connection: f.rpc,
    journal: f.journal,
    signer: f.signer,
  });
  assert.equal(
    (await restarted.tick({ send: true })).status,
    "expiredUnresolved",
  );
  assert.equal(f.state().pending.signature, first.signature);
  assert.equal(f.state().attempts, 1);
});
test("confirmed failure consumes reserved fee budget but releases the pending receipt", async () => {
  const f = await fixture();
  await f.keeper.tick({ send: true });
  f.rpc.status = {
    confirmationStatus: "finalized",
    err: { InstructionError: [2, { Custom: 27 }] },
    slot: 124,
  };
  assert.equal((await f.keeper.tick({ send: true })).status, "failed");
  assert.equal(f.state().reservedFees, "5000");
  assert.equal(f.state().pending, null);
});
test("a journal write failure prevents any broadcast", async () => {
  const f = await fixture();
  f.journal.write = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(f.keeper.tick({ send: true }), /disk full/);
  assert.equal(f.rpc.sent.length, 0);
});
for (const mutation of [
  "code",
  "network",
  "portfolio",
  "asset",
  "reserve",
  "fee",
  "old bank",
  "resolved",
]) {
  test(`keeper refuses ${mutation} changes before signing`, async () => {
    const f = await fixture();
    if (mutation === "code")
      f.accounts.get(f.programData.toBase58()).data[45] ^= 1;
    if (mutation === "network")
      f.rpc.getGenesisHash = async () => pub(32).toBase58();
    if (mutation === "portfolio")
      f.accounts
        .get(f.portfolio.toBase58())
        .data.writeBigUInt64LE(18n, contract.constants.portfolioIdOffset);
    if (mutation === "asset") f.raw.assets[0].marketId = "2";
    if (mutation === "reserve") f.accounts.get(f.raw.feePayer).lamports = 1000;
    if (mutation === "fee")
      f.rpc.getFeeForMessage = async () => ({
        context: { slot: 124 },
        value: 5001,
      });
    if (mutation === "old bank")
      f.rpc.simulateTransaction = async () => ({
        context: { slot: 123 },
        value: { err: null },
      });
    if (mutation === "resolved")
      f.accounts.get(f.raw.deployment.market).data[
        contract.constants.marketModeOffset
      ] = 1;
    const keeper = new OutrightKeeper(f.raw, {
      connection: f.rpc,
      journal: f.journal,
      signer: f.signer,
    });
    await assert.rejects(keeper.tick({ send: true }));
    assert.equal(f.rpc.sent.length, 0);
  });
}
test("total fee budget persists across confirmed transactions", async () => {
  const f = await fixture();
  f.rpc.status = { confirmationStatus: "confirmed", err: null, slot: 124 };
  for (let i = 0; i < 2; i++) {
    await f.keeper.tick({ send: true });
    await f.keeper.tick({ send: true });
  }
  await assert.rejects(f.keeper.tick({ send: true }), /budget exceeded/);
  assert.equal(f.rpc.sent.length, 2);
});
test("engine non-progress skips a fee; unrelated custom errors are not mislabeled idle", async () => {
  const f = await fixture();
  const simulation = (error) => async () => ({
    context: { slot: 124 },
    value: { err: { InstructionError: [2, { Custom: error }] } },
  });
  f.rpc.simulateTransaction = simulation(contract.keeper.nonProgressError);
  assert.equal((await f.keeper.tick({ send: true })).status, "idle");
  f.rpc.simulateTransaction = simulation(27);
  assert.equal(
    (await f.keeper.tick({ send: true })).status,
    "simulationRejected",
  );
  assert.equal(f.rpc.sent.length, 0);
});
test("a second cycle cannot race signing or reconciliation", async () => {
  const f = await fixture();
  let release, reached;
  const entered = new Promise((r) => {
    reached = r;
  });
  f.rpc.simulateTransaction = async () => {
    reached();
    await new Promise((r) => {
      release = r;
    });
    return { context: { slot: 124 }, value: { err: null } };
  };
  const first = f.keeper.tick({ send: true });
  await entered;
  await assert.rejects(f.keeper.tick({ send: true }), /cycle locked/);
  release();
  await first;
  assert.equal(f.rpc.sent.length, 1);
});
test("pending receipt cannot be reused with another keeper configuration", async () => {
  const f = await fixture();
  await f.keeper.tick({ send: true });
  f.raw.feeBudgetLamports = "20000";
  const other = new OutrightKeeper(f.raw, {
    connection: f.rpc,
    journal: f.journal,
    signer: f.signer,
  });
  await assert.rejects(other.tick({ send: true }), /journal does not match/);
});
test("crank account plan uses read-only oracle accounts and never signs for the target owner", async () => {
  const f = await fixture(),
    config = validateKeeperConfig(f.raw);
  const snapshot = await readKeeperSnapshot(f.rpc, config, config.targets[0]);
  const ix = planCrank(config, snapshot, 0);
  assert.deepEqual(
    ix.keys.map((k) => [k.isSigner, k.isWritable]),
    [
      [true, false],
      [false, true],
      [false, true],
    ],
  );
  assert(!ix.keys.some((k) => k.pubkey.equals(pub(3))));
  const withOracle = buildInstruction(
    pub(9),
    "permissionlessCrank",
    { nowSlot: "1", observations: [{ assetIndex: 0, oracleAccounts: 1 }] },
    {
      owner: pub(4),
      market: pub(1),
      portfolio: pub(2),
      oracleAccounts: [pub(20)],
    },
  );
  assert.equal(withOracle.keys[3].isWritable, false);
  assert.equal(withOracle.keys[3].isSigner, false);
  assert.throws(
    () =>
      buildInstruction(
        pub(9),
        "permissionlessCrank",
        { nowSlot: "1", observations: [] },
        {
          owner: pub(4),
          market: pub(1),
          portfolio: pub(2),
          oracleAccounts: [pub(20)],
        },
      ),
    /count/,
  );
});
test("devnet rejects manual oracle profiles", async () => {
  const f = await fixture();
  f.raw.deployment.cluster = "devnet";
  f.raw.deployment.rpcUrl = "https://api.devnet.solana.com";
  f.raw.deployment.genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  assert.throws(() => validateKeeperConfig(f.raw), /external hybrid/);
});
for (const change of ["owner", "feed", "mode"]) {
  test(`keeper rejects a changed external oracle ${change}`, async () => {
    const f = await fixture(),
      oracle = pub(44),
      feed = pub(77),
      provider = new PublicKey(contract.keeper.oracleOwners[0]);
    f.raw.assets[0] = {
      index: 0,
      marketId: "1",
      oracleMode: 1,
      feeds: [
        {
          id: feed.toBase58(),
          account: oracle.toBase58(),
          owner: provider.toBase58(),
        },
      ],
    };
    const bytes = f.accounts.get(f.raw.deployment.market).data;
    const base =
      contract.constants.marketGroupOffset +
      contract.constants.marketHeaderLength;
    bytes[base + contract.layouts.oracle.oracle_mode.offset] = 1;
    bytes[base + contract.layouts.oracle.oracle_leg_count.offset] = 1;
    feed.toBuffer().copy(bytes, base + contract.layouts.oracleFeedsOffset);
    f.accounts.set(oracle.toBase58(), info(provider, Buffer.alloc(134)));
    if (change === "owner") f.accounts.get(oracle.toBase58()).owner = pub(45);
    if (change === "feed")
      pub(78)
        .toBuffer()
        .copy(bytes, base + contract.layouts.oracleFeedsOffset);
    if (change === "mode")
      bytes[base + contract.layouts.oracle.oracle_mode.offset] = 0;
    const keeper = new OutrightKeeper(f.raw, {
      connection: f.rpc,
      journal: f.journal,
      signer: f.signer,
    });
    await assert.rejects(keeper.tick({ send: true }), /[Oo]racle/);
    assert.equal(f.rpc.sent.length, 0);
  });
}
for (const change of ["code", "network", "expiry", "balance"]) {
  test(`keeper rechecks ${change} after simulation and before broadcast`, async () => {
    const f = await fixture();
    f.rpc.getFeeForMessage = async () => {
      if (change === "code")
        f.accounts.get(f.programData.toBase58()).data[45] ^= 1;
      if (change === "network")
        f.rpc.getGenesisHash = async () => pub(32).toBase58();
      if (change === "expiry") f.rpc.height = 101;
      if (change === "balance") f.accounts.get(f.raw.feePayer).lamports = 0;
      return { context: { slot: 124 }, value: 5000 };
    };
    await assert.rejects(f.keeper.tick({ send: true }));
    assert.equal(f.rpc.sent.length, 0);
    assert.equal(f.state(), null);
  });
}
test("disk journal survives reopen, locks other workers and rejects exposed permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outright-keeper-"));
  try {
    const journal = await openKeeperJournal(directory);
    await assert.rejects(openKeeperJournal(directory), /locked/);
    await journal.write({
      pending: { signature: "public receipt" },
      reservedFees: "5000",
    });
    await journal.close();
    const reopened = await openKeeperJournal(directory);
    assert.equal((await reopened.read()).reservedFees, "5000");
    assert.equal(
      JSON.parse(await readFile(join(directory, "state.json"), "utf8")).pending
        .signature,
      "public receipt",
    );
    await reopened.close();
    await chmod(directory, 0o755);
    await assert.rejects(openKeeperJournal(directory), /private/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI signs through JSON-RPC and a restarted process reconciles the saved receipt", async () => {
  const f = await fixture(),
    directory = await mkdtemp(join(tmpdir(), "outright-keeper-cli-"));
  const stateDir = join(directory, "state");
  let sends = 0,
    observedSignature;
  const server = createServer(async (request, response) => {
    try {
      let text = "";
      for await (const chunk of request) text += chunk;
      const { id, method, params } = JSON.parse(text);
      let result;
      switch (method) {
        case "getGenesisHash":
          result = f.raw.deployment.genesisHash;
          break;
        case "getMultipleAccounts":
          assert.equal(params[1].commitment, "confirmed");
          result = {
            context: { slot: 124 },
            value: params[0].map((a) => {
              const info = f.accounts.get(a);
              return info
                ? {
                    ...info,
                    owner: info.owner.toBase58(),
                    data: [info.data.toString("base64"), "base64"],
                    rentEpoch: 0,
                  }
                : null;
            }),
          };
          break;
        case "getLatestBlockhash":
          result = {
            context: { slot: 124 },
            value: { blockhash: pub(23).toBase58(), lastValidBlockHeight: 100 },
          };
          break;
        case "getBlockHeight":
          result = 10;
          break;
        case "simulateTransaction":
          assert.equal(params[1].sigVerify, false);
          assert.equal(params[1].replaceRecentBlockhash, false);
          result = {
            context: { slot: 124 },
            value: { err: null, logs: [], unitsConsumed: 100000 },
          };
          break;
        case "getFeeForMessage":
          result = { context: { slot: 124 }, value: 5000 };
          break;
        case "sendTransaction": {
          const tx = VersionedTransaction.deserialize(
            Buffer.from(params[0], "base64"),
          );
          const state = JSON.parse(
            await readFile(join(stateDir, "state.json"), "utf8"),
          );
          observedSignature = bs58.encode(tx.signatures[0]);
          assert.equal(state.pending.signature, observedSignature);
          assert.equal(state.pending.status, "signed");
          assert.equal(params[1].maxRetries, 0);
          sends++;
          result = observedSignature;
          break;
        }
        case "getSignatureStatuses":
          assert.equal(params[0][0], observedSignature);
          assert.equal(params[1].searchTransactionHistory, true);
          result = {
            context: { slot: 124 },
            value: [
              {
                slot: 124,
                confirmations: 1,
                confirmationStatus: "confirmed",
                err: null,
              },
            ],
          };
          break;
        default:
          throw new Error(`Unexpected RPC method ${method}`);
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (e) {
      response.statusCode = 500;
      response.end(e.message);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    f.raw.deployment.rpcUrl = `http://127.0.0.1:${server.address().port}`;
    const configPath = join(directory, "config.json"),
      keyPath = join(directory, "test.keypair.json");
    await writeFile(configPath, JSON.stringify(f.raw), { mode: 0o600 });
    await writeFile(keyPath, JSON.stringify([...f.signer.secretKey]), {
      mode: 0o600,
    });
    const args = [
      fileURLToPath(new URL("../operator/keeper.mjs", import.meta.url)),
      "--config",
      configPath,
      "--state-dir",
      stateDir,
      "--send",
      "--keypair",
      keyPath,
    ];
    const run = () =>
      promisify(execFile)(process.execPath, args, { timeout: 20000 });
    const first = await run();
    assert.equal(JSON.parse(first.stdout).status, "submitted");
    const second = await run();
    assert.equal(JSON.parse(second.stdout).status, "confirmed");
    assert.equal(sends, 1);
    const state = JSON.parse(
      await readFile(join(stateDir, "state.json"), "utf8"),
    );
    assert.equal(state.pending, null);
    assert.equal(state.reservedFees, "5000");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("crashed workers leave a lock and the last durable state for inspection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outright-keeper-crash-"));
  try {
    const script = `import { openKeeperJournal } from ${JSON.stringify(new URL("../operator/journal.mjs", import.meta.url).href)};
      const journal = await openKeeperJournal(process.argv[1]);
      await journal.write({ pending: { status: "signed", signature: "fixture" } });
      process.exit(0);`;
    await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script,
      directory,
    ]);
    await assert.rejects(openKeeperJournal(directory), /locked/);
    assert.equal(
      JSON.parse(await readFile(join(directory, "state.json"), "utf8")).pending
        .status,
      "signed",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
