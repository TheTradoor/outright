import { boundedRpcFetch } from "../src/transport.mjs";

export function keeperFetch(fetchImpl = globalThis.fetch, maxBytes = 16 * 1024 * 1024) {
  return boundedRpcFetch(fetchImpl, {
    maxBytes,
    requestError: "Keeper RPC request failed",
    sizeError: "Keeper RPC response exceeds the byte limit",
  });
}
