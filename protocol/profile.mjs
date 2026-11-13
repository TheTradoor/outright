#!/usr/bin/env node
// Read-only deployment enrollment. No keypair loading, signing, or broadcasting.
import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, unpackMint } from "./src/token.mjs";
import { readMarket } from "./src/market.mjs";
import { validateProfile, readSnapshot, sha256 } from "./src/client.mjs";
import {
  ENGINE_COMMIT,
  WRAPPER_COMMIT,
  TOKEN_PROGRAM_ID,
  vaultAuthority,
} from "./src/instructions.mjs";

const allowed = new Set([
  "rpc",
  "cluster",
  "program",
  "program-binary",
  "market",
  "wallet",
  "symbol",
  "max-oracle-age-slots",
  "maker-portfolio",
  "maker-owner",
  "matcher-program",
  "matcher-binary",
  "matcher-context",
  "fee-bps",
  "backing-fee-cap-bps",
]);
const argv = process.argv.slice(2),
  args = {};
if (!argv.length || argv.includes("--help")) {
  console.log(`Usage: node profile.mjs --rpc URL --cluster devnet|localnet --program ADDRESS
  --program-binary PATH --market ADDRESS --wallet ADDRESS --symbol SYMBOL
  --max-oracle-age-slots COUNT

Optional maker: --maker-portfolio ADDRESS --maker-owner ADDRESS
  --matcher-program ADDRESS --matcher-binary PATH --matcher-context ADDRESS
  --fee-bps NUMBER --backing-fee-cap-bps NUMBER

Writes a public deployment profile to stdout after verification. Use a binary
built from the pinned source. No private keys or real funds are needed.`);
  process.exit(0);
}
for (let i = 0; i < argv.length; i += 2) {
  const flag = argv[i].replace(/^--/, "");
  if (
    !argv[i].startsWith("--") ||
    !allowed.has(flag) ||
    !argv[i + 1] ||
    args[flag]
  )
    throw new Error(`Invalid or repeated option: ${argv[i]}`);
  args[flag] = argv[i + 1];
}
for (const required of [
  "rpc",
  "cluster",
  "program",
  "program-binary",
  "market",
  "wallet",
  "symbol",
  "max-oracle-age-slots",
])
  if (!args[required]) throw new Error(`Missing --${required}`);
const rpc = new Connection(args.rpc, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
});
const key = (v) => new PublicKey(v);
async function pin(address, binaryPath) {
  const account = await rpc.getAccountInfo(key(address), "confirmed");
  if (
    !account?.executable ||
    account.owner.toBase58() !==
      "BPFLoaderUpgradeab1e11111111111111111111111" ||
    account.data.length !== 36 ||
    account.data.readUInt32LE(0) !== 2
  )
    throw new Error("Expected an upgradeable BPF program");
  const programData = key(account.data.subarray(4, 36));
  const data = await rpc.getAccountInfo(programData, "confirmed");
  if (
    !data ||
    data.data.length <= 45 ||
    data.data.readUInt32LE(0) !== 3 ||
    data.data[12] > 1
  )
    throw new Error("Unsupported program data");
  const binary = readFileSync(binaryPath),
    deployed = data.data.subarray(45);
  if (
    !binary.length ||
    binary.length > deployed.length ||
    !binary.equals(deployed.subarray(0, binary.length)) ||
    deployed.subarray(binary.length).some((b) => b !== 0)
  )
    throw new Error("Deployed code differs from the supplied build artifact");
  return {
    address: key(address).toBase58(),
    programData: programData.toBase58(),
    sha256: await sha256(deployed),
    upgradeAuthority:
      data.data[12] === 1 ? key(data.data.subarray(13, 45)).toBase58() : null,
  };
}
const program = await pin(args.program, args["program-binary"]);
const marketInfo = await rpc.getAccountInfo(key(args.market), "confirmed");
const market = readMarket(marketInfo, {
  programId: args.program,
  address: args.market,
});
const mintAddress = key(market.wrapper.collateral_mint);
const mintInfo = await rpc.getAccountInfo(mintAddress, "confirmed");
const mint = unpackMint(mintAddress, mintInfo, TOKEN_PROGRAM_ID);
const makerKeys = [
  "maker-portfolio",
  "maker-owner",
  "matcher-program",
  "matcher-binary",
  "matcher-context",
  "fee-bps",
  "backing-fee-cap-bps",
];
let maker = null;
if (makerKeys.some((k) => args[k])) {
  if (!makerKeys.every((k) => args[k]))
    throw new Error("Supply every maker option together");
  maker = {
    portfolio: args["maker-portfolio"],
    owner: args["maker-owner"],
    context: args["matcher-context"],
    program: await pin(args["matcher-program"], args["matcher-binary"]),
    feeBps: Number(args["fee-bps"]),
    backingFeeCapBps: Number(args["backing-fee-cap-bps"]),
  };
}
const profile = validateProfile({
  version: 1,
  cluster: args.cluster,
  rpcUrl: args.rpc,
  genesisHash: await rpc.getGenesisHash(),
  engineCommit: ENGINE_COMMIT,
  wrapperCommit: WRAPPER_COMMIT,
  program,
  market: args.market,
  collateral: {
    mint: mintAddress,
    decimals: mint.decimals,
    symbol: args.symbol,
    mintAuthority: mint.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
  },
  vault: getAssociatedTokenAddressSync(
    mintAddress,
    vaultAuthority(args.program, args.market),
    true,
  ),
  maker,
  maxOracleAgeSlots: Number(args["max-oracle-age-slots"]),
  assets: [],
});
const snapshot = await readSnapshot(rpc, profile, args.wallet);
if (profile.maker && snapshot.makerError) throw new Error(snapshot.makerError);
console.log(JSON.stringify(profile, null, 2));
