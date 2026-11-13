import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { join } from "node:path";
import { access } from "node:fs/promises";
import contract from "../upstream-contract.json" with { type: "json" };
import {
  OutrightClient,
  validateProfile,
  portfolioAddress,
} from "../src/client.mjs";
import { readMarket } from "../src/market.mjs";
import {
  ENGINE_COMMIT,
  WRAPPER_COMMIT,
  TOKEN_PROGRAM_ID,
  vaultAuthority,
} from "../src/instructions.mjs";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "../src/token.mjs";
import {
  initializeMarket,
  initializeMint,
  mintTokens,
  initializeMatcher,
  matcherConsent,
  markInstruction,
} from "./instructions.mjs";
import {
  connection,
  send,
  confirm,
  loadJson,
  saveJson,
  programPin,
  clientJournal,
  clientAction,
  reconcileSetup,
} from "./runtime.mjs";

export async function loadMarket(root) {
  const config = await loadJson(join(root, "public.json"));
  const raw = await loadJson(join(root, "keys.json"));
  if (
    config.version !== 1 ||
    Object.keys(raw).sort().join(",") !==
      "admin,context,maker,market,mint,trader"
  )
    throw new Error("Invalid local market state");
  const keys = Object.fromEntries(
    Object.entries(raw).map(([name, bytes]) => [
      name,
      Keypair.fromSecretKey(Uint8Array.from(bytes)),
    ]),
  );
  for (const [name, signer] of Object.entries(keys))
    if (signer.publicKey.toBase58() !== config[name])
      throw new Error("Local state key identity changed");
  const rpc = connection(config.rpcUrl);
  return { root, config, keys, rpc };
}

export async function marketSnapshot(env) {
  const result = await env.rpc.getAccountInfoAndContext(
    new PublicKey(env.config.market),
    "confirmed",
  );
  return {
    slot: result.context.slot,
    market: readMarket(result.value, {
      programId: env.config.program,
      address: env.config.market,
      collateralMint: env.config.mint,
    }),
  };
}

export async function refreshMark(env, configure = false) {
  const snapshot = await marketSnapshot(env);
  return send(
    env.rpc,
    env.root,
    configure ? "configure-test-price" : "refresh-test-price",
    [
      markInstruction(
        env.config.program,
        env.config.admin,
        env.config.market,
        snapshot.market.assets[0],
        snapshot.slot,
        configure,
      ),
    ],
    [env.keys.admin],
  );
}

