import {
  Connection,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  unpackAccount,
  unpackMint,
} from "./token.mjs";
import {
  isSettlementAction,
  recordedSettlementPayout,
  canReviewPortfolioClosure,
} from "./settlement.mjs";
import { isRecoveryAction, recoveryPosition } from "./recovery.mjs";
import bs58 from "bs58";
import {
  buildInstruction,
  parseUnits,
  vaultAuthority,
  matcherDelegate,
  TOKEN_PROGRAM_ID,
  ENGINE_COMMIT,
  WRAPPER_COMMIT,
} from "./instructions.mjs";
import { readPortfolio } from "./accounts.mjs";
import { readMarket, positionForMarket } from "./market.mjs";
import { constants, keyString } from "./layout.mjs";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const FINAL_STATES = new Set(["confirmed", "finalized", "failed"]);
const key = (value) => new PublicKey(value);
const same = (a, b) => keyString(a) === keyString(b);
const nullableKey = (value) => (value === null ? null : keyString(value));
const equalBytes = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const accountingAction = (type) =>
  type === "closePortfolio" ||
  isSettlementAction(type) ||
  isRecoveryAction(type);
const continuationName = (type) =>
  type === "closePortfolio"
    ? "account closure"
    : isRecoveryAction(type)
      ? "recovery"
      : isSettlementAction(type)
        ? "settlement"
        : {
            initialize: "portfolio creation",
            deposit: "deposit",
            withdraw: "withdrawal",
            trade: "trade",
          }[type];
const equalInstructions = (a, b) =>
  a.length === b.length &&
  a.every(
    (ix, i) =>
      ix.programId.equals(b[i].programId) &&
      equalBytes(ix.data, b[i].data) &&
      ix.keys.length === b[i].keys.length &&
      ix.keys.every(
        (meta, j) =>
          meta.pubkey.equals(b[i].keys[j].pubkey) &&
          meta.isSigner === b[i].keys[j].isSigner &&
          meta.isWritable === b[i].keys[j].isWritable,
      ),
  );
