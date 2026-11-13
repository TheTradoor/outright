import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./instructions.mjs";

// Only the classic SPL layouts supported by this client. The Rust conformance
// exporter packs the same mint/account fixtures with spl-token 4.0.3.
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const key = (value) => new PublicKey(value);
const publicKeyAt = (bytes, offset) => key(bytes.subarray(offset, offset + 32));

function classicProgram(program) {
  if (!key(program).equals(TOKEN_PROGRAM_ID))
    throw new Error("Only classic SPL Token is supported");
}
function bytesFor(info, length, program) {
  classicProgram(program);
  if (
    !info ||
    info.executable ||
    !key(info.owner).equals(TOKEN_PROGRAM_ID) ||
    !(info.data instanceof Uint8Array) ||
    info.data.length !== length
  )
    throw new Error(
      "Invalid classic SPL account owner, size or executable flag",
    );
  return Buffer.from(info.data);
}
function option(bytes, offset, read) {
  const tag = bytes.readUInt32LE(offset);
  if (tag > 1) throw new Error("Invalid SPL option tag");
  return tag === 1 ? read(bytes, offset + 4) : null;
}

export function unpackMint(address, info, program = TOKEN_PROGRAM_ID) {
  const bytes = bytesFor(info, 82, program);
  if (bytes[45] > 1) throw new Error("Invalid SPL mint initialization flag");
  return Object.freeze({
    address: key(address),
    mintAuthority: option(bytes, 0, publicKeyAt),
    supply: bytes.readBigUInt64LE(36),
    decimals: bytes[44],
    isInitialized: bytes[45] === 1,
    freezeAuthority: option(bytes, 46, publicKeyAt),
  });
}

export function unpackAccount(address, info, program = TOKEN_PROGRAM_ID) {
  const bytes = bytesFor(info, 165, program);
  const state = bytes[108];
  if (state > 2) throw new Error("Invalid SPL token account state");
  const reserve = option(bytes, 109, (b, offset) => b.readBigUInt64LE(offset));
  return Object.freeze({
    address: key(address),
    mint: publicKeyAt(bytes, 0),
    owner: publicKeyAt(bytes, 32),
    amount: bytes.readBigUInt64LE(64),
    delegate: option(bytes, 72, publicKeyAt),
    delegatedAmount: bytes.readBigUInt64LE(121),
    isInitialized: state !== 0,
    isFrozen: state === 2,
    isNative: reserve !== null,
    rentExemptReserve: reserve,
    closeAuthority: option(bytes, 129, publicKeyAt),
  });
}

export function getAssociatedTokenAddressSync(
  mint,
  owner,
  allowOwnerOffCurve = false,
  program = TOKEN_PROGRAM_ID,
) {
  classicProgram(program);
  const ownerKey = key(owner);
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(ownerKey.toBytes()))
    throw new Error("SPL token owner is off curve");
  return PublicKey.findProgramAddressSync(
    [ownerKey.toBytes(), TOKEN_PROGRAM_ID.toBytes(), key(mint).toBytes()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

export function createAssociatedTokenAccountIdempotentInstruction(
  payer,
  associatedToken,
  owner,
  mint,
) {
  const address = getAssociatedTokenAddressSync(mint, owner, true);
  if (!address.equals(key(associatedToken)))
    throw new Error(
      "Associated token address does not match its owner and mint",
    );
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      { pubkey: key(payer), isSigner: true, isWritable: true },
      { pubkey: address, isSigner: false, isWritable: true },
      ...[key(owner), key(mint), SystemProgram.programId, TOKEN_PROGRAM_ID].map(
        (pubkey) => ({ pubkey, isSigner: false, isWritable: false }),
      ),
    ],
  });
}