export async function bootstrap(env, programBinary, matcherBinary) {
  const { rpc, root, config: c, keys: k } = env;
  const genesisHash = await rpc.getGenesisHash();
  if (genesisHash !== c.genesisHash)
    throw new Error("Local validator genesis changed");
  const program = await programPin(rpc, c.program, programBinary);
  const matcher = await programPin(rpc, c.matcher, matcherBinary);
  await reconcileSetup(rpc, root);
  try {
    await access(join(root, "deployment.json"));
    env.profile = validateProfile(
      await loadJson(join(root, "deployment.json")),
    );
    if (
      env.profile.genesisHash !== genesisHash ||
      env.profile.market !== c.market ||
      env.profile.program.address !== program.address ||
      env.profile.program.sha256 !== program.sha256 ||
      env.profile.maker?.program.sha256 !== matcher.sha256
    )
      throw new Error("Saved local deployment profile changed");
    const client = new OutrightClient(env.profile, {
      connection: rpc,
      journal: clientJournal(root),
    });
    await client.snapshot(c.trader);
    return env.profile;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await access(join(root, "bootstrap-started.json"));
    throw new Error(
      "Local bootstrap was interrupted; inspect receipts and use a new state directory for a clean test market",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await saveJson(join(root, "bootstrap-started.json"), {
    genesisHash,
    at: new Date().toISOString(),
  });
  for (const [name, amount] of [
    ["admin", 10],
    ["maker", 2],
    ["trader", 2],
  ]) {
    const signature = await rpc.requestAirdrop(k[name].publicKey, amount * 1e9);
    await confirm(rpc, signature);
  }
  const allocation = async (signer, owner, space) =>
    SystemProgram.createAccount({
      fromPubkey: k.admin.publicKey,
      newAccountPubkey: signer.publicKey,
      lamports: await rpc.getMinimumBalanceForRentExemption(space),
      space,
      programId: new PublicKey(owner),
    });
  await send(
    rpc,
    root,
    "create-test-mint",
    [
      await allocation(k.mint, TOKEN_PROGRAM_ID, 82),
      initializeMint(c.mint, c.admin),
    ],
    [k.admin, k.mint],
  );
  await send(
    rpc,
    root,
    "initialize-test-market",
    [
      await allocation(
        k.market,
        c.program,
        contract.localnet.marketAccountLength,
      ),
      initializeMarket(c.program, c.admin, c.market, c.mint),
    ],
    [k.admin, k.market],
  );
  const vaultOwner = vaultAuthority(c.program, c.market);
  const vault = getAssociatedTokenAddressSync(
    k.mint.publicKey,
    vaultOwner,
    true,
  );
  await send(
    rpc,
    root,
    "create-collateral-vault",
    [
      createAssociatedTokenAccountIdempotentInstruction(
        k.admin.publicKey,
        vault,
        vaultOwner,
        k.mint.publicKey,
      ),
    ],
    [k.admin],
  );
  for (const name of ["maker", "trader"]) {
    const owner = k[name].publicKey;
    const ata = getAssociatedTokenAddressSync(k.mint.publicKey, owner);
    await send(
      rpc,
      root,
      "fund-test-" + name,
      [
        createAssociatedTokenAccountIdempotentInstruction(
          k.admin.publicKey,
          ata,
          owner,
          k.mint.publicKey,
        ),
        mintTokens(
          c.mint,
          ata,
          c.admin,
          name === "maker" ? 10_000_000_000n : 1_000_000_000n,
        ),
      ],
      [k.admin],
    );
  }
  await refreshMark(env, true);
  const base = validateProfile({
    version: 1,
    cluster: "localnet",
    rpcUrl: c.rpcUrl,
    genesisHash,
    engineCommit: ENGINE_COMMIT,
    wrapperCommit: WRAPPER_COMMIT,
    program,
    market: c.market,
    collateral: {
      mint: c.mint,
      decimals: 6,
      symbol: "TEST",
      mintAuthority: c.admin,
      freezeAuthority: null,
    },
    vault: vault.toBase58(),
    maker: null,
    maxOracleAgeSlots: 30,
    assets: [{ index: 0, marketId: "1", symbol: "TEST/USD" }],
  });
  const client = new OutrightClient(base, {
    connection: rpc,
    journal: clientJournal(root),
  });
  await clientAction(client, k.maker, { type: "initialize" });
  await clientAction(client, k.maker, { type: "deposit", amount: "10000" });
  const makerPortfolio = (await portfolioAddress(c.maker, c.market, c.program))
    .address;
  await send(
    rpc,
    root,
    "initialize-test-matcher",
    [
      await allocation(k.context, c.matcher, 256),
      initializeMatcher(
        c.program,
        c.matcher,
        c.context,
        c.maker,
        c.market,
        makerPortfolio,
      ),
    ],
    [k.admin, k.context, k.maker],
  );
  const snapshot = await client.snapshot(c.maker);
  await send(
    rpc,
    root,
    "authorize-test-maker",
    [
      matcherConsent(
        c.program,
        c.matcher,
        c.context,
        c.maker,
        c.market,
        makerPortfolio,
        snapshot.portfolio,
        snapshot.market.next_market_id,
        snapshot.slot + 1_000_000,
      ),
    ],
    [k.maker],
  );
  const profile = validateProfile({
    ...base,
    maker: {
      program: matcher,
      context: c.context,
      portfolio: makerPortfolio.toBase58(),
      owner: c.maker,
      feeBps: 100,
      backingFeeCapBps: 0,
    },
  });
  const ready = new OutrightClient(profile, {
    connection: rpc,
    journal: clientJournal(root),
  });
  const verified = await ready.snapshot(c.trader);
  if (verified.makerError || verified.maker.capital !== 10_000_000_000n)
    throw new Error("Local maker is not ready");
  await saveJson(join(root, "deployment.json"), profile);
  env.profile = profile;
  return profile;
}

export async function fundWallet(env, address) {
  const owner = new PublicKey(address);
  if (!PublicKey.isOnCurve(owner.toBytes()))
    throw new Error("Use a wallet owner address");
  if ((await env.rpc.getGenesisHash()) !== env.config.genesisHash)
    throw new Error("Local validator genesis changed");
  await confirm(env.rpc, await env.rpc.requestAirdrop(owner, 2_000_000_000));
  const ata = getAssociatedTokenAddressSync(env.keys.mint.publicKey, owner);
  return send(
    env.rpc,
    env.root,
    "fund-test-wallet",
    [
      createAssociatedTokenAccountIdempotentInstruction(
        env.keys.admin.publicKey,
        ata,
        owner,
        env.keys.mint.publicKey,
      ),
      mintTokens(env.config.mint, ata, env.config.admin, 1_000_000_000n),
    ],
    [env.keys.admin],
  );
}
