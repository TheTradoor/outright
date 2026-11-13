import contract from "../../upstream-contract.json" with { type: "json" };

// Deterministic RPC fixture mutations, not execution evidence. Public SBF
// instructions construct the economic scenario in svm/lifecycle.rs.
export function setSettlement(
  f,
  { market = {}, ledger = {}, receipt = {}, wrapper = {} } = {},
) {
  const c = contract.constants,
    l = contract.layouts;
  const m = f.accounts.get(f.market.toBase58()).data;
  const p = f.accounts.get(f.identity.address.toBase58()).data;
  const put = (b, base, fields, values) => {
    for (const [name, value] of Object.entries(values)) {
      const field = fields[name],
        offset = base + field.offset;
      if (field.type === "bool" || field.type === "u8")
        b[offset] = Number(value);
      else {
        b.writeBigUInt64LE(BigInt(value) & ((1n << 64n) - 1n), offset);
        if (field.type === "u128")
          b.writeBigUInt64LE(BigInt(value) >> 64n, offset + 8);
      }
    }
  };
  put(m, c.headerLength, l.wrapper, wrapper);
  put(m, c.marketGroupOffset, l.market, {
    mode: 1,
    resolved_slot: 123n,
    vault: 1_000_000n,
    payout_snapshot_captured: true,
    ...market,
  });
  put(m, c.marketGroupOffset + l.payoutLedgerOffset, l.payoutLedger, {
    current_payout_rate_num: 3n,
    current_payout_rate_den: 4n,
    payout_halted: false,
    finalized: false,
    ...ledger,
  });
  put(p, c.headerLength + l.payoutReceiptOffset, l.payoutReceipt, {
    present: true,
    prior_bound_contribution_num: 2000n * BigInt(l.boundScale),
    live_released_face_at_receipt: 0n,
    terminal_positive_claim_face: 2000n,
    paid_effective: 1250n,
    finalized: false,
    ...receipt,
  });
  return f;
}
