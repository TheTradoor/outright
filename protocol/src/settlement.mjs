export const isSettlementAction = (type) =>
  type === "closeResolved" || type === "claimResolvedPayoutTopup";

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
