import { PublicKey } from "@solana/web3.js";
import contract from "../upstream-contract.json" with { type: "json" };
import { ENGINE_COMMIT, WRAPPER_COMMIT } from "./instructions.mjs";
import { fields, layouts as l } from "./layout.mjs";

if (
  contract.engineCommit !== ENGINE_COMMIT ||
  contract.wrapperCommit !== WRAPPER_COMMIT
)
  throw new Error("Generated contract does not match pinned source");
const c = contract.constants;
const pk = (v) => new PublicKey(v).toBase58();
const keyAt = (b, off) => new PublicKey(b.subarray(off, off + 32)).toBase58();
function u128(b, off) {
  return b.readBigUInt64LE(off) | (b.readBigUInt64LE(off + 8) << 64n);
}

// This is a strict reader for this release's account shape, not a migration
// parser or a substitute for the engine's account/invariant validation.
export function readPortfolio(account, { programId, address, market, owner }) {
  if (!account || account.executable || pk(account.owner) !== pk(programId))
    throw new Error("Portfolio is not owned by the expected program");
  const b = Buffer.from(account.data);
  if (b.length !== c.portfolioLength)
    throw new Error(
      "Unsupported portfolio layout; refresh the source pin and regenerate the contract",
    );
  if (
    b.readBigUInt64LE(0) !== BigInt("0x" + c.magic) ||
    b.readUInt16LE(8) !== c.version ||
    b[10] !== c.portfolioKind
  )
    throw new Error("Invalid portfolio header");
  const actualMarket = keyAt(b, c.portfolioMarketOffset),
    actualAddress = keyAt(b, c.portfolioAddressOffset),
    actualOwner = keyAt(b, c.portfolioOwnerOffset);
  if (
    actualMarket !== pk(market) ||
    actualAddress !== pk(address) ||
    actualOwner !== keyAt(b, c.portfolioProvenanceOwnerOffset) ||
    (owner && actualOwner !== pk(owner))
  )
    throw new Error("Portfolio identity does not match the requested account");
  const portfolioId = b.readBigUInt64LE(c.portfolioIdOffset);
  if (portfolioId === 0n) throw new Error("Uninitialized portfolio identity");
  const control = b.readBigUInt64LE(c.portfolioControlOffset),
    matcherFeeCap = control >> 50n;
  if (matcherFeeCap > 10000n) throw new Error("Invalid matcher fee cap");
  const pnl = u128(b, c.portfolioPnlOffset);
  const state = fields(b, c.headerLength, l.portfolio);
  const resolvedPayout = fields(
    b,
    c.headerLength + l.payoutReceiptOffset,
    l.payoutReceipt,
  );
  const face = resolvedPayout.terminal_positive_claim_face;
  if (!resolvedPayout.present) {
    if (Object.values(resolvedPayout).some((v) => v !== false && v !== 0n))
      throw new Error("Hidden resolved payout receipt");
  } else if (
    face * BigInt(l.boundScale) > (1n << 128n) - 1n ||
    face * BigInt(l.boundScale) > resolvedPayout.prior_bound_contribution_num ||
    resolvedPayout.paid_effective > face ||
    resolvedPayout.finalized !== (resolvedPayout.paid_effective === face)
  )
    throw new Error("Invalid resolved payout receipt");
  const positions = [];
  let bitmap = 0n;
  for (let i = 0; i < l.legCount; i++) {
    const offset = c.headerLength + l.legsOffset + i * l.legLength;
    const leg = fields(b, offset, l.leg);
    if (leg.active) {
      // An attached leg can have no exposure and still retain loss weight.
      // Match validate_active_leg's static bounds before admitting that state.
      const raw = leg.basis_pos_q < 0n ? -leg.basis_pos_q : leg.basis_pos_q;
      if (
        leg.side > 1 ||
        leg.market_id === 0n ||
        raw > BigInt(l.maxPositionAbsQ) ||
        leg.a_basis < BigInt(l.minASide) ||
        leg.a_basis > BigInt(l.adlOne) ||
        leg.k_snap === -(1n << 127n) ||
        leg.f_snap === -(1n << 127n) ||
        leg.loss_weight === 0n ||
        leg.loss_weight > BigInt(l.socialLossDen) ||
        leg.b_rem >= BigInt(l.socialLossDen) ||
        leg.b_epoch_snap !== leg.epoch_snap
      )
        throw new Error("Invalid active position");
      const currentWeight =
        (raw * BigInt(l.socialWeightScale) + leg.a_basis - 1n) / leg.a_basis;
      if (leg.loss_weight < currentWeight)
        throw new Error("Position loss weight is below its current exposure");
      bitmap |= 1n << BigInt(i);
      positions.push(Object.freeze({ slot: i, ...leg }));
    } else {
      // Upstream EMPTY retains ADL_ONE in a_basis; the remaining bytes are zero.
      const empty = Buffer.from(b.subarray(offset, offset + l.legLength));
      empty.fill(0, l.leg.a_basis.offset, l.leg.a_basis.offset + 16);
      if (leg.a_basis !== BigInt(l.adlOne) || empty.some((v) => v !== 0))
        throw new Error("Hidden inactive position");
    }
  }
  if (bitmap !== state.active_bitmap)
    throw new Error("Position bitmap mismatch");
  return Object.freeze({
    address: actualAddress,
    market: actualMarket,
    owner: actualOwner,
    portfolioId,
    expectedSequence: b.readBigUInt64LE(c.portfolioSequenceOffset),
    positionEpoch: (control >> 1n) & BigInt(c.positionEpochMax),
    capital: u128(b, c.portfolioCapitalOffset),
    pnl: pnl >= 1n << 127n ? pnl - (1n << 128n) : pnl,
    matcherEnabled: (control & 1n) === 1n,
    matcherFeeCapBps: Number(matcherFeeCap),
    matcher: fields(b, l.matcherOffset, l.matcher),
    matcherExpirySlot: b.readBigUInt64LE(l.matcherExpiryOffset),
    state,
    resolvedPayout,
    positions: Object.freeze(positions),
    healthCertificate: fields(b, c.headerLength + l.healthOffset, l.health),
  });
}