export async function sha256(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function boundedNumber(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

// getSignatureStatuses has no minContextSlot option. Check its response bank
// before allowing either client to release a durable pending receipt.
export function readTransactionStatus(response, minimumSlot) {
  const slot = boundedNumber(
    response?.context?.slot,
    minimumSlot,
    Number.MAX_SAFE_INTEGER,
    "confirmation response slot",
  );
  if (!Array.isArray(response.value) || response.value.length !== 1)
    throw new Error("Invalid signature status response");
  const status = response.value[0];
  if (status === null) return null;
  if (
    !status ||
    !["processed", "confirmed", "finalized"].includes(
      status.confirmationStatus,
    ) ||
    !(
      status.err === null ||
      typeof status.err === "string" ||
      (typeof status.err === "object" && !Array.isArray(status.err))
    )
  )
    throw new Error("Invalid transaction status");
  boundedNumber(status.slot, 0, slot, "confirmation slot");
  return status;
}
function programPin(value) {
  if (!value || !/^[0-9a-f]{64}$/.test(value.sha256))
    throw new Error("A deployed program SHA-256 pin is required");
  return Object.freeze({
    address: keyString(value.address),
    programData: keyString(value.programData),
    sha256: value.sha256,
    upgradeAuthority: nullableKey(value.upgradeAuthority),
  });
}
export function validateProfile(input) {
  if (
    !input ||
    input.version !== 1 ||
    input.engineCommit !== ENGINE_COMMIT ||
    input.wrapperCommit !== WRAPPER_COMMIT
  )
    throw new Error("Deployment profile does not match this client release");
  if (!["localnet", "devnet"].includes(input.cluster))
    throw new Error("This release supports localnet and devnet deployments");
  const url = new URL(input.rpcUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (input.cluster === "localnet" && !loopback)
    throw new Error("Localnet profiles require a loopback RPC endpoint");
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (input.cluster === "localnet" && loopback && url.protocol === "http:")
    )
  )
    throw new Error(
      "Use HTTPS or a local validator RPC URL without embedded credentials",
    );
  if (
    typeof input.genesisHash !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{20,44}$/.test(input.genesisHash) ||
    (input.cluster === "devnet" && input.genesisHash !== DEVNET_GENESIS)
  )
    throw new Error("Invalid network genesis hash");
  const program = programPin(input.program),
    market = keyString(input.market);
  const collateral = Object.freeze({
    mint: keyString(input.collateral?.mint),
    decimals: boundedNumber(
      input.collateral?.decimals,
      6,
      6,
      "collateral decimals",
    ),
    symbol: String(input.collateral?.symbol || "").slice(0, 16),
    mintAuthority: nullableKey(input.collateral?.mintAuthority),
    freezeAuthority: nullableKey(input.collateral?.freezeAuthority),
  });
  if (!/^[A-Za-z0-9._-]{1,16}$/.test(collateral.symbol))
    throw new Error("Invalid collateral symbol");
  const vault = getAssociatedTokenAddressSync(
    key(collateral.mint),
    vaultAuthority(program.address, market),
    true,
  );
  if (!same(vault, input.vault))
    throw new Error(
      "Vault must be the collateral ATA of the market vault authority",
    );
  let maker = null;
  if (input.maker)
    maker = Object.freeze({
      portfolio: keyString(input.maker.portfolio),
      owner: keyString(input.maker.owner),
      context: keyString(input.maker.context),
      program: programPin(input.maker.program),
      feeBps: boundedNumber(input.maker.feeBps, 0, 10000, "trade fee"),
      backingFeeCapBps: boundedNumber(
        input.maker.backingFeeCapBps,
        0,
        10000,
        "backing fee cap",
      ),
    });
  const assets = (input.assets || []).map((a) => {
    if (
      !/^[A-Za-z0-9./_-]{1,24}$/.test(a.symbol) ||
      !/^[1-9][0-9]{0,19}$/.test(a.marketId)
    )
      throw new Error("Invalid market display metadata");
    return Object.freeze({
      index: boundedNumber(a.index, 0, 65535, "asset index"),
      marketId: a.marketId,
      symbol: a.symbol,
    });
  });
  if (new Set(assets.map((a) => a.index)).size !== assets.length)
    throw new Error("Duplicate asset metadata");
  return Object.freeze({
    version: 1,
    cluster: input.cluster,
    rpcUrl: url.href,
    genesisHash: input.genesisHash,
    engineCommit: ENGINE_COMMIT,
    wrapperCommit: WRAPPER_COMMIT,
    program,
    market,
    collateral,
    vault: vault.toBase58(),
    maker,
    assets: Object.freeze(assets),
    maxOracleAgeSlots: boundedNumber(
      input.maxOracleAgeSlots,
      1,
      10000,
      "oracle age limit",
    ),
  });
}

export async function portfolioAddress(owner, market, programId) {
  // Owner is the system-account base. Every market gets its own 128-bit seed.
  const seed = (await sha256(key(market).toBytes())).slice(0, 32);
  return {
    seed,
    address: await PublicKey.createWithSeed(key(owner), seed, key(programId)),
  };
}

export async function verifyProgram(program, data, pin) {
  if (
    !program?.executable ||
    !same(program.owner, LOADER) ||
    program.data.length !== 36 ||
    Buffer.from(program.data).readUInt32LE(0) !== 2 ||
    !same(program.data.subarray(4, 36), pin.programData)
  )
    throw new Error("Program account does not match the deployment pin");
  const b = data && Buffer.from(data.data);
  if (
    !data ||
    data.executable ||
    !same(data.owner, LOADER) ||
    b.length <= 45 ||
    b.readUInt32LE(0) !== 3 ||
    b[12] > 1
  )
    throw new Error("Unsupported deployed program data");
  const authority = b[12] === 1 ? keyString(b.subarray(13, 45)) : null;
  if (
    authority !== pin.upgradeAuthority ||
    (await sha256(b.subarray(45))) !== pin.sha256
  )
    throw new Error(
      "Deployed code or upgrade authority changed; stop and review the deployment",
    );
}

export function readTokenAccount(
  info,
  address,
  mint,
  owner,
  unencumbered = false,
) {
  if (
    !info ||
    info.executable ||
    info.data.length !== 165 ||
    !same(info.owner, TOKEN_PROGRAM_ID)
  )
    throw new Error("Missing or unsupported token account");
  const a = unpackAccount(key(address), info, TOKEN_PROGRAM_ID);
  if (
    !a.isInitialized ||
    a.isFrozen ||
    !same(a.mint, mint) ||
    !same(a.owner, owner) ||
    a.isNative ||
    (unencumbered && (a.delegate || a.closeAuthority))
  )
    throw new Error("Token account authority, mint, or state mismatch");
  return a;
}

export function verifyCollateralMint(info, collateral) {
  const mint = unpackMint(key(collateral.mint), info, TOKEN_PROGRAM_ID);
  if (
    !mint.isInitialized ||
    mint.decimals !== collateral.decimals ||
    (mint.mintAuthority?.toBase58() ?? null) !== collateral.mintAuthority ||
    (mint.freezeAuthority?.toBase58() ?? null) !== collateral.freezeAuthority
  )
    throw new Error("Collateral mint configuration changed");
  return mint;
}

// Anyone can transfer SOL to the deterministic address before its owner opens
// a portfolio. Only an empty System account can be allocated with the owner's
// seed; every other occupied address must pass the strict portfolio reader.
export function readPortfolioAllocation(account, expected) {
  if (
    account &&
    !account.executable &&
    same(account.owner, SystemProgram.programId) &&
    account.data.length === 0
  )
    return {
      portfolio: null,
      uninitializedPortfolioLamports: boundedNumber(
        account.lamports,
        0,
        Number.MAX_SAFE_INTEGER,
        "uninitialized portfolio balance",
      ),
    };
  return {
    portfolio: account ? readPortfolio(account, expected) : null,
    uninitializedPortfolioLamports: null,
  };
}

export async function readSnapshot(
  connection,
  profile,
  owner,
  minimumSlot = 0,
) {
  if ((await connection.getGenesisHash()) !== profile.genesisHash)
    throw new Error("RPC network does not match the deployment profile");
  const identity = await portfolioAddress(
    owner,
    profile.market,
    profile.program.address,
  );
  const userToken = getAssociatedTokenAddressSync(
    key(profile.collateral.mint),
    key(owner),
  );
  const addresses = [
    profile.program.address,
    profile.program.programData,
    profile.market,
    profile.collateral.mint,
    profile.vault,
    keyString(owner),
    identity.address,
    userToken,
  ];
  if (profile.maker)
    addresses.push(
      profile.maker.portfolio,
      profile.maker.program.address,
      profile.maker.program.programData,
      profile.maker.context,
    );
  const response = await connection.getMultipleAccountsInfoAndContext(
    addresses.map(key),
    { commitment: "confirmed", minContextSlot: minimumSlot },
  );
  if (
    !Number.isSafeInteger(response.context.slot) ||
    response.context.slot < minimumSlot ||
    response.value.length !== addresses.length
  )
    throw new Error("RPC returned an incomplete or older snapshot");
  const [
    program,
    programData,
    marketInfo,
    mintInfo,
    vaultInfo,
    walletInfo,
    portfolioInfo,
    userTokenInfo,
    makerInfo,
    matcherProgram,
    matcherData,
    matcherContext,
  ] = response.value;
  await verifyProgram(program, programData, profile.program);
  const market = readMarket(marketInfo, {
    programId: profile.program.address,
    address: profile.market,
    collateralMint: profile.collateral.mint,
  });
  if (
    !mintInfo ||
    mintInfo.executable ||
    mintInfo.data.length !== 82 ||
    !same(mintInfo.owner, TOKEN_PROGRAM_ID)
  )
    throw new Error("Unsupported collateral mint");
  verifyCollateralMint(mintInfo, profile.collateral);
  const vault = readTokenAccount(
    vaultInfo,
    profile.vault,
    profile.collateral.mint,
    vaultAuthority(profile.program.address, profile.market),
    true,
  );
  if (vault.amount < market.vault)
    throw new Error("Vault token balance is below recorded custody");
  const user = userTokenInfo
    ? readTokenAccount(userTokenInfo, userToken, profile.collateral.mint, owner)
    : null;
  if (
    walletInfo &&
    (walletInfo.executable ||
      !same(walletInfo.owner, SystemProgram.programId) ||
      walletInfo.data.length !== 0)
  )
    throw new Error("The fee payer must be a system wallet");
  const { portfolio, uninitializedPortfolioLamports } = readPortfolioAllocation(
    portfolioInfo,
    {
      programId: profile.program.address,
      address: identity.address,
      market: profile.market,
      owner,
    },
  );
  const positions = portfolio
    ? portfolio.positions.map((leg) => positionForMarket(leg, market))
    : [];
  let maker = null,
    makerError = null;
  if (profile.maker) {
    try {
      await verifyProgram(matcherProgram, matcherData, profile.maker.program);
      maker = readPortfolio(makerInfo, {
        programId: profile.program.address,
        address: profile.maker.portfolio,
        market: profile.market,
        owner: profile.maker.owner,
      });
      const delegate = matcherDelegate(profile.program.address, {
        market: profile.market,
        makerPortfolio: profile.maker.portfolio,
        makerOwner: profile.maker.owner,
        matcherProgram: profile.maker.program.address,
        matcherContext: profile.maker.context,
      });
      if (
        !matcherContext ||
        matcherContext.executable ||
        !same(matcherContext.owner, profile.maker.program.address) ||
        matcherContext.data.length < 64 ||
        maker.matcher.matcher_program !== profile.maker.program.address ||
        maker.matcher.matcher_context !== profile.maker.context ||
        !same(maker.matcher.matcher_delegate, delegate)
      )
        throw new Error("Maker matcher binding changed");
    } catch (error) {
      maker = null;
      makerError = error.message;
    }
  }
  for (const display of profile.assets)
    if (market.assets[display.index]?.market_id.toString() !== display.marketId)
      throw new Error("Asset name refers to a different market incarnation");
  return Object.freeze({
    slot: response.context.slot,
    loadedAt: Date.now(),
    owner: keyString(owner),
    market,
    portfolio,
    uninitializedPortfolioLamports,
    portfolioAddress: identity.address.toBase58(),
    seed: identity.seed,
    positions: Object.freeze(positions),
    maker,
    makerError,
    userToken: userToken.toBase58(),
    tokenBalance: user?.amount ?? 0n,
    tokenAccountExists: Boolean(user),
    walletLamports: boundedNumber(
      walletInfo?.lamports ?? 0,
      0,
      Number.MAX_SAFE_INTEGER,
      "wallet lamports",
    ),
    vaultBalance: vault.amount,
    recordedSettlementPayout: recordedSettlementPayout(market, portfolio),
    // Recovery, settlement and closure consume accounting outside the UI projection.
    // Bind review to the complete data, including K/F checkpoints, source
    // backing and close-progress records. Neither display fields nor unchanged
    // instruction bytes establish that the reviewed accounting is still current.
    accountingStateHash: portfolio
      ? await sha256(
          Buffer.concat([
            Buffer.from(marketInfo.data),
            Buffer.from(portfolioInfo.data),
          ]),
        )
      : null,
  });
}

export function isTradeOracleFresh(profile, snapshot, asset) {
  const slot = BigInt(snapshot.slot),
    oracleSlot = asset.oracle.last_good_oracle_slot;
  return (
    Boolean(asset.effective_price) &&
    oracleSlot <= slot &&
    slot - oracleSlot <= BigInt(profile.maxOracleAgeSlots)
  );
}

export function planAction(profile, snapshot, action, rentLamports = 0) {
  const settlement = isSettlementAction(action.type);
  const recovery = isRecoveryAction(action.type);
  const closeAccount = action.type === "closePortfolio";
  if (
    settlement || closeAccount
      ? snapshot.market.mode !== "resolved"
      : recovery
        ? !["live", "recovery"].includes(snapshot.market.mode)
        : snapshot.market.mode !== "live"
  )
    throw new Error(
      settlement || closeAccount
        ? "Settlement requires a resolved market"
        : recovery
          ? "Recovery exit requires a live or recovery market"
          : "This action requires a live market",
    );
  const common = {
    owner: snapshot.owner,
    market: profile.market,
    portfolio: snapshot.portfolioAddress,
    userToken: snapshot.userToken,
    vault: profile.vault,
  };
  const instructions = [];
  let summary,
    rent = 0;
  if (action.type === "initialize") {
    if (snapshot.portfolio) throw new Error("Portfolio already exists");
    boundedNumber(rentLamports, 1, Number.MAX_SAFE_INTEGER, "portfolio rent");
    const prefunded = snapshot.uninitializedPortfolioLamports;
    if (prefunded !== null && prefunded !== undefined) {
      boundedNumber(
        prefunded,
        0,
        Number.MAX_SAFE_INTEGER,
        "uninitialized portfolio balance",
      );
      rent = Math.max(0, rentLamports - prefunded);
      if (rent)
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: key(snapshot.owner),
            toPubkey: key(snapshot.portfolioAddress),
            lamports: rent,
          }),
        );
      const allocation = {
        accountPubkey: key(snapshot.portfolioAddress),
        basePubkey: key(snapshot.owner),
        seed: snapshot.seed,
        programId: key(profile.program.address),
      };
      // AllocateWithSeed also assigns the requested program owner atomically.
      instructions.push(
        SystemProgram.allocate({
          ...allocation,
          space: constants.portfolioLength,
        }),
      );
    } else {
      rent = rentLamports;
      instructions.push(
        SystemProgram.createAccountWithSeed({
          fromPubkey: key(snapshot.owner),
          basePubkey: key(snapshot.owner),
          newAccountPubkey: key(snapshot.portfolioAddress),
          seed: snapshot.seed,
          lamports: rent,
          space: constants.portfolioLength,
          programId: key(profile.program.address),
        }),
      );
    }
    instructions.push(
      buildInstruction(profile.program.address, "initPortfolio", {}, common),
    );
    summary = "Create a portfolio";
  } else {
    const p = snapshot.portfolio;
    if (!p) throw new Error("Create a portfolio first");
    if (closeAccount) {
      if (!canReviewPortfolioClosure(snapshot))
        throw new Error(
          "Portfolio still has recorded balances, claims or obligations; continue settlement first",
        );
      instructions.push(
        buildInstruction(
          profile.program.address,
          "closePortfolio",
          {
            portfolioId: p.portfolioId,
            expectedSequence: p.expectedSequence,
            positionEpoch: p.positionEpoch,
          },
          common,
        ),
      );
      summary = "Close portfolio account; all account SOL goes to the market";
    } else if (recovery) {
      if (action.acceptForfeiture !== true)
        throw new Error(
          "Acknowledge the forfeiture before reviewing a recovery exit",
        );
      const position = recoveryPosition(snapshot, action.assetIndex);
      if (!position)
        throw new Error(
          "The selected position is not eligible for recovery exit",
        );
      if (action.marketId !== position.market_id.toString())
        throw new Error(
          "Recovery asset incarnation changed; select the position again",
        );
      const budget = parseUnits(action.budget, profile.collateral.decimals);
      instructions.push(
        buildInstruction(
          profile.program.address,
          action.type,
          {
            portfolioId: p.portfolioId,
            positionEpoch: p.positionEpoch,
            assetIndex: action.assetIndex,
            bDeltaBudget: budget,
          },
          common,
        ),
      );
      summary = "Forfeit unbooked gains and advance recovery exit";
    } else if (["deposit", "withdraw"].includes(action.type) || settlement) {
      const amount = settlement
        ? null
        : parseUnits(action.amount, profile.collateral.decimals);
      if (
        action.type === "claimResolvedPayoutTopup" &&
        recordedSettlementPayout(snapshot.market, p) === 0n
      )
        throw new Error(
          "No additional settlement payout is recorded; refresh after market progress",
        );
      if (
        action.type === "deposit" &&
        (!snapshot.tokenAccountExists || snapshot.tokenBalance < amount)
      )
        throw new Error("Insufficient wallet collateral");
      if (
        (action.type === "withdraw" || settlement) &&
        !snapshot.tokenAccountExists
      ) {
        boundedNumber(
          rentLamports,
          1,
          Number.MAX_SAFE_INTEGER,
          "token account rent",
        );
        rent = rentLamports;
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            key(snapshot.owner),
            key(snapshot.userToken),
            key(snapshot.owner),
            key(profile.collateral.mint),
          ),
        );
      }
      instructions.push(
        buildInstruction(
          profile.program.address,
          action.type,
          settlement
            ? {}
            : {
                portfolioId: p.portfolioId,
                expectedSequence: p.expectedSequence,
                amount,
              },
          common,
        ),
      );
      summary = settlement
        ? action.type === "closeResolved"
          ? "Advance resolved-market settlement"
          : "Claim recorded settlement payout"
        : `${action.type === "deposit" ? "Deposit" : "Withdraw"} ${action.amount} ${profile.collateral.symbol}`;
    } else if (action.type === "trade") {
      const maker = snapshot.maker,
        configured = profile.maker;
      if (
        !maker ||
        !configured ||
        !maker.matcherEnabled ||
        maker.matcherExpirySlot <= BigInt(snapshot.slot)
      )
        throw new Error("No active maker authorization");
      const baseFee = snapshot.market.wrapper.trade_fee_base_bps;
      if (
        baseFee > BigInt(maker.matcherFeeCapBps) ||
        baseFee > BigInt(configured.feeBps) ||
        BigInt(configured.feeBps) > snapshot.market.config.max_trading_fee_bps
      )
        throw new Error("Trade fee exceeds the on-chain consent");
      const asset = snapshot.market.assets[action.assetIndex];
      if (
        !asset ||
        asset.lifecycle !== "active" ||
        !["buy", "sell"].includes(action.side)
      )
        throw new Error("Select an active asset and a trade side");
      if (!isTradeOracleFresh(profile, snapshot, asset))
        throw new Error("Oracle is stale; wait for the keeper before trading");
      const size = parseUnits(action.size, 6),
        limit = parseUnits(action.limitPrice, 6);
      if (size > 100_000_000_000_000n)
        throw new Error("Trade size exceeds the engine limit");
      instructions.push(
        buildInstruction(
          profile.program.address,
          "tradeCpi",
          {
            takerPortfolioId: p.portfolioId,
            takerPositionEpoch: p.positionEpoch,
            makerPortfolioId: maker.portfolioId,
            makerPositionEpoch: maker.positionEpoch,
            makerMatcherSequence: maker.expectedSequence,
            assetIndex: action.assetIndex,
            marketId: asset.market_id,
            sizeQ: action.side === "buy" ? size : -size,
            feeBps: BigInt(configured.feeBps),
            limitPrice: limit,
            backingFeeCapBps: configured.backingFeeCapBps,
          },
          {
            takerOwner: snapshot.owner,
            market: profile.market,
            takerPortfolio: snapshot.portfolioAddress,
            makerPortfolio: configured.portfolio,
            makerOwner: configured.owner,
            matcherProgram: configured.program.address,
            matcherContext: configured.context,
          },
        ),
      );
      const symbol =
        profile.assets.find((a) => a.index === action.assetIndex)?.symbol ||
        `Asset ${action.assetIndex}`;
      summary = `${action.side === "buy" ? "Buy" : "Sell"} up to ${action.size} ${symbol}, ${action.side === "buy" ? "maximum" : "minimum"} price ${action.limitPrice}`;
    } else throw new Error("Unsupported wallet action");
  }
  return { instructions, summary, rentLamports: rent };
}

