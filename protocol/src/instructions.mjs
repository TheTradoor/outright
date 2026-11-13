import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const WRAPPER_COMMIT = "357157e6e14d1d10ce78a995d5d50bb3c1f2ae13";
export const ENGINE_COMMIT = "a712af767eeb217876a3d3c50e3849b60ea54462";

function integer(value, name, bits, signed = false, nonzero = false) {
  // Monetary and identity values never pass through floating point.
  if (
    typeof value !== "bigint" &&
    (typeof value !== "string" ||
      value.length > 40 ||
      !/^-?(0|[1-9][0-9]*)$/.test(value))
  )
    throw new Error(`${name}: use a bigint or decimal integer string`);
  const n = BigInt(value),
    min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = (1n << BigInt(signed ? bits - 1 : bits)) - 1n;
  if (n < min || n > max || (nonzero && n === 0n))
    throw new Error(`${name}: out of range`);
  return n;
}
function wide(value, name, bits, signed = false, nonzero = false) {
  let n = integer(value, name, bits, signed, nonzero);
  if (n < 0n) n += 1n << BigInt(bits);
  const b = Buffer.alloc(bits / 8);
  for (let i = 0; i < b.length; i++, n >>= 8n) b[i] = Number(n & 255n);
  return b;
}
function small(value, name, max, bytes) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error(`${name}: out of range`);
  return wide(BigInt(value), name, bytes * 8);
}
const u64 = (a, key, nonzero = false) => wide(a[key], key, 64, false, nonzero);
const fee = (a, key) => {
  const n = integer(a[key], key, 64);
  if (n > 10_000n) throw new Error(`${key}: exceeds 10000 bps`);
  return wide(n, key, 64);
};
function binding(a) {
  for (const k of ["takerPositionEpoch", "makerPositionEpoch"])
    if (integer(a[k], k, 64) >= 1n << 49n)
      throw new Error(`${k}: out of range`);
  return [
    u64(a, "takerPortfolioId", true),
    u64(a, "takerPositionEpoch"),
    u64(a, "makerPortfolioId", true),
    u64(a, "makerPositionEpoch"),
  ];
}
export function encodeInstruction(name, a = {}) {
  switch (name) {
    case "initPortfolio":
      return Buffer.from([1]);
    case "closeResolved":
      // The wrapper ignores this legacy fee field and uses the market policy.
      return Buffer.concat([Buffer.from([30]), Buffer.alloc(16)]);
    case "claimResolvedPayoutTopup":
      return Buffer.from([46]);
    case "closePortfolio":
      if (integer(a.positionEpoch, "positionEpoch", 64) >= 1n << 49n)
        throw new Error("positionEpoch: out of range");
      return Buffer.concat([
        Buffer.from([8]),
        u64(a, "portfolioId", true),
        u64(a, "expectedSequence"),
        u64(a, "positionEpoch"),
      ]);
    case "closeSlab":
      return Buffer.concat([Buffer.from([13]), u64(a, "authorityEpoch")]);
    case "forfeitRecoveryLeg":
      if (integer(a.positionEpoch, "positionEpoch", 64) >= 1n << 49n)
        throw new Error("positionEpoch: out of range");
      return Buffer.concat([
        Buffer.from([43]),
        u64(a, "portfolioId", true),
        u64(a, "positionEpoch"),
        small(a.assetIndex, "assetIndex", 65535, 2),
        wide(a.bDeltaBudget, "bDeltaBudget", 128, false, true),
      ]);
    case "deposit":
    case "withdraw": {
      // SPL Token movement is u64 even though the engine's wire field is u128.
      integer(a.amount, "amount", 64, false, true);
      return Buffer.concat([
        Buffer.from([name === "deposit" ? 3 : 4]),
        u64(a, "portfolioId", true),
        u64(a, "expectedSequence"),
        wide(a.amount, "amount", 128),
      ]);
    }
    case "tradeNoCpi":
    case "tradeCpi": {
      const size = integer(a.sizeQ, "sizeQ", 128, true, true);
      // The program must negate this amount for the opposing position.
      if (size === -(1n << 127n)) throw new Error("sizeQ: out of range");
      const parts = [
        Buffer.from([name === "tradeNoCpi" ? 6 : 10]),
        ...binding(a),
      ];
      if (name === "tradeCpi") parts.push(u64(a, "makerMatcherSequence"));
      parts.push(
        small(a.assetIndex, "assetIndex", 65535, 2),
        u64(a, "marketId", true),
        wide(size, "sizeQ", 128, true, true),
      );
      if (name === "tradeNoCpi")
        parts.push(u64(a, "execPrice", true), fee(a, "feeBps"));
      else parts.push(fee(a, "feeBps"), u64(a, "limitPrice", true)); // This client requires an explicit price bound.
      parts.push(small(a.backingFeeCapBps, "backingFeeCapBps", 10000, 2));
      return Buffer.concat(parts);
    }
    case "permissionlessCrank": {
      if (!Array.isArray(a.observations) || a.observations.length > 16)
        throw new Error("observations: at most 16");
      const seen = new Set();
      const observations = a.observations.flatMap((o) => {
        if (seen.has(o.assetIndex))
          throw new Error("observations: duplicate asset");
        seen.add(o.assetIndex);
        return [
          small(o.assetIndex, "assetIndex", 65535, 2),
          small(o.oracleAccounts, "oracleAccounts", 3, 1),
        ];
      });
      return Buffer.concat([
        Buffer.from([5]),
        u64(a, "nowSlot"),
        Buffer.from([a.observations.length]),
        ...observations,
      ]);
    }
    default:
      throw new Error(`Unsupported instruction: ${name}`);
  }
}
function key(value) {
  return value instanceof PublicKey ? value : new PublicKey(value);
}
function meta(value, isSigner = false, isWritable = false) {
  return { pubkey: key(value), isSigner, isWritable };
}
export function vaultAuthority(program, market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), key(market).toBuffer()],
    key(program),
  )[0];
}
export function matcherDelegate(program, a) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("matcher"),
      ...[
        "market",
        "makerPortfolio",
        "makerOwner",
        "matcherProgram",
        "matcherContext",
      ].map((k) => key(a[k]).toBuffer()),
    ],
    key(program),
  )[0];
}
export function buildInstruction(program, name, args, a) {
  let keys;
  switch (name) {
    case "initPortfolio":
    case "forfeitRecoveryLeg":
    case "closePortfolio":
      if (
        new Set([a.owner, a.market, a.portfolio].map((v) => key(v).toBase58()))
          .size !== 3
      )
        throw new Error("Portfolio instruction identities must differ");
      keys = [
        meta(a.owner, true),
        meta(a.market, false, true),
        meta(a.portfolio, false, true),
      ];
      break;
    case "closeSlab": {
      // Single classic SPL collateral only. The mint is writable because the
      // engine can retire booked, claim-free residue by burning it on closure.
      if (
        key(a.mint).toBase58() === "So11111111111111111111111111111111111111112"
      )
        throw new Error(
          "Native collateral closure requires a separate residue destination",
        );
      const authority = vaultAuthority(program, a.market);
      const addresses = [
        program,
        a.owner,
        a.market,
        a.vault,
        authority,
        a.userToken,
        TOKEN_PROGRAM_ID,
        a.mint,
      ].map((v) => key(v).toBase58());
      if (new Set(addresses).size !== addresses.length)
        throw new Error("Market closure identities must differ");
      keys = [
        meta(a.owner, true, true),
        meta(a.market, false, true),
        meta(a.vault, false, true),
        meta(authority),
        meta(a.userToken, false, true),
        meta(TOKEN_PROGRAM_ID),
        meta(a.mint, false, true),
      ];
      break;
    }
    case "deposit":
    case "withdraw":
    case "closeResolved":
    case "claimResolvedPayoutTopup":
      if (key(a.userToken).equals(key(a.vault)))
        throw new Error("User token account cannot be the vault");
      keys = [
        meta(a.owner, true),
        meta(a.market, false, true),
        meta(a.portfolio, false, true),
        meta(a.userToken, false, true),
        meta(a.vault, false, true),
      ];
      if (name !== "deposit")
        keys.push(meta(vaultAuthority(program, a.market)));
      keys.push(meta(TOKEN_PROGRAM_ID));
      break;
    case "tradeNoCpi":
      if (key(a.takerPortfolio).equals(key(a.makerPortfolio)))
        throw new Error("Counterparty portfolio must differ");
      keys = [
        meta(a.takerOwner, true),
        meta(a.makerOwner, true),
        meta(a.market, false, true),
        meta(a.takerPortfolio, false, true),
        meta(a.makerPortfolio, false, true),
      ];
      break;
    case "tradeCpi":
      if (key(a.takerPortfolio).equals(key(a.makerPortfolio)))
        throw new Error("Counterparty portfolio must differ");
      if (key(a.matcherProgram).equals(key(program)))
        throw new Error("Matcher program must differ");
      keys = [
        meta(a.takerOwner, true),
        meta(a.market, false, true),
        meta(a.takerPortfolio, false, true),
        meta(a.makerPortfolio, false, true),
        meta(a.matcherProgram),
        meta(a.matcherContext, false, true),
        meta(matcherDelegate(program, a)),
      ];
      // No arbitrary extra instruction/tail accounts are accepted in this first integration.
      break;
    case "permissionlessCrank": {
      const expected = args.observations.reduce(
        (n, o) => n + o.oracleAccounts,
        0,
      );
      if (
        !Array.isArray(a.oracleAccounts) ||
        a.oracleAccounts.length !== expected
      )
        throw new Error(
          "Oracle account count does not match crank observations",
        );
      const reserved = [program, a.owner, a.market, a.portfolio].map((v) =>
        key(v).toBase58(),
      );
      if (new Set(reserved).size !== reserved.length)
        throw new Error("Crank identities must differ");
      if (a.oracleAccounts.some((v) => reserved.includes(key(v).toBase58())))
        throw new Error("Oracle account aliases a crank identity");
      if (a.resolvedPayout !== undefined) {
        if (expected !== 0 || args.observations.length > 1)
          throw new Error(
            "Resolved cranks accept one backing hint and no oracle accounts",
          );
        const { userToken, vault } = a.resolvedPayout;
        const authority = vaultAuthority(program, a.market);
        const addresses = [
          ...reserved,
          userToken,
          vault,
          authority,
          TOKEN_PROGRAM_ID,
        ].map((v) => key(v).toBase58());
        if (new Set(addresses).size !== addresses.length)
          throw new Error(
            "Resolved payout accounts must not alias crank identities",
          );
        keys = [
          meta(a.owner),
          meta(a.market, false, true),
          meta(a.portfolio, false, true),
          meta(userToken, false, true),
          meta(vault, false, true),
          meta(authority),
          meta(TOKEN_PROGRAM_ID),
        ];
        break;
      }
      keys = [
        meta(a.owner, true),
        meta(a.market, false, true),
        meta(a.portfolio, false, true),
        ...a.oracleAccounts.map((v) => meta(v)),
      ];
      break;
    }
    default:
      throw new Error(
        "This instruction has no account planner in the current integration",
      );
  }
  return new TransactionInstruction({
    programId: key(program),
    keys,
    data: encodeInstruction(name, args),
  });
}

export function parseUnits(text, decimals = 6) {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Invalid decimal scale");
  if (
    typeof text !== "string" ||
    text.length > 40 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)
  )
    throw new Error("Enter a plain decimal amount");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals)
    throw new Error("Amount has too many decimal places");
  return integer(
    BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, "0") || "0"),
    "amount",
    64,
    false,
    true,
  );
}
