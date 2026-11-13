import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import contract from "../upstream-contract.json" with { type: "json" };
import {
  initializeMarket,
  initializeMint,
  mintTokens,
  markInstruction,
  matcherConsent,
  initializeMatcher,
} from "../localnet/instructions.mjs";
const pub = (n) => new PublicKey(Buffer.alloc(32, n));

test("local validator mint initialization and checked issuance match SPL Rust", () => {
  assert.equal(
    initializeMint(pub(5), pub(3)).data.toString("hex"),
    contract.localnet.initializeMintHex,
  );
  assert.equal(
    mintTokens(pub(5), pub(6), pub(3), 1_000_000_000n).data.toString("hex"),
    contract.localnet.mintTokensHex,
  );
  assert.throws(() => mintTokens(pub(5), pub(6), pub(3), -1n), /bounded/);
  assert.throws(() => mintTokens(pub(5), pub(6), pub(3), 1n << 64n), /bounded/);
});
test("local authority price updates match the pinned Rust encoder", () => {
  const asset = {
    market_id: 1n,
    control: { oracle_observation: 1n, authority_epoch: 3n },
  };
  assert.equal(
    markInstruction(pub(9), pub(3), pub(1), asset, 123, true).data.toString(
      "hex",
    ),
    contract.localnet.configureMarkHex,
  );
  asset.control.oracle_observation = 2n;
  assert.equal(
    markInstruction(pub(9), pub(3), pub(1), asset, 124).data.toString("hex"),
    contract.localnet.pushMarkHex,
  );
});
test("local maker consent matches the pinned Rust encoder and does not sign for a trader", () => {
  const state = { portfolioId: 17n, expectedSequence: 2n, positionEpoch: 3n };
  const ix = matcherConsent(
    pub(9),
    pub(8),
    pub(7),
    pub(3),
    pub(1),
    pub(2),
    state,
    2n,
    100000,
  );
  assert.equal(ix.data.toString("hex"), contract.localnet.matcherConsentHex);
  assert.deepEqual(
    ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()),
    [pub(3).toBase58()],
  );
  const init = initializeMatcher(
    pub(9),
    pub(8),
    pub(7),
    pub(3),
    pub(1),
    pub(2),
  );
  assert(init.keys[1].pubkey.equals(ix.keys[5].pubkey));
});
test("local market allocation uses the Rust-exported one-asset layout", () => {
  assert.equal(
    contract.localnet.marketAccountLength,
    contract.constants.marketGroupOffset +
      contract.constants.marketHeaderLength +
      contract.constants.marketAssetSlotLength,
  );
  assert.equal(initializeMarket(pub(9), pub(3), pub(1), pub(5)).keys.length, 3);
});
