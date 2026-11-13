import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import contract from "../upstream-contract.json" with { type: "json" };
import { TOKEN_PROGRAM_ID, matcherDelegate } from "../src/instructions.mjs";

const key = (value) => new PublicKey(value);
const meta = (pubkey, isSigner = false, isWritable = false) => ({
  pubkey: key(pubkey),
  isSigner,
  isWritable,
});

export function finalizeProgram(programData, authority) {
  return new TransactionInstruction({
    programId: key(contract.localnet.programLoader),
    keys: [meta(programData, false, true), meta(authority, true)],
    data: Buffer.from(contract.localnet.finalizeProgramHex, "hex"),
  });
}
function number(value, bytes) {
  if (
    typeof value !== "bigint" ||
    value < 0n ||
    value >= 1n << BigInt(bytes * 8)
  )
    throw new Error(
      "Local market instruction requires a bounded unsigned bigint",
    );
  const data = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++, value >>= 8n) data[i] = Number(value & 255n);
  return data;
}

// The fixed market is a test instrument at 1 TEST, with zero funding and fees.
// Its complete initialization bytes are exported by the pinned Rust encoder.
export function initializeMarket(program, admin, market, mint) {
  return new TransactionInstruction({
    programId: key(program),
    keys: [meta(admin, true, true), meta(market, false, true), meta(mint)],
    data: Buffer.from(contract.localnet.initializeMarketHex, "hex"),
  });
}

export function initializeMint(mint, authority) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [meta(mint, false, true)],
    data: Buffer.concat([
      Buffer.from([20, 6]),
      key(authority).toBuffer(),
      Buffer.from([0]),
    ]),
  });
}

export function mintTokens(mint, destination, authority, amount) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      meta(mint, false, true),
      meta(destination, false, true),
      meta(authority, true),
    ],
    data: Buffer.concat([
      Buffer.from([14]),
      number(amount, 8),
      Buffer.from([6]),
    ]),
  });
}

export function markInstruction(
  program,
  admin,
  market,
  asset,
  slot,
  configure = false,
) {
  return new TransactionInstruction({
    programId: key(program),
    keys: [meta(admin, true, true), meta(market, false, true)],
    data: Buffer.concat([
      Buffer.from([configure ? 62 : 63]),
      number(0n, 2),
      number(asset.market_id, 8),
      number(BigInt(slot), 8),
      number(1_000_000n, 8),
      number(asset.control.oracle_observation + 1n, 8),
      number(asset.control.authority_epoch, 8),
    ]),
  });
}

export function initializeMatcher(
  program,
  matcher,
  context,
  owner,
  market,
  portfolio,
) {
  const delegate = matcherDelegate(program, {
    market,
    makerPortfolio: portfolio,
    makerOwner: owner,
    matcherProgram: matcher,
    matcherContext: context,
  });
  return new TransactionInstruction({
    programId: key(matcher),
    keys: [
      meta(owner, true),
      meta(delegate),
      meta(context, false, true),
      meta(program),
      meta(market),
      meta(portfolio),
    ],
    data: Buffer.from([2]),
  });
}

export function matcherConsent(
  program,
  matcher,
  context,
  owner,
  market,
  portfolio,
  state,
  frontier,
  expirySlot,
) {
  const delegate = matcherDelegate(program, {
    market,
    makerPortfolio: portfolio,
    makerOwner: owner,
    matcherProgram: matcher,
    matcherContext: context,
  });
  return new TransactionInstruction({
    programId: key(program),
    keys: [
      meta(owner, true, true),
      meta(market),
      meta(portfolio, false, true),
      meta(matcher),
      meta(context),
      meta(delegate),
    ],
    data: Buffer.concat([
      Buffer.from([68]),
      number(state.portfolioId, 8),
      number(state.expectedSequence, 8),
      number(state.positionEpoch, 8),
      number(frontier, 8),
      Buffer.from([1]),
      number(100n, 2),
      number(BigInt(expirySlot), 8),
    ]),
  });
}
