import { createHash } from "node:crypto";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import contract from "../upstream-contract.json" with { type: "json" };
import { validateNetwork } from "../src/network.mjs";

// The pinned wrapper accepts the original Core receiver, not Core Compatible.
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const PUSH_PROGRAM = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111";
const DISCRIMINATOR = Buffer.from("22f123639d7ef4cd", "hex");
const MAX_PRICE_E6 = 1_000_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;

export class OracleInspectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const reject = (code) => { throw new OracleInspectionError(code); };
const hash = (data) => createHash("sha256").update(data).digest("hex");
const u64 = (value) => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > U64_MAX)
    reject("oraclePolicyInvalid");
  return BigInt(value);
};
const hexFeed = (value) => {
  if (typeof value !== "string" || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value))
    reject("oracleFeedInvalid");
  return value.replace(/^0x/, "").toLowerCase();
};

export function pythFeedAddress(feedId, shard) {
  if (!Number.isSafeInteger(shard) || shard < 0 || shard > 65535)
    reject("oracleShardInvalid");
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([seed, Buffer.from(hexFeed(feedId), "hex")], PUSH_PROGRAM)[0];
}

export function validateOracleConfig(input) {
  if (input?.version !== 1) reject("oracleConfigInvalid");
  let network;
  try { network = validateNetwork(input); } catch { reject("oracleNetworkInvalid"); }
  const feedId = hexFeed(input.feedId);
  if (/^0+$/.test(feedId)) reject("oracleFeedInvalid");
  const account = pythFeedAddress(feedId, input.shard).toBase58();
  u64(input.maxAgeSeconds);
  if (!Number.isInteger(input.maxConfidenceBps) || input.maxConfidenceBps < 1 || input.maxConfidenceBps > 10000)
    reject("oraclePolicyInvalid");
  if (!contract.keeper.oracleOwners.includes(PYTH_RECEIVER)) reject("oracleSourceMismatch");
  return Object.freeze({ version: 1, ...network, feedId, shard: input.shard, account,
    maxAgeSeconds: input.maxAgeSeconds, maxConfidenceBps: input.maxConfidenceBps });
}

// Match oracle_v16::read_oracle_price_e6_from_bytes in the pinned wrapper.
// The Rust conformance test executes the same vectors against that implementation.
export function readPythPriceE6({ owner, data, feedId, nowUnixSeconds, maxAgeSeconds, maxConfidenceBps }) {
  if (owner !== PYTH_RECEIVER) reject("oracleWrongOwner");
  if (!(data instanceof Uint8Array) || data.byteLength < 134) reject("oracleInvalidData");
  data = Buffer.from(data);
  if (!data.subarray(0, 8).equals(DISCRIMINATOR)) reject("oracleInvalidData");
  if (data[40] !== 1) reject("oracleVerificationIncomplete");
  if (data.subarray(41, 73).toString("hex") !== hexFeed(feedId)) reject("oracleFeedMismatch");
  const price = data.readBigInt64LE(73), confidence = data.readBigUInt64LE(81);
  const exponent = data.readInt32LE(89), publishTime = data.readBigInt64LE(93);
  if (price <= 0n || exponent < -18 || exponent > 18) reject("oraclePriceInvalid");
  const maxAge = u64(maxAgeSeconds);
  if (typeof nowUnixSeconds !== "bigint" || nowUnixSeconds < -(1n << 63n) || nowUnixSeconds >= (1n << 63n) ||
      !Number.isInteger(maxConfidenceBps) || maxConfidenceBps < 0 || maxConfidenceBps > 65535)
    reject("oraclePolicyInvalid");
  const age = nowUnixSeconds - publishTime;
  if (age < 0n || age > maxAge) reject("oracleStale");
  if (maxConfidenceBps !== 0 && confidence * 10000n > price * BigInt(maxConfidenceBps))
    reject("oracleConfidenceWide");
  const shift = exponent + 6, factor = 10n ** BigInt(Math.abs(shift));
  const priceE6 = shift >= 0 ? price * factor : price / factor;
  if (priceE6 === 0n || priceE6 > MAX_PRICE_E6) reject("oracleScaleInvalid");
  return Object.freeze({ priceE6: priceE6.toString(), publishTime: publishTime.toString(),
    ageSeconds: age.toString(), mantissa: price.toString(), confidence: confidence.toString(), exponent });
}

export async function inspectPythOracle(input, connection) {
  const config = validateOracleConfig(input);
  let genesis, floor, snapshot;
  try { genesis = await connection.getGenesisHash(); } catch { reject("oracleRpcUnavailable"); }
  if (genesis !== config.genesisHash) reject("oracleNetworkMismatch");
  try { floor = await connection.getSlot("confirmed"); } catch { reject("oracleRpcUnavailable"); }
  if (!Number.isSafeInteger(floor) || floor < 1) reject("oracleBankInvalid");
  try {
    snapshot = await connection.getMultipleAccountsInfoAndContext(
      [SYSVAR_CLOCK_PUBKEY, new PublicKey(config.account)],
      { commitment: "confirmed", minContextSlot: floor },
    );
  } catch { reject("oracleRpcUnavailable"); }
  const slot = snapshot?.context?.slot;
  if (!Number.isSafeInteger(slot) || slot < floor || !Array.isArray(snapshot?.value) || snapshot.value.length !== 2)
    reject("oracleBankInvalid");
  const [clock, feed] = snapshot.value;
  if (!clock || clock.executable !== false || clock.owner?.toBase58?.() !== SYSVAR_OWNER ||
      !(clock.data instanceof Uint8Array) || clock.data.length !== 40)
    reject("oracleClockInvalid");
  const clockData = Buffer.from(clock.data), nowUnixSeconds = clockData.readBigInt64LE(32);
  if (clockData.readBigUInt64LE(0) !== BigInt(slot) || nowUnixSeconds <= 0n) reject("oracleClockInvalid");
  const evidence = { version: 1, scope: "pyth-feed-inspection", cluster: config.cluster,
    genesisHash: genesis, bankSlot: slot, chainTime: nowUnixSeconds.toString(),
    feedId: config.feedId, keeperFeedId: new PublicKey(Buffer.from(config.feedId, "hex")).toBase58(),
    shard: config.shard, account: config.account,
    policy: { maxAgeSeconds: config.maxAgeSeconds, maxConfidenceBps: config.maxConfidenceBps },
    engineCommit: contract.engineCommit, wrapperCommit: contract.wrapperCommit,
    clockSha256: hash(clockData) };
  try {
    if (!feed) reject("oracleAccountMissing");
    if (feed.executable !== false || !(feed.data instanceof Uint8Array)) reject("oracleInvalidData");
    const owner = feed.owner?.toBase58?.();
    const price = readPythPriceE6({ owner, data: feed.data, feedId: config.feedId,
      nowUnixSeconds, maxAgeSeconds: config.maxAgeSeconds, maxConfidenceBps: config.maxConfidenceBps });
    return { ...evidence, status: "accepted", reasons: [], owner,
      accountSha256: hash(feed.data), ...price };
  } catch (error) {
    if (!(error instanceof OracleInspectionError)) throw error;
    return { ...evidence, status: "rejected", reasons: [error.code] };
  }
}
