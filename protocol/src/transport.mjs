// Count decoded stream bytes before retaining them. Content-Length can describe
// compressed bytes or be absent, so it is not an allocation or acceptance limit.
export async function readBoundedResponse(response, {
  maxBytes,
  signal,
  requestError = "RPC request failed",
  sizeError = "RPC response exceeds the byte limit",
}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("Invalid response byte limit");
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error(requestError);
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  let bytes = new Uint8Array(0);
  let size = 0;
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > maxBytes) throw new Error(sizeError);
      if (nextSize > bytes.length) {
        const grown = new Uint8Array(Math.min(maxBytes,
          Math.max(nextSize, bytes.length * 2, 8192)));
        grown.set(bytes.subarray(0, size));
        bytes = grown;
      }
      bytes.set(value, size);
      size = nextSize;
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(bytes.subarray(0, size), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function boundedRpcFetch(fetchImpl = globalThis.fetch, options = {}) {
  return async (input, init) => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(init?.signal ? [init.signal] : []),
    ]);
    signal.throwIfAborted();
    const response = await fetchImpl(input, { ...init, signal });
    return readBoundedResponse(response, {
      maxBytes: 16 * 1024 * 1024,
      ...options,
      signal,
    });
  };
}
