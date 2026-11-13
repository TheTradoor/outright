import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import contract from "../upstream-contract.json" with { type: "json" };
import addresses from "./support/token-addresses.json" with { type: "json" };
import { TOKEN_PROGRAM_ID } from "../src/instructions.mjs";
import {
  unpackMint,
  unpackAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "../src/token.mjs";

const address = new PublicKey(Buffer.alloc(32, 7));
const wire = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
const info = (hex) => ({
  owner: TOKEN_PROGRAM_ID,
  executable: false,
  data: Buffer.from(hex, "hex"),
});

for (const [kind, unpack, fixtures, options] of [
  ["mint", unpackMint, contract.classicToken.mints, [0, 46]],
  ["account", unpackAccount, contract.classicToken.accounts, [72, 109, 129]],
]) {
  for (const [index, fixture] of fixtures.entries())
    test(`classic SPL ${kind} matches Rust packer fixture ${index}`, () => {
      const { address: observed, ...value } = unpack(
        address,
        info(fixture.hex),
      );
      assert.ok(observed.equals(address));
      assert.deepEqual(wire(value), fixture.expected);
    });

  test(`classic SPL ${kind} rejects malformed layout, ownership and flags`, () => {
    const input = info(fixtures[1].hex);
    for (const length of [0, input.data.length - 1, input.data.length + 1, 355])
      assert.throws(
        () => unpack(address, { ...input, data: Buffer.alloc(length) }),
        /Invalid classic SPL/,
      );
    assert.throws(
      () => unpack(address, { ...input, owner: SystemProgram.programId }),
      /Invalid classic SPL/,
    );
    assert.throws(
      () => unpack(address, { ...input, executable: true }),
      /Invalid classic SPL/,
    );
    assert.throws(
      () => unpack(address, input, SystemProgram.programId),
      /Only classic/,
    );
    for (const offset of options)
      for (const flag of [2, 256, 0xffffffff]) {
        const data = Buffer.from(input.data);
        data.writeUInt32LE(flag, offset);
        assert.throws(
          () => unpack(address, { ...input, data }),
          /Invalid SPL option/,
        );
      }
    for (const flag of kind === "mint" ? [2, 255] : [3, 255]) {
      const data = Buffer.from(input.data);
      data[kind === "mint" ? 45 : 108] = flag;
      assert.throws(() => unpack(address, { ...input, data }), /Invalid SPL/);
    }
  });

  test(`absent SPL ${kind} options do not treat unused payload bytes as authorities`, () => {
    const input = info(fixtures[0].hex);
    for (const offset of options) {
      const size = kind === "account" && offset === 109 ? 8 : 32;
      input.data.fill(255, offset + 4, offset + 4 + size);
    }
    const { address: _, ...value } = unpack(address, input);
    assert.deepEqual(wire(value), fixtures[0].expected);
  });
}

for (const [index, fixture] of addresses.fixtures.entries())
  test(`classic associated token address and instruction match SDK fixture ${index}`, () => {
    const derived = getAssociatedTokenAddressSync(
      fixture.mint,
      fixture.owner,
      fixture.offCurve,
    );
    assert.equal(derived.toBase58(), fixture.address);
    const ix = createAssociatedTokenAccountIdempotentInstruction(
      fixture.payer,
      fixture.address,
      fixture.owner,
      fixture.mint,
    );
    assert.deepEqual(
      {
        programId: ix.programId.toBase58(),
        data: [...ix.data],
        keys: ix.keys.map((k) => ({ ...k, pubkey: k.pubkey.toBase58() })),
      },
      fixture.instruction,
    );
  });

test("ATA derivation requires explicit PDA support and the classic token program", () => {
  const fixture = addresses.fixtures.find((f) => f.offCurve);
  assert.throws(
    () => getAssociatedTokenAddressSync(fixture.mint, fixture.owner),
    /off curve/,
  );
  assert.throws(
    () =>
      getAssociatedTokenAddressSync(
        fixture.mint,
        fixture.owner,
        true,
        SystemProgram.programId,
      ),
    /Only classic/,
  );
});

test("ATA creation refuses an address bound to another owner or mint", () => {
  const fixture = addresses.fixtures[0];
  for (const [owner, mint] of [
    [address, fixture.mint],
    [fixture.owner, address],
  ])
    assert.throws(
      () =>
        createAssociatedTokenAccountIdempotentInstruction(
          fixture.payer,
          fixture.address,
          owner,
          mint,
        ),
      /does not match/,
    );
});
