import {
  constants as c,
  layouts as l,
  accountBytes,
  fields,
  keyAt,
  keyString,
} from "./layout.mjs";

const modes = ["live", "resolved", "recovery"];
const lifecycles = [
  "disabled",
  "pending",
  "active",
  "drainOnly",
  "retired",
  "recovery",
];

// A source-pinned structural reader. Economic validity is still decided by SBF.
export function readMarket(account, { programId, address, collateralMint }) {
  const b = accountBytes(account, programId, c.marketKind, "Market");
  const start = c.marketGroupOffset + c.marketHeaderLength;
  if (b.length < start) throw new Error("Truncated market layout");
  const header = fields(b, c.marketGroupOffset, l.market);
  const config = fields(b, c.marketGroupOffset + l.configOffset, l.config);
  const wrapper = fields(b, c.headerLength, l.wrapper);
  const resolvedPayout = fields(
    b,
    c.marketGroupOffset + l.payoutLedgerOffset,
    l.payoutLedger,
  );
  if (header.market_group_id !== keyString(address))
    throw new Error("Market identity mismatch");
  if (collateralMint && wrapper.collateral_mint !== keyString(collateralMint))
    throw new Error("Market collateral mint mismatch");
  if (
    !header.asset_slot_capacity ||
    b.length !== start + header.asset_slot_capacity * c.marketAssetSlotLength ||
    !config.max_market_slots ||
    config.max_market_slots > header.asset_slot_capacity ||
    !config.max_portfolio_assets ||
    config.max_portfolio_assets > l.legCount ||
    !modes[header.mode]
  )
    throw new Error("Unsupported market layout or mode");
  const assets = [];
  for (let index = 0; index < header.asset_slot_capacity; index++) {
    const base = start + index * c.marketAssetSlotLength;
    const asset = fields(b, base + l.assetOffset, l.asset);
    const oracle = fields(b, base, l.oracle);
    if (
      !lifecycles[asset.lifecycle] ||
      asset.mode_long > 2 ||
      asset.mode_short > 2 ||
      oracle.oracle_leg_count > 3
    )
      throw new Error("Invalid asset state");
    assets.push(
      Object.freeze({
        index,
        ...asset,
        lifecycle: lifecycles[asset.lifecycle],
        oracle,
        oracleFeeds: Object.freeze(
          Array.from({ length: oracle.oracle_leg_count }, (_, i) =>
            keyAt(b, base + l.oracleFeedsOffset + 32 * i),
          ),
        ),
      }),
    );
  }
  return Object.freeze({
    address: keyString(address),
    ...header,
    mode: modes[header.mode],
    config,
    wrapper,
    resolvedPayout,
    assets: Object.freeze(assets),
  });
}

// Mirrors effective_abs_quantity_for_leg in the pinned engine. Raw basis is not
// the live exposure after ADL. An obligation from the immediately prior reset has
// zero live quantity and must not be presented as an open position to reverse.
export function positionForMarket(leg, market) {
  const asset = market.assets[leg.asset_index];
  if (
    !asset ||
    asset.market_id !== leg.market_id ||
    !leg.active ||
    leg.side > 1
  )
    throw new Error("Position asset identity mismatch");
  const side = leg.side === 0 ? "long" : "short";
  const epoch = asset[`epoch_${side}`],
    mode = asset[`mode_${side}`];
  const raw = leg.basis_pos_q < 0n ? -leg.basis_pos_q : leg.basis_pos_q;
  let quantity;
  if (epoch === leg.epoch_snap) {
    const a = asset[`a_${side}`];
    if (
      raw === 0n ||
      raw > BigInt(l.maxPositionAbsQ) ||
      leg.a_basis < BigInt(l.minASide) ||
      leg.a_basis > BigInt(l.adlOne) ||
      a < 1n ||
      a > leg.a_basis
    )
      throw new Error("Invalid position scale");
    quantity = (raw * a + leg.a_basis - 1n) / leg.a_basis;
  } else if (mode === 2 && leg.epoch_snap + 1n === epoch) quantity = 0n;
  else throw new Error("Invalid position epoch");
  return Object.freeze({
    ...leg,
    side,
    effectiveSizeQ: side === "short" ? -quantity : quantity,
    effectivePrice: asset.effective_price,
    needsCleanup: quantity === 0n,
  });
}
