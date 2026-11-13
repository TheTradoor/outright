// Local SVM test bridge. Accepts public fixture data only; never signs or sends.
import { readFileSync } from "node:fs";
import { buildInstruction } from "../src/instructions.mjs";
import { readPortfolio } from "../src/accounts.mjs";
import { readMarket, positionForMarket } from "../src/market.mjs";
import {
  planAction,
  portfolioAddress,
  readPortfolioAllocation,
} from "../src/client.mjs";
import { planCrank } from "../src/keeper.mjs";
import { recordedSettlementPayout } from "../src/settlement.mjs";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "../src/token.mjs";

const wireInstruction = (ix) => ({
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((k) => ({ ...k, pubkey: k.pubkey.toBase58() })),
  data: [...ix.data],
});
const account = (value) => value && { ...value, data: Buffer.from(value.data) };

const input = JSON.parse(readFileSync(0, "utf8"));
let result;
if (input.operation === "createPayoutAta") {
  const owner = new PublicKey(input.owner),
    mint = new PublicKey(input.mint);
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  result = {
    address: ata.toBase58(),
    instruction: wireInstruction(
      createAssociatedTokenAccountIdempotentInstruction(
        new PublicKey(input.payer),
        ata,
        owner,
        mint,
      ),
    ),
  };
} else if (input.operation === "readPortfolio") {
  result = readPortfolio(
    { ...input.account, data: Buffer.from(input.account.data) },
    input.expected,
  );
} else if (input.operation === "buildInstruction") {
  const ix = buildInstruction(
    input.program,
    input.name,
    input.args,
    input.accounts,
  );
  result = wireInstruction(ix);
} else if (input.operation === "readMarket") {
  result = readMarket(account(input.account), input.expected);
} else if (["positions", "settlement"].includes(input.operation)) {
  const market = readMarket(account(input.marketAccount), input.marketExpected);
  const p = readPortfolio(
    account(input.portfolioAccount),
    input.portfolioExpected,
  );
  result =
    input.operation === "positions"
      ? p.positions.map((leg) => positionForMarket(leg, market))
      : {
          receipt: p.resolvedPayout,
          ledger: market.resolvedPayout,
          recordedPayout: recordedSettlementPayout(market, p),
        };
} else if (input.operation === "planCrank") {
  const profile = input.config.deployment;
  const market = readMarket(account(input.marketAccount), {
    programId: profile.program.address,
    address: profile.market,
    collateralMint: profile.collateral.mint,
  });
  const portfolio = readPortfolio(account(input.portfolioAccount), {
    programId: profile.program.address,
    address: input.target.address,
    market: profile.market,
    owner: input.target.owner,
  });
  result = wireInstruction(
    planCrank(
      input.config,
      {
        market,
        portfolio,
        slot: input.slot,
        payoutTokenExists: Boolean(input.payoutTokenAccount),
      },
      input.discoveryIndex,
    ),
  );
} else if (input.operation === "planAction") {
  const profile = input.profile;
  const identity = await portfolioAddress(
    input.owner,
    profile.market,
    profile.program.address,
  );
  const market = readMarket(account(input.marketAccount), {
    programId: profile.program.address,
    address: profile.market,
    collateralMint: profile.collateral.mint,
  });
  const { portfolio, uninitializedPortfolioLamports } = readPortfolioAllocation(
    account(input.portfolioAccount),
    {
      programId: profile.program.address,
      address: identity.address,
      owner: input.owner,
      market: profile.market,
    },
  );
  const userToken =
    input.userToken ||
    getAssociatedTokenAddressSync(
      new PublicKey(profile.collateral.mint),
      new PublicKey(input.owner),
    ).toBase58();
  const snapshot = {
    slot: input.slot,
    owner: input.owner,
    market,
    portfolio,
    uninitializedPortfolioLamports,
    portfolioAddress: identity.address.toBase58(),
    seed: identity.seed,
    userToken,
    tokenAccountExists: input.tokenAccountExists,
    tokenBalance: BigInt(input.tokenBalance || "0"),
    maker: input.makerAccount
      ? readPortfolio(account(input.makerAccount), {
          programId: profile.program.address,
          address: profile.maker.portfolio,
          owner: profile.maker.owner,
          market: profile.market,
        })
      : null,
  };
  const plan = planAction(profile, snapshot, input.action, input.rentLamports);
  result = {
    portfolio: snapshot.portfolioAddress,
    userToken,
    instructions: plan.instructions.map(wireInstruction),
    rentLamports: plan.rentLamports,
  };
} else {
  throw new Error("Unsupported SVM bridge operation");
}
process.stdout.write(
  JSON.stringify(result, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  ),
);
