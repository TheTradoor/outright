import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, withMaker } from "./support/client-fixture.mjs";

const exec = promisify(execFile);

async function setup(t, handler) {
  const f = await withMaker(await fixture());
  const directory = await mkdtemp(join(tmpdir(), "outright-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, "program.so");
  await writeFile(binary, f.accounts.get(f.profile.program.programData).data.subarray(45));
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    calls.push(rpc.method);
    response.setHeader("Content-Type", "application/json");
    handler(rpc, response, f);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const rpcUrl = `http://127.0.0.1:${server.address().port}`;
  const run = (name) => {
    const args = name === "profile"
      ? ["--rpc", rpcUrl, "--cluster", "localnet", "--program", f.profile.program.address,
          "--program-binary", binary, "--market", f.profile.market, "--wallet", f.owner.publicKey.toBase58(),
          "--symbol", "TEST", "--max-oracle-age-slots", "20",
          "--maker-portfolio", f.profile.maker.portfolio, "--maker-owner", f.profile.maker.owner,
          "--matcher-program", f.profile.maker.program.address, "--matcher-binary", binary,
          "--matcher-context", f.profile.maker.context, "--fee-bps", "10", "--backing-fee-cap-bps", "10"]
      : [rpcUrl, f.profile.genesisHash, f.profile.program.address, f.profile.market, f.identity.address.toBase58()];
    return exec(process.execPath, [fileURLToPath(new URL(`../${name}.mjs`, import.meta.url)), ...args], {
      timeout: 4000, maxBuffer: 1024 * 1024,
    });
  };
  return { f, calls, run, rpcUrl };
}

for (const name of ["profile", "inspect"]) {
  test(`${name} CLI cancels an oversized RPC stream before EOF`, { timeout: 7000 }, async (t) => {
    let closed = false;
    const f = await setup(t, (_rpc, response) => {
      response.on("close", () => { closed = true; });
      // Keep the connection open after crossing the decoded response bound.
      response.write(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
    });
    await assert.rejects(f.run(name), (error) => {
      assert.equal(error.killed, false, "the CLI must stop itself, not reach the process timeout");
      assert.match(error.stderr, /RPC response exceeds the byte limit/);
      assert.equal(error.stdout, "");
      return true;
    });
    assert.equal(closed, true);
    assert.deepEqual(f.calls, ["getGenesisHash"]);
  });

  test(`${name} CLI rejects HTTP errors without retries or provider diagnostics`, { timeout: 7000 }, async (t) => {
    const f = await setup(t, (_rpc, response) => {
      response.writeHead(429);
      response.end("private-provider-diagnostics");
    });
    await assert.rejects(f.run(name), (error) => {
      assert.equal(error.killed, false);
      assert.match(error.stderr, /RPC request failed/);
      assert.doesNotMatch(error.stderr, /private-provider-diagnostics/);
      assert.equal(error.stdout, "");
      return true;
    });
    assert.deepEqual(f.calls, ["getGenesisHash"]);
  });
}

function readOnlyRpc({ id, method, params }, response, f) {
  const account = (address) => {
    const info = f.accounts.get(address);
    return info ? { ...info, owner: info.owner.toBase58(), data: [info.data.toString("base64"), "base64"] } : null;
  };
  const result = method === "getGenesisHash" ? f.profile.genesisHash
    : method === "getAccountInfo" ? { context: { slot: 123 }, value: account(params[0]) }
      : method === "getMultipleAccounts" ? { context: { slot: 123 }, value: params[0].map(account) }
        : undefined;
  if (result === undefined) {
    response.writeHead(400);
    response.end("Unexpected RPC method");
  } else response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

test("profile CLI enrolls verified program and matcher bytes using read-only RPC", async (t) => {
  const f = await setup(t, readOnlyRpc);
  const { stdout, stderr } = await f.run("profile");
  const profile = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(profile.rpcUrl, f.rpcUrl + "/");
  assert.deepEqual(profile.program, f.f.profile.program);
  assert.deepEqual(profile.maker.program, f.f.profile.maker.program);
  assert.equal(profile.market, f.f.profile.market);
  assert(f.calls.includes("getMultipleAccounts"));
  assert(f.calls.every((method) => ["getGenesisHash", "getAccountInfo", "getMultipleAccounts"].includes(method)));
});

test("inspect CLI returns source-scoped account evidence using read-only RPC", async (t) => {
  const f = await setup(t, readOnlyRpc);
  const { stdout, stderr } = await f.run("inspect");
  const result = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(result.sourcePinOnly, true);
  assert.equal(result.portfolio.owner, f.f.owner.publicKey.toBase58());
  assert.deepEqual(f.calls, ["getGenesisHash", "getMultipleAccounts"]);
});
