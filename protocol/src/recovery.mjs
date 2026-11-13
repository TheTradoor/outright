import { positionForMarket } from "./market.mjs";

export const isRecoveryAction = (type) => type === "forfeitRecoveryLeg";

// Match the pinned engine's leg_is_dead_for_forfeit admission rule. Simulation
// and the program still decide whether the bounded transition can execute.
export function recoveryPosition(snapshot, assetIndex) {
  if (
    !snapshot?.portfolio ||
    !["live", "recovery"].includes(snapshot.market.mode) ||
    !Number.isSafeInteger(assetIndex) ||
    assetIndex < 0 ||
    assetIndex >= snapshot.market.config.max_market_slots
  )
    return null;
  const leg = snapshot.portfolio.positions.find(
    (p) => p.asset_index === assetIndex,
  );
  if (!leg) return null;
  const position = positionForMarket(leg, snapshot.market);
  const asset = snapshot.market.assets[assetIndex];
  const mode = asset[`mode_${position.side}`];
  return snapshot.market.mode === "recovery" ||
    asset.lifecycle === "recovery" ||
    mode === 2 ||
    (mode === 1 && position.effectiveSizeQ === 0n)
    ? position
    : null;
}
