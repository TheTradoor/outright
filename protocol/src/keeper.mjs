import {
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import contract from "../upstream-contract.json" with { type: "json" };
import {
  validateProfile,
  verifyProgram,
  sha256,
  readTransactionStatus,
  readTokenAccount,
  verifyCollateralMint,
} from "./client.mjs";
import { readMarket } from "./market.mjs";
import { readPortfolio } from "./accounts.mjs";
import { buildInstruction, vaultAuthority } from "./instructions.mjs";
import { getAssociatedTokenAddressSync } from "./token.mjs";

class DeferredTarget extends Error {
  constructor(reason) {
    super(`Keeper target deferred: ${reason}`);
    this.reason = reason;
  }
}

const key = (v) => new PublicKey(v);
const address = (v) => key(v).toBase58();
const blockhash = (value) => {
  if (typeof value !== "string" || address(value) !== value)
    throw new Error("Invalid keeper blockhash");
  return value;
};
const u64 = (v, name) => {
  if (
    typeof v !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(v) ||
    BigInt(v) > (1n << 64n) - 1n
  )
    throw new Error(`Invalid ${name}: use a positive u64 decimal string`);
  return v;
};
const count = (v, min, max, name) => {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw new Error(`Invalid ${name}`);
  return v;
};
const unique = (list, name) => {
  if (new Set(list).size !== list.length) throw new Error(`Duplicate ${name}`);
};

// Each configured identity is public. This configuration contains no signer.
export function validateKeeperConfig(input) {
  if (input?.version !== 1) throw new Error("Unsupported keeper configuration");
  const deployment = validateProfile(input.deployment);
  if (
    input.settleResolved !== undefined &&
    typeof input.settleResolved !== "boolean"
  )
    throw new Error("Invalid settleResolved: use a boolean");
  if (
    !Array.isArray(input.targets) ||
    input.targets.length < 1 ||
    input.targets.length > 256
  )
    throw new Error("Configure between 1 and 256 portfolio targets");
  const targets = input.targets.map((t) =>
    Object.freeze({
      address: address(t.address),
      owner: address(t.owner),
      portfolioId: u64(t.portfolioId, "portfolio ID"),
    }),
  );
  unique(
    targets.map((t) => t.address),
    "portfolio target",
  );
  if (
    !Array.isArray(input.assets) ||
    input.assets.length < 1 ||
    input.assets.length > 16
  )
    throw new Error("Configure between 1 and 16 assets");
  const assets = input.assets.map((a) => {
    const mode = a.oracleMode;
    if (
      mode !== contract.keeper.hybridMode &&
      !(
        mode === contract.keeper.manualMode && deployment.cluster === "localnet"
      )
    )
      throw new Error(
        "Devnet keeper assets require an external hybrid oracle; manual prices are localnet-only",
      );
    if (
      !Array.isArray(a.feeds) ||
      a.feeds.length > 3 ||
      (mode === contract.keeper.hybridMode
        ? !a.feeds.length
        : a.feeds.length !== 0)
    )
      throw new Error("Invalid oracle feed count");
    const feeds = a.feeds.map((f) => {
      const owner = address(f.owner);
      if (!contract.keeper.oracleOwners.includes(owner))
        throw new Error("Unsupported oracle account owner");
      return Object.freeze({
        id: address(f.id),
        account: address(f.account),
        owner,
      });
    });
    return Object.freeze({
      index: count(a.index, 0, 65535, "asset index"),
      marketId: u64(a.marketId, "market ID"),
      oracleMode: mode,
      feeds: Object.freeze(feeds),
    });
  });
  unique(
    assets.map((a) => a.index),
    "asset index",
  );
  return Object.freeze({
    version: 1,
    deployment,
    feePayer: address(input.feePayer),
    targets: Object.freeze(targets),
    assets: Object.freeze(assets),
    intervalMs: count(input.intervalMs, 1000, 60000, "poll interval"),
    maxFeeLamports: u64(input.maxFeeLamports, "transaction fee cap"),
    feeBudgetLamports: u64(input.feeBudgetLamports, "total fee budget"),
    reserveLamports: u64(input.reserveLamports, "SOL reserve"),
    // Omit the default so existing journal configuration hashes stay valid.
    ...(input.settleResolved ? { settleResolved: true } : {}),
  });
}

export function planCrank(config, snapshot, discoveryIndex) {
  const { deployment } = config;
  const { market, portfolio, slot } = snapshot;
  // RPC absence is not proof of settlement. Revisit the pinned target later.
  if (portfolio === null) throw new DeferredTarget("portfolioMissing");
  if (market.mode === "resolved") {
    if (!config.settleResolved)
      throw new Error("Resolved settlement requires settleResolved: true");
    const pin = config.assets.find((a) => a.index === discoveryIndex);
    const asset = market.assets[discoveryIndex];
    if (
      !pin ||
      !asset ||
      discoveryIndex >= market.config.max_market_slots ||
      asset.market_id.toString() !== pin.marketId
    )
      throw new Error(
        "Asset incarnation is missing or changed; review the keeper configuration",
      );
    const delay = market.wrapper.force_close_delay_slots;
    if (delay !== 0n && BigInt(slot) < market.resolved_slot + delay)
      throw new DeferredTarget("ownerDelay");
    if (!snapshot.payoutTokenExists)
      throw new DeferredTarget("payoutAccountMissing");
    if (market.resolvedPayout.payout_halted)
      throw new DeferredTarget("payoutHalted");
    return buildInstruction(
      deployment.program.address,
      "permissionlessCrank",
      {
        nowSlot: BigInt(slot),
        observations: [{ assetIndex: discoveryIndex, oracleAccounts: 0 }],
      },
      {
        owner: portfolio.owner,
        market: deployment.market,
        portfolio: portfolio.address,
        oracleAccounts: [],
        resolvedPayout: {
          userToken: getAssociatedTokenAddressSync(
            key(deployment.collateral.mint),
            key(portfolio.owner),
            true,
          ),
          vault: deployment.vault,
        },
      },
    );
  }
  const indexes = new Set(portfolio.positions.map((p) => p.asset_index));
  indexes.add(discoveryIndex);
  const observations = [],
    oracleAccounts = [];
  if (market.mode === "live")
    for (const index of indexes) {
      const pin = config.assets.find((a) => a.index === index),
        asset = market.assets[index];
      if (!pin || !asset || asset.market_id.toString() !== pin.marketId)
        throw new Error(
          "Asset incarnation is missing or changed; review the keeper configuration",
        );
      for (const leg of portfolio.positions.filter(
        (p) => p.asset_index === index,
      ))
        if (leg.market_id !== asset.market_id)
          throw new Error(
            "Portfolio position has a different market incarnation",
          );
      if (!["active", "drainOnly"].includes(asset.lifecycle)) continue;
      if (
        asset.oracle.oracle_mode !== pin.oracleMode ||
        asset.oracle.oracle_leg_count !== pin.feeds.length ||
        asset.oracleFeeds.some((feed, i) => feed !== pin.feeds[i]?.id)
      )
        throw new Error("On-chain oracle configuration changed");
      observations.push({
        assetIndex: index,
        oracleAccounts: pin.feeds.length,
      });
      oracleAccounts.push(...pin.feeds.map((f) => f.account));
    }
  // Recovery uses committed state only. The program chooses the bounded action.
  return buildInstruction(
    deployment.program.address,
    "permissionlessCrank",
    {
      nowSlot: BigInt(slot),
      observations,
    },
    {
      owner: config.feePayer,
      market: deployment.market,
      portfolio: portfolio.address,
      oracleAccounts,
    },
  );
}

export async function readKeeperSnapshot(
  connection,
  config,
  target,
  minimumSlot = 0,
) {
  const p = config.deployment;
  if ((await connection.getGenesisHash()) !== p.genesisHash)
    throw new Error("Keeper RPC network changed");
  const feeds = config.assets.flatMap((a) => a.feeds);
  const payoutToken = getAssociatedTokenAddressSync(
    key(p.collateral.mint),
    key(target.owner),
    true,
  ).toBase58();
  const addresses = [
    ...new Set([
      p.program.address,
      p.program.programData,
      p.market,
      config.feePayer,
      target.address,
      ...feeds.map((f) => f.account),
      ...(config.settleResolved
        ? [p.collateral.mint, p.vault, payoutToken]
        : []),
    ]),
  ];
  const result = await connection.getMultipleAccountsInfoAndContext(
    addresses.map(key),
    {
      commitment: "confirmed",
      minContextSlot: minimumSlot,
    },
  );
  const slot = count(
    result.context.slot,
    minimumSlot,
    Number.MAX_SAFE_INTEGER,
    "snapshot slot",
  );
  if (!Array.isArray(result.value) || result.value.length !== addresses.length)
    throw new Error("Incomplete keeper snapshot");
  const accounts = new Map(addresses.map((a, i) => [a, result.value[i]]));
  await verifyProgram(
    accounts.get(p.program.address),
    accounts.get(p.program.programData),
    p.program,
  );
  const market = readMarket(accounts.get(p.market), {
    programId: p.program.address,
    address: p.market,
    collateralMint: p.collateral.mint,
  });
  const portfolioAccount = accounts.get(target.address);
  // Only an explicit RPC null denotes absence. Empty or malformed accounts
  // still go through the strict reader, including at a previously missing key.
  const portfolio =
    portfolioAccount === null
      ? null
      : readPortfolio(portfolioAccount, {
          programId: p.program.address,
          address: target.address,
          market: p.market,
          owner: target.owner,
        });
  if (portfolio && portfolio.portfolioId.toString() !== target.portfolioId)
    throw new Error("Portfolio incarnation changed");
  const payer = accounts.get(config.feePayer);
  if (
    !payer ||
    payer.executable ||
    address(payer.owner) !== SystemProgram.programId.toBase58() ||
    payer.data.length
  )
    throw new Error("Keeper fee payer must be an existing system wallet");
  count(payer.lamports, 0, Number.MAX_SAFE_INTEGER, "fee-payer balance");
  if (market.mode === "live")
    for (const f of feeds) {
      const account = accounts.get(f.account);
      if (
        !account ||
        account.executable ||
        address(account.owner) !== f.owner ||
        !account.data.length
      )
        throw new Error("Oracle account is missing or has a different owner");
    }
  let payoutTokenExists = false;
  if (market.mode === "resolved" && config.settleResolved) {
    verifyCollateralMint(accounts.get(p.collateral.mint), p.collateral);
    const vault = readTokenAccount(
      accounts.get(p.vault),
      p.vault,
      p.collateral.mint,
      vaultAuthority(p.program.address, p.market),
      true,
    );
    if (vault.amount < market.vault)
      throw new Error("Keeper vault balance is below recorded custody");
    if (accounts.get(payoutToken)) {
      readTokenAccount(
        accounts.get(payoutToken),
        payoutToken,
        p.collateral.mint,
        target.owner,
        true,
      );
      payoutTokenExists = true;
    }
  }
  return {
    slot,
    market,
    portfolio,
    walletLamports: payer.lamports,
    payoutTokenExists,
  };
}

export function emptyKeeperState(configHash) {
  return {
    version: 1,
    configHash,
    reservedFees: "0",
    attempts: 0,
    cursor: 0,
    minimumSlot: 0,
    pending: null,
    lastResult: null,
    lastSubmittedBlockhash: null,
  };
}

function validateState(state, configHash) {
  if (
    !state ||
    state.version !== 1 ||
    state.configHash !== configHash ||
    typeof state.reservedFees !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(state.reservedFees)
  )
    throw new Error("Keeper journal does not match the configuration");
  for (const k of ["attempts", "cursor", "minimumSlot"])
    count(state[k], 0, Number.MAX_SAFE_INTEGER, k);
  if (state.lastSubmittedBlockhash != null)
    blockhash(state.lastSubmittedBlockhash);
  if (
    state.pending &&
    (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(state.pending.signature) ||
      !Number.isSafeInteger(state.pending.lastValidBlockHeight) ||
      state.pending.lastValidBlockHeight < 0 ||
      ![
        "signed",
        "submitted",
        "unknown",
        "pending",
        "expiredUnresolved",
      ].includes(state.pending.status))
  )
    throw new Error("Invalid pending keeper receipt");
}

// journal.exclusive covers the full RPC/read/sign/write cycle. Node storage also
// takes a process-wide lock so two workers cannot sign for one journal.
export class OutrightKeeper {
  constructor(input, { connection, journal, signer = null }) {
    this.config = validateKeeperConfig(input);
    this.connection = connection;
    this.journal = journal;
    this.signer = signer;
    if (signer && address(signer.publicKey) !== this.config.feePayer)
      throw new Error("Keeper signer does not match fee payer");
  }
  async tick({ send = false } = {}) {
    return this.journal.exclusive(async () => {
      const configHash = await sha256(
        new TextEncoder().encode(JSON.stringify(this.config)),
      );
      const state = (await this.journal.read()) ?? emptyKeeperState(configHash);
      validateState(state, configHash);
      // Preserve the last submitted blockhash when reading an older v1 journal,
      // before a deferred or simulation result can replace lastResult.
      const previousBlockhash =
        state.pending?.blockhash ?? state.lastResult?.blockhash;
      if (!state.lastSubmittedBlockhash && previousBlockhash != null)
        state.lastSubmittedBlockhash = blockhash(previousBlockhash);
      const { config: c, connection: rpc } = this;
      if ((await rpc.getGenesisHash()) !== c.deployment.genesisHash)
        throw new Error("Keeper RPC network changed");
      if (state.pending) {
        const receipt = state.pending;
        const response = await rpc.getSignatureStatuses([receipt.signature], {
          searchTransactionHistory: true,
        });
        const status = readTransactionStatus(response, state.minimumSlot);
        if (
          status &&
          ["confirmed", "finalized"].includes(status.confirmationStatus)
        ) {
          receipt.status =
            status.err === null ? status.confirmationStatus : "failed";
          receipt.error = status.err;
          receipt.confirmedSlot = status.slot;
          state.lastResult = receipt;
          state.pending = null;
        } else if (
          count(
            await rpc.getBlockHeight("finalized"),
            0,
            Number.MAX_SAFE_INTEGER,
            "block height",
          ) > receipt.lastValidBlockHeight
        )
          receipt.status = "expiredUnresolved";
        else receipt.status = "pending";
        state.minimumSlot = response.context.slot;
        await this.journal.write(state);
        return {
          status: receipt.status,
          signature: receipt.signature,
          error: receipt.error ?? null,
        };
      }
      const target = c.targets[state.cursor % c.targets.length];
      const asset =
        c.assets[Math.floor(state.cursor / c.targets.length) % c.assets.length];
      const deferTarget = async (reason, slot) => {
        state.cursor =
          (state.cursor + 1) % (c.targets.length * c.assets.length);
        state.minimumSlot = slot;
        state.lastResult = {
          status: "deferred",
          reason,
          target: target.address,
          discoveryAsset: asset.index,
        };
        await this.journal.write(state);
        return state.lastResult;
      };
      const snapshot = await readKeeperSnapshot(
        rpc,
        c,
        target,
        state.minimumSlot,
      );
      let instruction;
      try {
        instruction = planCrank(c, snapshot, asset.index);
      } catch (error) {
        if (!(error instanceof DeferredTarget)) throw error;
        return deferTarget(error.reason, snapshot.slot);
      }
      const recent = await rpc.getLatestBlockhashAndContext({
        commitment: "confirmed",
        minContextSlot: snapshot.slot,
      });
      count(
        recent.context.slot,
        snapshot.slot,
        Number.MAX_SAFE_INTEGER,
        "blockhash slot",
      );
      count(
        recent.value.lastValidBlockHeight,
        0,
        Number.MAX_SAFE_INTEGER,
        "blockhash height",
      );
      const lastBlockhash = state.lastSubmittedBlockhash;
      if (send && lastBlockhash === recent.value.blockhash) {
        state.minimumSlot = recent.context.slot;
        state.lastResult = {
          status: "waitingForBlockhash",
          target: target.address,
        };
        await this.journal.write(state);
        return state.lastResult;
      }
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: key(c.feePayer),
          recentBlockhash: recent.value.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
            ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
            instruction,
          ],
        }).compileToV0Message(),
      );
      if (tx.serialize().length > 1232)
        throw new Error("Crank exceeds the transaction packet limit");
      const simulated = await rpc.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: "confirmed",
        minContextSlot: recent.context.slot,
      });
      count(
        simulated.context.slot,
        recent.context.slot,
        Number.MAX_SAFE_INTEGER,
        "simulation slot",
      );
      if (simulated.value.err) {
        const err = simulated.value.err;
        const noProgress =
          JSON.stringify(err) ===
          JSON.stringify({
            InstructionError: [2, { Custom: contract.keeper.nonProgressError }],
          });
        // Failure on one target must not starve every other target. No signature
        // or fee is created. The next poll revisits the bounded target list.
        state.cursor =
          (state.cursor + 1) % (c.targets.length * c.assets.length);
        state.minimumSlot = simulated.context.slot;
        state.lastResult = {
          status: noProgress ? "idle" : "simulationRejected",
          target: target.address,
          error: err,
        };
        await this.journal.write(state);
        return state.lastResult;
      }
      const fee = await rpc.getFeeForMessage(tx.message, "confirmed");
      count(
        fee.context.slot,
        simulated.context.slot,
        Number.MAX_SAFE_INTEGER,
        "fee estimate slot",
      );
      count(fee.value, 0, Number.MAX_SAFE_INTEGER, "network fee");
      if (
        BigInt(fee.value) > BigInt(c.maxFeeLamports) ||
        BigInt(state.reservedFees) + BigInt(fee.value) >
          BigInt(c.feeBudgetLamports)
      )
        throw new Error("Keeper fee budget exceeded");
      if (
        BigInt(snapshot.walletLamports) <
        BigInt(fee.value) + BigInt(c.reserveLamports)
      )
        throw new Error("Keeper SOL reserve would be breached");
      const result = {
        status: "simulated",
        target: target.address,
        portfolioId: target.portfolioId,
        discoveryAsset: asset.index,
        slot: simulated.context.slot,
        feeLamports: fee.value,
        computeUnits: simulated.value.unitsConsumed ?? null,
      };
      if (!send) {
        state.cursor =
          (state.cursor + 1) % (c.targets.length * c.assets.length);
        state.minimumSlot = fee.context.slot;
        state.lastResult = result;
        await this.journal.write(state);
        return result;
      }
      if (!this.signer)
        throw new Error("Sending requires the configured fee-payer signer");
      // Recheck deployment and account bindings after simulation. The on-chain
      // program remains authoritative when state changes before execution.
      const fresh = await readKeeperSnapshot(rpc, c, target, fee.context.slot);
      if (fresh.portfolio === null)
        return deferTarget("portfolioMissing", fresh.slot);
      const freshInstruction = planCrank(c, fresh, asset.index);
      if (fresh.market.mode !== snapshot.market.mode)
        throw new Error("Market mode changed after simulation");
      if (
        snapshot.market.mode === "resolved" &&
        (fresh.market.wrapper.maintenance_fee_per_slot !==
          snapshot.market.wrapper.maintenance_fee_per_slot ||
          fresh.market.wrapper.force_close_delay_slots !==
            snapshot.market.wrapper.force_close_delay_slots ||
          fresh.market.resolved_slot !== snapshot.market.resolved_slot)
      )
        throw new Error("Market settlement policy changed after simulation");
      if (
        !freshInstruction.data
          .subarray(9)
          .equals(instruction.data.subarray(9)) ||
        freshInstruction.keys.length !== instruction.keys.length ||
        freshInstruction.keys.some(
          (k, i) =>
            !k.pubkey.equals(instruction.keys[i].pubkey) ||
            k.isSigner !== instruction.keys[i].isSigner ||
            k.isWritable !== instruction.keys[i].isWritable,
        )
      )
        throw new Error("Crank account selection changed after simulation");
      if (
        count(
          await rpc.getBlockHeight("confirmed"),
          0,
          Number.MAX_SAFE_INTEGER,
          "block height",
        ) > recent.value.lastValidBlockHeight
      )
        throw new Error("Crank blockhash expired");
      if (
        BigInt(fresh.walletLamports) <
        BigInt(fee.value) + BigInt(c.reserveLamports)
      )
        throw new Error("Keeper SOL reserve would be breached");
      tx.sign([this.signer]);
      const record = {
        ...result,
        status: "signed",
        signature: bs58.encode(tx.signatures[0]),
        blockhash: recent.value.blockhash,
        lastValidBlockHeight: recent.value.lastValidBlockHeight,
        messageHash: await sha256(tx.message.serialize()),
        createdAt: new Date().toISOString(),
      };
      state.pending = record;
      state.lastSubmittedBlockhash = recent.value.blockhash;
      state.reservedFees = (
        BigInt(state.reservedFees) + BigInt(fee.value)
      ).toString();
      state.attempts += 1;
      state.cursor = (state.cursor + 1) % (c.targets.length * c.assets.length);
      state.minimumSlot = fresh.slot;
      await this.journal.write(state); // Must complete durably before broadcast.
      try {
        const signature = await rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          minContextSlot: state.minimumSlot,
          maxRetries: 0,
        });
        record.status =
          signature === record.signature ? "submitted" : "unknown";
      } catch {
        record.status = "unknown";
      }
      await this.journal.write(state);
      return { ...record };
    });
  }
}
