import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  readFile,
  rename,
  open,
  mkdir,
  lstat,
  link,
  unlink,
  readdir,
} from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import bs58 from "bs58";
import { sha256, verifyProgram } from "../src/client.mjs";

export function localRpcUrl(input) {
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Local validator tools require http://127.0.0.1:PORT without credentials or a path",
    );
  return url.href;
}
export function connection(url) {
  return new Connection(localRpcUrl(url), {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      }),
  });
}
export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("Local validator state directory must be private (0700)");
}
export async function saveJson(path, value, { exclusive = false } = {}) {
  const temp = path + "." + randomUUID() + ".tmp";
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (exclusive) {
      await link(temp, path);
      await unlink(temp);
    } else await rename(temp, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
export async function loadJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.mode & 0o077)
      throw new Error("Local validator state files must be private (0600)");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}

export async function confirm(rpc, signature, timeout = 60000) {
  const until = Date.now() + timeout;
  do {
    const { value } = await rpc.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    if (
      value[0] &&
      ["confirmed", "finalized"].includes(value[0].confirmationStatus)
    ) {
      if (value[0].err)
        throw new Error(
          `Local transaction failed: ${signature} ${JSON.stringify(value[0].err)}`,
        );
      return value[0];
    }
    await pause(300);
  } while (Date.now() < until);
  throw new Error(
    `Local transaction is unresolved; inspect its receipt before continuing: ${signature}`,
  );
}

export async function send(rpc, root, name, instructions, signers) {
  const recent = await rpc.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: signers[0].publicKey,
      recentBlockhash: recent.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
        ...instructions,
      ],
    }).compileToV0Message(),
  );
  if (tx.serialize().length > 1232)
    throw new Error("Local setup exceeds the transaction packet size");
  const simulation = await rpc.simulateTransaction(tx, {
    sigVerify: false,
    commitment: "confirmed",
  });
  if (simulation.value.err) {
    const error = new Error(
      `Local setup simulation rejected (${name}): ${JSON.stringify(simulation.value.err)}`,
    );
    error.logs = simulation.value.logs;
    throw error;
  }
  tx.sign(signers);
  const signature = bs58.encode(tx.signatures[0]);
  const receipt = {
    name,
    signature,
    ...recent,
    status: "signed",
    at: new Date().toISOString(),
  };
  await privateDirectory(join(root, "receipts"));
  const path = join(root, "receipts", signature + ".json");
  await saveJson(path, receipt, { exclusive: true });
  const returned = await rpc.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 0,
  });
  if (returned !== signature)
    throw new Error(
      `Local send response did not match saved signature: ${signature}`,
    );
  const status = await confirm(rpc, signature);
  await saveJson(path, {
    ...receipt,
    status: status.confirmationStatus,
    slot: status.slot,
  });
  return signature;
}

export async function reconcileSetup(rpc, root) {
  let names;
  try {
    names = await readdir(join(root, "receipts"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of names.filter((name) => name.endsWith(".json"))) {
    const path = join(root, "receipts", name);
    const receipt = await loadJson(path);
    if (receipt.status !== "signed") continue;
    const status = await confirm(rpc, receipt.signature);
    await saveJson(path, {
      ...receipt,
      status: status.confirmationStatus,
      slot: status.slot,
    });
  }
}

export async function programPin(rpc, address, binaryPath) {
  const account = await rpc.getAccountInfo(new PublicKey(address), "confirmed");
  if (
    !account?.executable ||
    account.owner.toBase58() !== "BPFLoaderUpgradeab1e11111111111111111111" ||
    account.data.length !== 36 ||
    account.data.readUInt32LE(0) !== 2
  )
    throw new Error("Local validator must preload the upgradeable program");
  const programData = new PublicKey(account.data.subarray(4));
  const data = await rpc.getAccountInfo(programData, "confirmed");
  const binary = await readFile(binaryPath);
  const deployed = data?.data.subarray(45);
  if (
    !deployed ||
    !deployed.subarray(0, binary.length).equals(binary) ||
    deployed.subarray(binary.length).some((v) => v !== 0)
  )
    throw new Error("Local deployed program differs from the supplied binary");
  const pin = {
    address,
    programData: programData.toBase58(),
    sha256: await sha256(deployed),
    upgradeAuthority: null,
  };
  await verifyProgram(account, data, pin);
  return pin;
}

export function clientJournal(root) {
  let busy = false;
  const path = join(root, "client-receipts.json");
  const read = async () => {
    try {
      return await loadJson(path);
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  };
  return {
    read: async (scope) => (await read())[scope] ?? null,
    write: async (scope, record) => {
      const records = await read();
      records[scope] = record;
      await saveJson(path, records);
    },
    withLock: async (_scope, work) => {
      if (busy) throw new Error("Local client action already in progress");
      busy = true;
      try {
        return await work();
      } finally {
        busy = false;
      }
    },
  };
}

export async function clientAction(client, signer, action) {
  const owner = signer.publicKey.toBase58();
  const previous = await client.receipt(owner);
  if (
    previous &&
    !["confirmed", "finalized", "failed"].includes(previous.status)
  ) {
    await confirm(client.connection, previous.signature);
    await client.reconcile(owner);
  }
  const until = Date.now() + 10000;
  while (
    (await client.connection.getLatestBlockhash("confirmed")).blockhash ===
    previous?.blockhash
  ) {
    if (Date.now() > until)
      throw new Error("Local validator is not producing new blockhashes");
    await pause(250);
  }
  const prepared = await client.prepare(owner, action);
  const receipt = await client.submit(prepared, async (bytes) => {
    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([signer]);
    return tx.serialize();
  });
  await confirm(client.connection, receipt.signature);
  await client.reconcile(owner);
  return receipt.signature;
}