export class OutrightClient {
  #prepared = new WeakMap();
  #revision = 0;
  #busy = false;
  #minimumSlot = 0;
  constructor(profile, { connection, journal } = {}) {
    this.profile = validateProfile(profile);
    this.connection =
      connection ||
      new Connection(this.profile.rpcUrl, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
      });
    if (
      !journal ||
      typeof journal.read !== "function" ||
      typeof journal.write !== "function" ||
      typeof journal.withLock !== "function"
    )
      throw new Error("A persistent transaction journal is required");
    this.journal = journal;
  }
  scope(owner) {
    return `${this.profile.genesisHash}:${this.profile.program.address}:${this.profile.market}:${keyString(owner)}`;
  }
  async snapshot(owner) {
    // Final receipts still constrain later reads, including after a reload or
    // a confirmation observed by another tab. Old receipts may only have a
    // landing slot, so retain that bound as well.
    await this.receipt(owner);
    const result = await readSnapshot(
      this.connection,
      this.profile,
      owner,
      this.#minimumSlot,
    );
    // Another tab can reconcile while this RPC read is in flight. Its newer
    // receipt must constrain this result before it becomes actionable.
    await this.receipt(owner);
    this.#minimumSlot = boundedNumber(
      result.slot,
      this.#minimumSlot,
      Number.MAX_SAFE_INTEGER,
      "snapshot slot",
    );
    return result;
  }
  async receipt(owner) {
    const record = await this.journal.read(this.scope(owner));
    if (record && record.scope !== this.scope(owner))
      throw new Error("Transaction journal identity mismatch");
    for (const field of ["minimumSlot", "confirmedSlot"])
      if (record?.[field] !== undefined)
        this.#minimumSlot = Math.max(
          this.#minimumSlot,
          boundedNumber(
            record[field],
            0,
            Number.MAX_SAFE_INTEGER,
            "receipt slot",
          ),
        );
    return record;
  }
  async pending(owner) {
    const record = await this.receipt(owner);
    return record && !FINAL_STATES.has(record.status) ? record : null;
  }
  async prepare(owner, action) {
    if (this.#busy) throw new Error("A wallet action is already in progress");
    this.#busy = true;
    const revision = ++this.#revision;
    try {
      action = Object.freeze({ ...action });
      if (await this.pending(owner))
        throw new Error(
          "Reconcile the previous transaction before creating another",
        );
      const snapshot = await this.snapshot(owner);
      const needsRent =
        action.type === "initialize"
          ? constants.portfolioLength
          : (action.type === "withdraw" || isSettlementAction(action.type)) &&
              !snapshot.tokenAccountExists
            ? 165
            : 0;
      const rent = needsRent
        ? await this.connection.getMinimumBalanceForRentExemption(
            needsRent,
            "confirmed",
          )
        : 0;
      const plan = planAction(this.profile, snapshot, action, rent);
      const recent = await this.connection.getLatestBlockhashAndContext({
        commitment: "confirmed",
        minContextSlot: snapshot.slot,
      });
      if ((await this.receipt(owner))?.blockhash === recent.value.blockhash)
        throw new Error(
          `Wait for a new blockhash before another ${continuationName(action.type)} transaction`,
        );
      boundedNumber(
        recent.context.slot,
        snapshot.slot,
        Number.MAX_SAFE_INTEGER,
        "blockhash slot",
      );
      boundedNumber(
        recent.value.lastValidBlockHeight,
        0,
        Number.MAX_SAFE_INTEGER,
        "blockhash height",
      );
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: key(owner),
          recentBlockhash: recent.value.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
            ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
            ...plan.instructions,
          ],
        }).compileToV0Message(),
      );
      if (tx.serialize().length > 1232)
        throw new Error("Transaction exceeds the network packet limit");
      const simulation = await this.connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: "confirmed",
        minContextSlot: recent.context.slot,
      });
      if (simulation.value.err) {
        const error = new Error(
          `Simulation rejected: ${JSON.stringify(simulation.value.err)}`,
        );
        error.logs = simulation.value.logs || [];
        throw error;
      }
      boundedNumber(
        simulation.context.slot,
        recent.context.slot,
        Number.MAX_SAFE_INTEGER,
        "simulation slot",
      );
      const fee = await this.connection.getFeeForMessage(
        tx.message,
        "confirmed",
      );
      boundedNumber(
        fee.context.slot,
        simulation.context.slot,
        Number.MAX_SAFE_INTEGER,
        "fee estimate slot",
      );
      if (fee.value === null)
        throw new Error("Blockhash expired before the review was ready");
      boundedNumber(fee.value, 0, Number.MAX_SAFE_INTEGER, "network fee");
      if (
        BigInt(snapshot.walletLamports) <
        BigInt(fee.value) + BigInt(plan.rentLamports)
      )
        throw new Error("Insufficient SOL for fees and account rent");
      this.#minimumSlot = Math.max(this.#minimumSlot, fee.context.slot);
      const prepared = Object.freeze({
        summary: plan.summary,
        action,
        owner: keyString(owner),
        snapshot,
        networkFeeLamports: fee.value,
        rentLamports: plan.rentLamports,
        simulationUnits: simulation.value.unitsConsumed,
        expiresAt: Date.now() + 30_000,
        messageHash: await sha256(tx.message.serialize()),
      });
      this.#prepared.set(prepared, {
        revision,
        bytes: tx.serialize(),
        ...recent.value,
        slot: simulation.context.slot,
        instructions: plan.instructions,
        rentQuoteLamports: rent,
      });
      return prepared;
    } finally {
      this.#busy = false;
    }
  }
  async submit(prepared, signTransaction) {
    return this.journal.withLock(this.scope(prepared.owner), () =>
      this.#submitLocked(prepared, signTransaction),
    );
  }
  async #submitLocked(prepared, signTransaction) {
    if (this.#busy) throw new Error("A wallet action is already in progress");
    const stored = this.#prepared.get(prepared);
    if (!stored || stored.revision !== this.#revision)
      throw new Error("Review this action again before signing");
    this.#prepared.delete(prepared); // A review can prompt the wallet once only.
    this.#busy = true;
    try {
      if (
        Date.now() > prepared.expiresAt ||
        (await this.pending(prepared.owner))
      )
        throw new Error("Review expired or another transaction is pending");
      if ((await this.receipt(prepared.owner))?.blockhash === stored.blockhash)
        throw new Error(
          `Wait for a new blockhash before another ${continuationName(prepared.action.type)} transaction`,
        );
      const signedBytes = await signTransaction(new Uint8Array(stored.bytes));
      const signed = VersionedTransaction.deserialize(signedBytes);
      const unsigned = VersionedTransaction.deserialize(stored.bytes);
      if (
        !equalBytes(signed.message.serialize(), unsigned.message.serialize()) ||
        signed.signatures.length !== 1
      )
        throw new Error("Wallet changed the reviewed transaction");
      const publicKey = await crypto.subtle.importKey(
        "raw",
        key(prepared.owner).toBytes(),
        "Ed25519",
        false,
        ["verify"],
      );
      if (
        !(await crypto.subtle.verify(
          "Ed25519",
          publicKey,
          signed.signatures[0],
          signed.message.serialize(),
        ))
      )
        throw new Error("Wallet returned an invalid signature");
      if (Date.now() > prepared.expiresAt)
        throw new Error(
          "Review expired while the wallet was open; no transaction was sent by this client",
        );
      // Recheck the network and deployed code after the wallet prompt. State may
      // move between checks and execution; the program's bindings remain final.
      const fresh = await this.snapshot(prepared.owner);
      if (
        accountingAction(prepared.action.type) &&
        (!prepared.snapshot.accountingStateHash ||
          fresh.accountingStateHash !== prepared.snapshot.accountingStateHash)
      )
        throw new Error(
          `${prepared.action.type === "closePortfolio" ? "Portfolio accounting" : isRecoveryAction(prepared.action.type) ? "Recovery accounting" : "Settlement state"} changed; review the action again`,
        );
      if (
        prepared.action.type === "trade" &&
        (fresh.market.wrapper.trade_fee_base_bps !==
          prepared.snapshot.market.wrapper.trade_fee_base_bps ||
          fresh.market.config.max_trading_fee_bps !==
            prepared.snapshot.market.config.max_trading_fee_bps)
      )
        throw new Error("Trading fee policy changed; review the action again");
      const plan = planAction(
        this.profile,
        fresh,
        prepared.action,
        stored.rentQuoteLamports,
      );
      if (!equalInstructions(stored.instructions, plan.instructions))
        throw new Error(
          "Market or account state changed; review the action again",
        );
      if (
        BigInt(fresh.walletLamports) <
        BigInt(prepared.networkFeeLamports) + BigInt(plan.rentLamports)
      )
        throw new Error(
          "Insufficient SOL for fees and account rent after signing",
        );
      const blockHeight = boundedNumber(
        await this.connection.getBlockHeight("confirmed"),
        0,
        Number.MAX_SAFE_INTEGER,
        "block height",
      );
      if (
        blockHeight > stored.lastValidBlockHeight ||
        Date.now() > prepared.expiresAt
      )
        throw new Error(
          "Blockhash expired; no transaction was sent by this client",
        );
      const record = {
        version: 1,
        scope: this.scope(prepared.owner),
        owner: prepared.owner,
        genesisHash: this.profile.genesisHash,
        market: this.profile.market,
        summary: prepared.summary,
        signature: bs58.encode(signed.signatures[0]),
        blockhash: stored.blockhash,
        lastValidBlockHeight: stored.lastValidBlockHeight,
        minimumSlot: this.#minimumSlot,
        messageHash: prepared.messageHash,
        status: "signed",
        createdAt: Date.now(),
      };
      // Persistence must succeed BEFORE broadcasting. A lost HTTP response never
      // causes a second signature or an automatic repeat of the economic action.
      await this.journal.write(record.scope, record);
      try {
        const returned = await this.connection.sendRawTransaction(
          signed.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            minContextSlot: Math.max(stored.slot, this.#minimumSlot),
            maxRetries: 3,
          },
        );
        record.status = returned === record.signature ? "submitted" : "unknown";
      } catch {
        record.status = "unknown";
      }
      await this.journal.write(record.scope, record);
      return Object.freeze({ ...record });
    } finally {
      this.#busy = false;
    }
  }
  async reconcile(owner) {
    // A late status response must never overwrite a newer signed receipt.
    // Use the same cross-tab lock as submission through the entire read/write.
    return this.journal.withLock(this.scope(owner), () =>
      this.#reconcileLocked(owner),
    );
  }
  async #reconcileLocked(owner) {
    const record = await this.pending(owner);
    if (!record) return null;
    if ((await this.connection.getGenesisHash()) !== this.profile.genesisHash)
      throw new Error("Cannot reconcile on a different network");
    const response = await this.connection.getSignatureStatuses(
      [record.signature],
      { searchTransactionHistory: true },
    );
    const minimumSlot = Math.max(
      this.#minimumSlot,
      boundedNumber(
        record.minimumSlot ?? 0,
        0,
        Number.MAX_SAFE_INTEGER,
        "receipt slot",
      ),
    );
    boundedNumber(
      record.lastValidBlockHeight,
      0,
      Number.MAX_SAFE_INTEGER,
      "receipt block height",
    );
    const status = readTransactionStatus(response, minimumSlot);
    if (
      status &&
      ["confirmed", "finalized"].includes(status.confirmationStatus)
    ) {
      record.status =
        status.err === null ? status.confirmationStatus : "failed";
      record.error = status.err;
      record.confirmedSlot = status.slot;
    } else if (
      boundedNumber(
        await this.connection.getBlockHeight("finalized"),
        0,
        Number.MAX_SAFE_INTEGER,
        "block height",
      ) > record.lastValidBlockHeight
    ) {
      record.status = "expiredUnresolved";
    } else record.status = "pending";
    record.minimumSlot = response.context.slot;
    await this.journal.write(record.scope, record);
    this.#minimumSlot = Math.max(this.#minimumSlot, response.context.slot);
    return Object.freeze({ ...record });
  }
}

export function browserJournal(storage) {
  const prefix = "outright.transaction.v1:";
  const getStorage = () => storage ?? globalThis.localStorage;
  return {
    async withLock(scope, work) {
      if (!navigator.locks)
        throw new Error(
          "This browser cannot coordinate wallet actions across tabs",
        );
      return navigator.locks.request(
        prefix + scope,
        { ifAvailable: true },
        (lock) => {
          if (!lock) throw new Error("A wallet action is open in another tab");
          return work();
        },
      );
    },
    async read(scope) {
      const raw = getStorage().getItem(prefix + scope);
      return raw ? JSON.parse(raw) : null;
    },
    async write(scope, record) {
      const value = JSON.stringify(record);
      getStorage().setItem(prefix + scope, value);
      if (getStorage().getItem(prefix + scope) !== value)
        throw new Error("Unable to persist the transaction receipt");
    },
  };
}
