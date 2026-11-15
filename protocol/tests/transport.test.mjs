import test from "node:test";
import assert from "node:assert/strict";
import { boundedRpcFetch, readBoundedResponse } from "../src/transport.mjs";
import { OutrightClient } from "../src/client.mjs";
import { fixture } from "./support/client-fixture.mjs";

test("decoded byte limits accept the exact boundary and preserve response metadata", async () => {
  const bytes = new TextEncoder().encode('{"value":"€"}');
  const response = new Response(new ReadableStream({
    start(controller) {
      // Split a multibyte character across chunks.
      controller.enqueue(bytes.subarray(0, 11));
      controller.enqueue(bytes.subarray(11));
      controller.close();
    },
  }), { headers: {
    "content-length": "1",
    "content-encoding": "gzip",
    "content-type": "application/json",
    "x-request-id": "test-request",
  } });
  const bounded = await readBoundedResponse(response, { maxBytes: bytes.length });
  assert.deepEqual(await bounded.json(), { value: "€" });
  assert.equal(bounded.headers.get("content-length"), null);
  assert.equal(bounded.headers.get("content-encoding"), null);
  assert.equal(bounded.headers.get("content-type"), "application/json");
  assert.equal(bounded.headers.get("x-request-id"), "test-request");
});

test("oversized streams stop without waiting for EOF or cancellation acknowledgement", { timeout: 1000 }, async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(5));
    },
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    },
  }), { headers: { "content-length": "1" } });
  await assert.rejects(readBoundedResponse(response, { maxBytes: 12 }), /byte limit/);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

for (const status of [403, 429, 503])
  test(`HTTP ${status} cancels its body without exposing provider details or retrying`, { timeout: 1000 }, async () => {
    let cancelled = false, calls = 0;
    const fetcher = boundedRpcFetch(async () => {
      calls++;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("private provider diagnostics"));
        },
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        },
      }), { status });
    });
    await assert.rejects(fetcher("https://rpc.invalid"), {
      message: "RPC request failed",
    });
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  });

test("an empty HTTP response cannot be accepted as an RPC result", async () => {
  await assert.rejects(readBoundedResponse(new Response(null, { status: 204 }), {
    maxBytes: 100,
  }), /request failed/);
});

test("a truncated stream rejects instead of returning partial JSON", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"result":'));
    },
    pull(controller) { controller.error(new Error("Connection interrupted")); },
  }));
  await assert.rejects(readBoundedResponse(response, { maxBytes: 100 }), /Connection interrupted/);
});

test("caller cancellation interrupts an open response body", { timeout: 1000 }, async () => {
  const caller = new AbortController();
  let cancelled = false, options;
  const fetcher = boundedRpcFetch(async (_input, init) => {
    options = init;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1)); },
      cancel() { cancelled = true; },
    }));
  });
  const pending = fetcher("https://rpc.invalid", {
    method: "POST", body: "request", signal: caller.signal,
  });
  // Let the response reader consume the first chunk and wait for the next one.
  await new Promise((resolve) => setImmediate(resolve));
  caller.abort(new Error("Caller stopped the request"));
  await assert.rejects(pending, /Caller stopped the request/);
  assert.equal(options.method, "POST");
  assert.equal(options.body, "request");
  assert.equal(options.signal.aborted, true);
  assert.equal(cancelled, true);
});

test("an already-cancelled request does not contact the provider", async () => {
  const caller = new AbortController();
  caller.abort();
  let calls = 0;
  await assert.rejects(boundedRpcFetch(async () => { calls++; })("https://rpc.invalid", {
    signal: caller.signal,
  }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("the RPC deadline still interrupts a body when a caller supplies a signal", { timeout: 1000 }, async (t) => {
  const deadline = new AbortController(), caller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 15_000);
    return deadline.signal;
  });
  let cancelled = false;
  const pending = boundedRpcFetch(async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  })))("https://rpc.invalid", { signal: caller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  deadline.abort(new DOMException("RPC deadline reached", "TimeoutError"));
  await assert.rejects(pending, { name: "TimeoutError" });
  assert.equal(caller.signal.aborted, false);
  assert.equal(cancelled, true);
});

test("the wallet client uses the bounded transport for real Connection RPC requests", { timeout: 2000 }, async (t) => {
  const f = await fixture();
  let oversize = false, cancelled = false, calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    if (!oversize) return new Response(JSON.stringify({
      jsonrpc: "2.0", id: JSON.parse(init.body).id, result: f.profile.genesisHash,
    }));
    const chunk = new Uint8Array(1024 * 1024);
    return new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < 17; i++) controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    }));
  });
  const client = new OutrightClient(f.profile, { journal: f.journal });
  assert.equal(await client.connection.getGenesisHash(), f.profile.genesisHash);
  oversize = true;
  await assert.rejects(client.connection.getGenesisHash(), /byte limit/);
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
  assert.equal(f.rpc.sent.length, 0);
});
