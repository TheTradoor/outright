import contract from "../../upstream-contract.json" with { type: "json" };

// RPC-only fixture. SBF tests build the financial state through instructions.
export function setRecovery(
  f,
  { mode = 0, lifecycle = 5, sideMode = 0, side = 0, leg = {} } = {},
) {
  const c = contract.constants,
    l = contract.layouts;
  const m = f.accounts.get(f.market.toBase58()).data;
  const p = f.accounts.get(f.identity.address.toBase58()).data;
  const put = (data, base, fields, values) => {
    for (const [name, value] of Object.entries(values)) {
      const field = fields[name],
        offset = base + field.offset;
      if (["bool", "u8"].includes(field.type)) data[offset] = Number(value);
      else if (field.type === "u32") data.writeUInt32LE(Number(value), offset);
      else {
        let n = BigInt(value);
        const size = field.type.endsWith("128") ? 16 : 8;
        if (n < 0n) n += 1n << BigInt(size * 8);
        for (let i = 0; i < size; i++, n >>= 8n)
          data[offset + i] = Number(n & 255n);
      }
    }
  };
  put(m, c.marketGroupOffset, l.market, { mode });
  const sideName = side === 0 ? "long" : "short";
  put(m, c.marketGroupOffset + c.marketHeaderLength + l.assetOffset, l.asset, {
    lifecycle,
    [`mode_${sideName}`]: sideMode,
    [`epoch_${sideName}`]: sideMode === 2 ? 1n : 0n,
    [`a_${sideName}`]: BigInt(l.adlOne),
  });
  put(p, c.headerLength, l.portfolio, { active_bitmap: 1n });
  put(p, c.headerLength + l.legsOffset, l.leg, {
    active: true,
    asset_index: 0,
    market_id: 1n,
    side,
    basis_pos_q: side === 0 ? 10_000_000n : -10_000_000n,
    a_basis: BigInt(l.adlOne),
    epoch_snap: 0n,
    loss_weight: 10_000_000n,
    b_epoch_snap: 0n,
    ...leg,
  });
  return f;
}
