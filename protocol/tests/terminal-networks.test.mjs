import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { OutrightClient, validateProfile } from "../src/client.mjs";
import { fixture } from "./support/client-fixture.mjs";

// Real terminal module, deterministic RPC and locally generated fixture signer.
// This does not exercise a wallet extension, phone or production deployment.
test("mainnet terminal binds account selection, signing and receipts to mainnet", async (t) => {
  const f = await fixture();
  f.profile = validateProfile({
    ...f.profile,
    cluster: "mainnet-beta",
    rpcUrl: "https://rpc.example.invalid/?api-key=fixture-only",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  });
  f.rpc.getGenesisHash = async () => f.profile.genesisHash;
  f.client = new OutrightClient(f.profile, {
    connection: f.rpc,
    journal: f.journal,
  });
  const errors = [],
    virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(
    await readFile(new URL("../terminal/index.html", import.meta.url), "utf8"),
    {
      url: "https://outright.test/trade/",
      pretendToBeVisual: true,
      virtualConsole,
    },
  );
  const w = dom.window,
    el = (id) => w.document.getElementById(id),
    globals = new Map();
  const replace = (name, value) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  for (const name of [
    "window",
    "document",
    "navigator",
    "Event",
    "CustomEvent",
    "FormData",
    "localStorage",
  ])
    replace(name, name === "window" ? w : w[name]);
  replace(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  replace("setInterval", () => 0);
  replace("fetch", async (url) => {
    assert.ok(
      String(url).endsWith("/deployment.json"),
      "fixture must never make an external request",
    );
    return new Response(JSON.stringify(f.profile));
  });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  const methods = new Map();
  for (const method of ["snapshot", "prepare", "submit", "reconcile"]) {
    const original = OutrightClient.prototype[method];
    methods.set(method, original);
    OutrightClient.prototype[method] = function (...args) {
      return original.apply(f.client, args);
    };
  }
  let changed;
  const requests = [];
  const account = {
    address: f.owner.publicKey.toBase58(),
    publicKey: f.owner.publicKey.toBytes(),
    features: ["solana:signTransaction"],
    chains: ["solana:devnet"],
  };
  const wallet = {
    version: "1.0.0",
    name: "Network fixture",
    accounts: [account],
    chains: ["solana:devnet", "solana:mainnet"],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: wallet.accounts }),
      },
      "standard:events": {
        version: "1.0.0",
        on: (_, callback) => {
          changed = callback;
          return () => {
            changed = undefined;
          };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signTransaction: async (request) => {
          requests.push(request);
          return [{ signedTransaction: await f.sign(request.transaction) }];
        },
      },
    },
  };
  const { getWallets } = await import("@wallet-standard/app");
  const unregister = getWallets().register(wallet);
  const until = async (predicate, reason) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await pause(5);
    }
    assert.fail(reason);
  };
  const choose = () => {
    el("wallet-button").click();
    el("wallet-list").querySelector("button").click();
  };
  try {
    await import("../terminal/terminal.mjs");
    await until(
      () => el("deployment-notice").dataset.state === "ready",
      "mainnet profile did not load",
    );
    await t.test(
      "normal trader startup identifies real funds without operator import",
      () => {
        assert.equal(el("availability-title").textContent, "Solana mainnet");
        assert.match(el("availability-detail").textContent, /real funds/);
        assert.equal(el("settings-dialog").open, false);
        assert.equal(el("profile-file").disabled, true);
        assert.equal(el("wallet-button").disabled, false);
      },
    );
    await t.test(
      "devnet-only account cannot connect to a mainnet market",
      async () => {
        choose();
        await until(
          () => /supports this network/.test(el("wallet-error").textContent),
          "wrong-chain account was not rejected",
        );
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        assert.equal(requests.length, 0);
        el("wallet-dialog").close();
      },
    );
    await t.test(
      "mainnet account receives an explicit mainnet signing request",
      async () => {
        account.chains = ["solana:mainnet"];
        choose();
        await until(
          () =>
            el("wallet-balance").textContent === "1000" &&
            !el("wallet-button").disabled,
          "mainnet account did not connect",
        );
        const form = el("collateral-form");
        form.elements.namedItem("amount").value = "1";
        form.querySelector('button[value="deposit"]').click();
        await until(
          () => el("review-dialog").open && !el("sign").disabled,
          "mainnet review did not open",
        );
        assert.match(el("review-details").textContent, /mainnet-beta/);
        el("sign").click();
        await until(
          () => !el("review-dialog").open && !el("wallet-button").disabled,
          "mainnet signing did not finish",
        );
        assert.equal(requests.length, 1);
        assert.equal(requests[0].chain, "solana:mainnet");
        assert.equal(requests[0].account, account);
        assert.equal(f.rpc.sent.length, 1);
        const link = new URL(el("receipt-link").href);
        assert.equal(link.origin, "https://explorer.solana.com");
        assert.equal(link.search, "");
        assert.ok(link.pathname.endsWith(el("receipt-link").textContent));
        assert.ok(!link.href.includes("fixture-only"));
      },
    );
    await t.test(
      "losing mainnet account support clears the active session",
      () => {
        account.chains = ["solana:devnet"];
        changed({ accounts: [account] });
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        assert.equal(el("wallet-balance").textContent, "Not connected");
        assert.equal(el("trade-review").disabled, true);
        assert.equal(requests.length, 1);
      },
    );
    assert.deepEqual(errors, []);
  } finally {
    unregister();
    for (const [name, original] of methods)
      OutrightClient.prototype[name] = original;
    dom.window.close();
    for (const [name, original] of globals)
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
  }
});
