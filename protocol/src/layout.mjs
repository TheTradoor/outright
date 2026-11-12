import { PublicKey } from "@solana/web3.js";
import contract from "../upstream-contract.json" with { type: "json" };
import { ENGINE_COMMIT, WRAPPER_COMMIT } from "./instructions.mjs";

if (
  contract.engineCommit !== ENGINE_COMMIT ||
  contract.wrapperCommit !== WRAPPER_COMMIT
)
  throw new Error("Generated contract does not match pinned source");
export const constants = contract.constants;
export const layouts = contract.layouts;
export const keyString = (v) => new PublicKey(v).toBase58();
export const keyAt = (b, offset) => keyString(b.subarray(offset, offset + 32));
export function u128(b, offset) {
  return b.readBigUInt64LE(offset) | (b.readBigUInt64LE(offset + 8) << 64n);
}
export function fields(b, base, definition) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definition).map(([name, f]) => {
        const offset = base + f.offset;
        let value;
        switch (f.type) {
          case "key":
            value = keyAt(b, offset);
            break;
          case "u8":
            value = b.readUInt8(offset);
            break;
          case "bool":
            value = b.readUInt8(offset);
            if (value > 1) throw new Error(`Invalid ${name} flag`);
            value = value === 1;
            break;
          case "u16":
            value = b.readUInt16LE(offset);
            break;
          case "u32":
            value = b.readUInt32LE(offset);
            break;
          case "u64":
            value = b.readBigUInt64LE(offset);
            break;
          case "i64":
            value = b.readBigInt64LE(offset);
            break;
          case "u128":
            value = u128(b, offset);
            break;
          case "i128":
            value = BigInt.asIntN(128, u128(b, offset));
            break;
          default:
            throw new Error("Unsupported generated field type");
        }
        return [name, value];
      }),
    ),
  );
}
export function accountBytes(account, programId, kind, name) {
  if (
    !account ||
    account.executable ||
    keyString(account.owner) !== keyString(programId)
  )
    throw new Error(`${name} is not owned by the expected program`);
  const b = Buffer.from(account.data);
  if (
    b.length < constants.headerLength ||
    b.readBigUInt64LE(0) !== BigInt("0x" + constants.magic) ||
    b.readUInt16LE(8) !== constants.version ||
    b[10] !== kind
  )
    throw new Error(`Invalid ${name.toLowerCase()} header`);
  return b;
}
