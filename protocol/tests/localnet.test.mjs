import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  mkdtemp,
  rm,
  chmod,
  symlink,
  stat,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localRpcUrl,
  privateDirectory,
  saveJson,
  loadJson,
  confirm,
  reconcileSetup,
  programPin,
} from "../localnet/runtime.mjs";
import contract from "../upstream-contract.json" with { type: "json" };
import {
  initializeMarket,
  initializeMint,
  mintTokens,
  markInstruction,
  matcherConsent,
  initializeMatcher,
  finalizeProgram,
} from "../localnet/instructions.mjs";
const pub = (n) => new PublicKey(Buffer.alloc(32, n));

test("local program pins accept the official loader and enforce code and authority", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "outright-localnet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binaryPath = join(root, "program.so"),
    binary = Buffer.from("local program pin fixture");
  await writeFile(binaryPath, binary);
  const loader = new PublicKey(contract.localnet.programLoader);
  const program = { owner: loader, executable: true, data: Buffer.alloc(36) };
  program.data.writeUInt32LE(2);
  pub(8).toBuffer().copy(program.data, 4);
  const data = {
    owner: loader,
    executable: false,
    data: Buffer.alloc(45 + binary.length),
  };
  data.data.writeUInt32LE(3);
  binary.copy(data.data, 45);
  const rpc = {
    getAccountInfo: async (address) =>
      address.equals(pub(9)) ? program : data,
  };
  const immutable = await programPin(rpc, pub(9).toBase58(), binaryPath);
  assert.equal(immutable.upgradeAuthority, null);
  assert.equal(immutable.programData, pub(8).toBase58());
  data.data[12] = 1;
  pub(3).toBuffer().copy(data.data, 13);
  await assert.rejects(
    programPin(rpc, pub(9).toBase58(), binaryPath),
    /authority/,
  );
  const initial = await programPin(rpc, pub(9).toBase58(), binaryPath, [
    pub(3).toBase58(),
  ]);
  assert.equal(initial.upgradeAuthority, pub(3).toBase58());
  data.data[45] ^= 1;
  await assert.rejects(
    programPin(rpc, pub(9).toBase58(), binaryPath, [pub(3).toBase58()]),
    /differs/,
  );
  const ix = finalizeProgram(pub(8), pub(3));
  assert(ix.programId.equals(loader));
  assert.equal(ix.data.toString("hex"), contract.localnet.finalizeProgramHex);
  assert.deepEqual(
    ix.keys.map((k) => [k.isSigner, k.isWritable]),
    [
      [false, true],
      [true, false],
    ],
  );
});

test("local validator mint initialization and checked issuance match SPL Rust", () => {
  assert.equal(
    initializeMint(pub(5), pub(3)).data.toString("hex"),
    contract.localnet.initializeMintHex,
  );
  assert.equal(
    mintTokens(pub(5), pub(6), pub(3), 1_000_000_000n).data.toString("hex"),
    contract.localnet.mintTokensHex,
  );
  assert.throws(() => mintTokens(pub(5), pub(6), pub(3), -1n), /bounded/);
  assert.throws(() => mintTokens(pub(5), pub(6), pub(3), 1n << 64n), /bounded/);
});
test("local authority price updates match the pinned Rust encoder", () => {
  const asset = {
    market_id: 1n,
    control: { oracle_observation: 1n, authority_epoch: 3n },
  };
  assert.equal(
    markInstruction(pub(9), pub(3), pub(1), asset, 123, true).data.toString(
      "hex",
    ),
    contract.localnet.configureMarkHex,
  );
  asset.control.oracle_observation = 2n;
  assert.equal(
    markInstruction(pub(9), pub(3), pub(1), asset, 124).data.toString("hex"),
    contract.localnet.pushMarkHex,
  );
});
test("local maker consent matches the pinned Rust encoder and does not sign for a trader", () => {
  const state = { portfolioId: 17n, expectedSequence: 2n, positionEpoch: 3n };
  const ix = matcherConsent(
    pub(9),
    pub(8),
    pub(7),
    pub(3),
    pub(1),
    pub(2),
    state,
    2n,
    100000,
  );
  assert.equal(ix.data.toString("hex"), contract.localnet.matcherConsentHex);
  assert.deepEqual(
    ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()),
    [pub(3).toBase58()],
  );
  const init = initializeMatcher(
    pub(9),
    pub(8),
    pub(7),
    pub(3),
    pub(1),
    pub(2),
  );
  assert(init.keys[1].pubkey.equals(ix.keys[5].pubkey));
});
test("local market allocation uses the Rust-exported one-asset layout", () => {
  assert.equal(
    contract.localnet.marketAccountLength,
    contract.constants.marketGroupOffset +
      contract.constants.marketHeaderLength +
      contract.constants.marketAssetSlotLength,
  );
  assert.equal(initializeMarket(pub(9), pub(3), pub(1), pub(5)).keys.length, 3);
});

