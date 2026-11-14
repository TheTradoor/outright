import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import contract from "../upstream-contract.json" with { type: "json" };
import { validateProfile, verifyProgram } from "./client.mjs";
import { readMarket } from "./market.mjs";
import { readPortfolio } from "./accounts.mjs";

const key = (value) => new PublicKey(value);
const c = contract.constants;

function checkedSlot(value, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error("Keeper discovery returned an invalid or stale bank");
  return value;
}

// RPC enumeration is a candidate index, not proof of completeness or payment.
// Re-read full accounts with the pinned program and market before admitting them.
export async function discoverPortfolios(
  connection,
  deployment,
  { maxTargets, minimumSlot = 0 },
) {
  const p = validateProfile(deployment);
  if (!Number.isSafeInteger(maxTargets) || maxTargets < 1 || maxTargets > 256)
    throw new Error("Invalid discovery target limit");
  checkedSlot(minimumSlot, 0);
  if ((await connection.getGenesisHash()) !== p.genesisHash)
    throw new Error("Keeper RPC network changed");

  let slot = minimumSlot;
  const base = [p.program.address, p.program.programData, p.market];
  async function readBatch(addresses) {
    const keys = [...base, ...addresses];
    const result = await connection.getMultipleAccountsInfoAndContext(
      keys.map(key),
      { commitment: "confirmed", minContextSlot: slot },
    );
    slot = checkedSlot(result?.context?.slot, slot);
    if (!Array.isArray(result?.value) || result.value.length !== keys.length)
      throw new Error("Keeper discovery snapshot is incomplete");
    await verifyProgram(result.value[0], result.value[1], p.program);
    readMarket(result.value[2], {
      programId: p.program.address,
      address: p.market,
      collateralMint: p.collateral.mint,
    });
    return result.value.slice(base.length);
  }

  await readBatch([]);
  const header = Buffer.alloc(11);
  header.writeBigUInt64LE(BigInt("0x" + c.magic));
  header.writeUInt16LE(c.version, 8);
  header[10] = c.portfolioKind;
  const scan = await connection.getProgramAccounts(key(p.program.address), {
    commitment: "confirmed",
    minContextSlot: slot,
    withContext: true,
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { dataSize: c.portfolioLength },
      { memcmp: { offset: 0, bytes: bs58.encode(header) } },
      { memcmp: { offset: c.portfolioMarketOffset, bytes: p.market } },
    ],
  });
  slot = checkedSlot(scan?.context?.slot, slot);
  const scanSlot = slot;
  if (!Array.isArray(scan?.value))
    throw new Error("Keeper discovery requires an RPC context and account list");
  if (scan.value.length > maxTargets)
    throw new Error("Keeper discovery target limit exceeded; no partial list was enrolled");
  const addresses = scan.value.map((entry) => {
    if (
      !entry?.account ||
      entry.account.executable !== false ||
      key(entry.account.owner).toBase58() !== p.program.address
    )
      throw new Error("Keeper discovery returned an invalid program account");
    return key(entry.pubkey).toBase58();
  }).sort();
  if (new Set(addresses).size !== addresses.length)
    throw new Error("Keeper discovery returned duplicate addresses");
  const targets = [], ids = new Set();
  // 64 portfolios plus three verification accounts stays below the RPC limit.
  // A final empty read also rechecks deployment identity for an empty scan.
  for (let start = 0; start < Math.max(1, addresses.length); start += 64) {
    const batch = addresses.slice(start, start + 64);
    const accounts = await readBatch(batch);
    for (let i = 0; i < batch.length; i++) {
      if (accounts[i] === null) continue; // Closed since enumeration, not paid.
      const portfolio = readPortfolio(accounts[i], {
        programId: p.program.address,
        address: batch[i],
        market: p.market,
      });
      const portfolioId = portfolio.portfolioId.toString();
      if (ids.has(portfolioId))
        throw new Error("Keeper discovery returned duplicate portfolio identities");
      ids.add(portfolioId);
      targets.push(Object.freeze({
        address: portfolio.address,
        owner: portfolio.owner,
        portfolioId,
      }));
    }
  }
  return Object.freeze({ scanSlot, slot, targets: Object.freeze(targets) });
}
