// Bound even an RPC that ignores dataSlice or sends an oversized error body.
// The limit is per decoded HTTP response, not the advertised Content-Length.
export function keeperFetch(fetchImpl = globalThis.fetch, maxBytes = 16 * 1024 * 1024) {
  return async (input, init) => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(init?.signal ? [init.signal] : []),
    ]);
    const response = await fetchImpl(input, { ...init, signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Keeper RPC request failed");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes)
          throw new Error("Keeper RPC response exceeds the byte limit");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(Buffer.concat(chunks, size), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