test("local bootstrap rejects public endpoints, credentials and URL suffixes", () => {
  assert.equal(localRpcUrl("http://127.0.0.1:8899"), "http://127.0.0.1:8899/");
  for (const url of [
    "https://api.devnet.solana.com",
    "http://example.com:8899",
    "http://localhost:8899",
    "http://127.0.0.1:8899/path",
    "http://127.0.0.1:8899/?key=x",
    "http://name:secret@127.0.0.1:8899",
    "http://127.0.0.1:8899/#a",
    "https://127.0.0.1:8899",
  ])
    assert.throws(() => localRpcUrl(url), /Local validator/);
});

test("local state writes are private and exclusive receipts cannot be replaced", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "outright-localnet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await privateDirectory(root);
  const path = join(root, "receipt.json");
  await saveJson(path, { status: "signed" }, { exclusive: true });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(
    saveJson(path, { status: "replacement" }, { exclusive: true }),
    { code: "EEXIST" },
  );
  assert.deepEqual(await loadJson(path), { status: "signed" });
  assert.deepEqual(await readdir(root), ["receipt.json"]);
  await saveJson(path, { status: "confirmed" });
  assert.deepEqual(await loadJson(path), { status: "confirmed" });
  await chmod(path, 0o644);
  await assert.rejects(loadJson(path), /private/);
  await chmod(root, 0o755);
  await assert.rejects(privateDirectory(root), /private/);
});

test("local state readers reject symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "outright-localnet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveJson(join(root, "source.json"), { status: "signed" });
  await symlink(join(root, "source.json"), join(root, "link.json"));
  await assert.rejects(loadJson(join(root, "link.json")), { code: "ELOOP" });
});

test("bootstrap restart reconciles an existing signature without broadcasting", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "outright-localnet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await privateDirectory(join(root, "receipts"));
  const path = join(root, "receipts", "saved.json");
  await saveJson(path, { signature: "saved", status: "signed" });
  let reads = 0;
  const rpc = {
    getSignatureStatuses: async (signatures, options) => {
      reads++;
      assert.deepEqual(signatures, ["saved"]);
      assert.equal(options.searchTransactionHistory, true);
      return {
        value: [{ confirmationStatus: "confirmed", slot: 42, err: null }],
      };
    },
  };
  await reconcileSetup(rpc, root);
  assert.equal(reads, 1);
  assert.deepEqual(await loadJson(path), {
    signature: "saved",
    status: "confirmed",
    slot: 42,
  });
  await reconcileSetup(rpc, root);
  assert.equal(reads, 1);
});

test("failed and unresolved setup transactions stop continuation", async () => {
  await assert.rejects(
    confirm(
      {
        getSignatureStatuses: async () => ({
          value: [
            {
              confirmationStatus: "confirmed",
              err: { InstructionError: [0, "Custom"] },
            },
          ],
        }),
      },
      "failed",
    ),
    /Local transaction failed/,
  );
  await assert.rejects(
    confirm(
      { getSignatureStatuses: async () => ({ value: [null] }) },
      "pending",
      0,
    ),
    /unresolved/,
  );
});
