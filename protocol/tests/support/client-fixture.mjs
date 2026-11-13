import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import contract from "../../upstream-contract.json" with { type: "json" };
import {
  OutrightClient,
  portfolioAddress,
  validateProfile,
  sha256,
} from "../../src/client.mjs";
import {
  ENGINE_COMMIT,
  WRAPPER_COMMIT,
  vaultAuthority,
  TOKEN_PROGRAM_ID,
  matcherDelegate,
} from "../../src/instructions.mjs";

export const pub = (n) => new PublicKey(Buffer.alloc(32, n));
export const info = (owner, data, executable = false) => ({
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

// Public, deterministic RPC accounts. Program execution is tested by SBF.
export async function withMaker(f) {
  const portfolio = pub(12),
    owner = pub(13),
    program = pub(14),
    programData = pub(15),
    context = pub(16);
  const code = Buffer.from(f.accounts.get(f.programData.toBase58()).data);
  const programBytes = Buffer.from(f.accounts.get(f.programId.toBase58()).data);
  programData.toBuffer().copy(programBytes, 4);
  const data = Buffer.from(contract.portfolioFixtureHex, "hex");
  const c = contract.constants,
    l = contract.layouts;
  portfolio.toBuffer().copy(data, c.portfolioAddressOffset);
  owner.toBuffer().copy(data, c.portfolioOwnerOffset);
  owner.toBuffer().copy(data, c.portfolioProvenanceOwnerOffset);
  data.writeBigUInt64LE(18n, c.portfolioIdOffset);
  data.writeBigUInt64LE(
    data.readBigUInt64LE(c.portfolioControlOffset) | 1n | (10n << 50n),
    c.portfolioControlOffset,
  );
  data.writeBigUInt64LE(500n, l.matcherExpiryOffset);
  const delegate = matcherDelegate(f.programId, {
    market: f.market,
    makerPortfolio: portfolio,
    makerOwner: owner,
    matcherProgram: program,
    matcherContext: context,
  });
  program
    .toBuffer()
    .copy(data, l.matcherOffset + l.matcher.matcher_program.offset);
  context
    .toBuffer()
    .copy(data, l.matcherOffset + l.matcher.matcher_context.offset);
  delegate
    .toBuffer()
    .copy(data, l.matcherOffset + l.matcher.matcher_delegate.offset);
  f.accounts.set(portfolio.toBase58(), info(f.programId, data));
  f.accounts.set(program.toBase58(), info(loader, programBytes, true));
  f.accounts.set(programData.toBase58(), info(loader, code));
  f.accounts.set(context.toBase58(), info(program, Buffer.alloc(64)));
  f.profile = validateProfile({
    ...f.profile,
    maker: {
      portfolio,
      owner,
      context,
      program: {
        address: program,
        programData,
        sha256: await sha256(code.subarray(45)),
        upgradeAuthority: null,
      },
      feeBps: 10,
      backingFeeCapBps: 0,
    },
  });
  f.client = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  f.maker = { portfolio, owner, program, programData, context };
  return f;
}
