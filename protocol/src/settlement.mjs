export const isSettlementAction = (type) =>
  type === "closeResolved" || type === "claimResolvedPayoutTopup";

// Preliminary display checks only. Simulation and the program also validate
// source domains, escrow and close progress before an account can be removed.
export function canReviewPortfolioClosure(snapshot) {
  const p = snapshot?.portfolio;
  return Boolean(
    snapshot?.market.mode === "resolved" &&
      p &&
      p.capital === 0n &&
      p.pnl === 0n &&
      p.positions.length === 0 &&
      p.state.reserved_pnl === 0n &&
      p.state.fee_credits === 0n &&
      p.state.active_bitmap === 0n &&
      !p.state.stale_state &&
      !p.state.b_stale_state &&
      !p.state.rebalance_lock &&
      !p.state.liquidation_lock &&
      (!p.resolvedPayout.present || p.resolvedPayout.finalized),
  );
}

// Only the receipt's additional payment at the recorded rate. Capital and PnL
// are separate. Another transaction can change this value before execution.
export function recordedSettlementPayout(market, portfolio) {
  const receipt = portfolio?.resolvedPayout;
  if (market.mode !== "resolved" || !receipt?.present || receipt.finalized)
    return 0n;
  const ledger = market.resolvedPayout;
  if (ledger.payout_halted) return 0n;
  const numerator = ledger.current_payout_rate_num;
  const denominator = ledger.current_payout_rate_den;
  if (
    !market.payout_snapshot_captured ||
    denominator === 0n ||
    numerator > denominator
  )
    throw new Error("Invalid resolved payout rate");
  const gross =
    (receipt.terminal_positive_claim_face * numerator) / denominator;
  if (gross < receipt.paid_effective)
    throw new Error("Resolved payout rate is below the recorded payment");
  const due = gross - receipt.paid_effective;
  return due < market.vault ? due : market.vault;
}
