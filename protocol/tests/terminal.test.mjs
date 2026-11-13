import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { JSDOM } from "jsdom";
import bs58 from "bs58";
import { OutrightClient } from "../src/client.mjs";
import { fixture, withMaker } from "./support/client-fixture.mjs";
import { setSettlement } from "./support/settlement-fixture.mjs";

// Execute the actual terminal module and HTML with deterministic wallet/RPC
// fixtures. This is DOM behavior coverage, not browser-extension or layout QA.
test("terminal recovers from unavailable RPC and wallet lifecycle changes", async (t) => {
  const f = await withMaker(await fixture());
  const dom = new JSDOM(
    await readFile(new URL("../terminal/index.html", import.meta.url), "utf8"),
    { url: "https://outright.test/trade/" },
  );
  const w = dom.window,
    document = w.document,
    el = (id) => document.getElementById(id);
  const saved = new Map();
  const setGlobal = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
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
    setGlobal(name, name === "window" ? w : w[name]);
  setGlobal(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  setGlobal("setInterval", () => 0);
  let finishStartup;
  const startup = new Promise((resolve) => {
    finishStartup = resolve;
  });
  setGlobal("fetch", async (url) => {
    assert.ok(
      String(url).endsWith("/deployment.json"),
      "terminal fixture must not access a network",
    );
    return startup;
  });
  w.HTMLCanvasElement.prototype.getContext = () => ({
    scale() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillRect() {},
    fillText() {},
  });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    if (this.open) {
      this.open = false;
      this.dispatchEvent(new w.Event("close"));
    }
  };
  let rejectRpc = false,
    holdRpc = null,
    changed = () => {},
    noAssets = false,
    makerStatus = "enabled";
  const originalSnapshot = OutrightClient.prototype.snapshot;
  const originalPrepare = OutrightClient.prototype.prepare;
  const originalSubmit = OutrightClient.prototype.submit;
  OutrightClient.prototype.prepare = function (...args) {
    return originalPrepare.apply(f.client, args);
  };
  OutrightClient.prototype.submit = function (...args) {
    return originalSubmit.apply(f.client, args);
  };
  OutrightClient.prototype.snapshot = async function (owner) {
    if (holdRpc) await holdRpc;
    if (rejectRpc) throw new Error("RPC unavailable");
    const observed = await originalSnapshot.call(f.client, owner);
    const result = {
      ...observed,
      market: { ...observed.market },
      maker: { ...observed.maker },
    };
    if (noAssets) {
      result.market.assets = result.market.assets.map((asset) => ({
        ...asset,
        lifecycle: "disabled",
      }));
      result.tokenBalance = 2_000_000n;
    }
    if (makerStatus === "revoked") result.maker.matcherEnabled = false;
    if (makerStatus === "expired")
      result.maker.matcherExpirySlot = BigInt(result.slot);
    return result;
  };
  const account = {
    address: f.owner.publicKey.toBase58(),
    publicKey: f.owner.publicKey.toBytes(),
    features: ["solana:signTransaction"],
    chains: ["solana:devnet"],
  };
  const wallet = {
    version: "1.0.0",
    name: "Fixture wallet",
    accounts: [account],
    chains: account.chains,
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: [account] }),
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          changed = listener;
          return () => {
            changed = () => {};
          };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        // The deterministic fixture key signs locally. No external wallet or
        // network is involved; the client still verifies the real signature.
        signTransaction: async ({ transaction }) => [
          { signedTransaction: await f.sign(transaction) },
        ],
      },
    },
  };
  const { getWallets } = await import("@wallet-standard/app");
  const registry = getWallets();
  const unregister = registry.register(
    { ...wallet, name: "Other wallet" },
    wallet,
  );
  const until = async (predicate, message) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await pause(5);
    }
    assert.fail(message);
  };
  const connect = async () => {
    el("wallet-button").click();
    [...el("wallet-list").querySelectorAll("button")]
      .find((b) => b.textContent === wallet.name)
      .click();
    await until(
      () => el("price").textContent === "150" && !el("wallet-button").disabled,
      "wallet did not finish loading",
    );
  };
  const unavailable = () => {
    assert.equal(el("price").textContent, "Not available");
    assert.equal(el("maker-state").textContent, "Unavailable");
    assert.equal(el("trade-review").disabled, true);
    assert.equal(el("chart-empty").hidden, false);
    assert.ok(!el("footer-state").textContent.endsWith(" connected"));
  };
  try {
    await import("../terminal/terminal.mjs");
    Object.defineProperty(el("profile-file"), "files", {
      configurable: true,
      value: [{ size: 4096, text: async () => JSON.stringify(f.profile) }],
    });
    el("profile-file").dispatchEvent(new w.Event("change"));
    await until(
      () => el("footer-state").textContent === "localnet profile loaded",
      "profile did not load",
    );
    await t.test(
      "connected wallet renders verified balances and maker status",
      async () => {
        await connect();
        assert.equal(el("wallet-balance").textContent, "1000");
        assert.equal(el("maker-state").textContent, "Authorized");
      },
    );
    await t.test(
      "a late startup profile cannot replace a manually selected profile",
      async () => {
        finishStartup(
          new Response(
            JSON.stringify({
              ...f.profile,
              collateral: { ...f.profile.collateral, symbol: "OTHER" },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
        await startup;
        await pause(0);
        assert.equal(el("collateral-symbol").textContent, "TEST");
        assert.equal(el("price").textContent, "150");
        assert.equal(el("wallet-balance").textContent, "1000");
        assert.notEqual(el("wallet-button").textContent, "Connect wallet");
      },
    );
    // Restore the intended profile if the startup-race regression fails.
    if (el("price").textContent !== "150") {
      el("profile-file").dispatchEvent(new w.Event("change"));
      await until(
        () =>
          el("footer-state").textContent === "localnet profile loaded" &&
          !el("wallet-button").disabled,
        "profile did not recover",
      );
      await connect();
    }
    await t.test(
      "trade review separates the market base fee from the taker cap",
      async () => {
        const form = el("trade-form");
        form.elements.namedItem("size").value = "0.1";
        form.elements.namedItem("limitPrice").value = "150";
        form.dispatchEvent(new w.Event("submit", { cancelable: true }));
        await until(
          () => el("review-dialog").open && !el("wallet-button").disabled,
          "trade review did not open",
        );
        const fields = Object.fromEntries(
          [...el("review-details").children].map((row) => [
            row.querySelector("dt").textContent,
            row.querySelector("dd").textContent,
          ]),
        );
        assert.equal(fields["Current base fee"], "0%");
        assert.equal(fields["Base fee cap"], "0.1%");
        assert.match(fields["Engine fee limit"], /%$/);
        assert.match(fields["Fee policy"], /can exceed the base fee cap/);
        el("review-dialog").close();
      },
    );
    await t.test(
      "an empty asset list still updates portfolio data and clears the old chart",
      async () => {
        noAssets = true;
        el("refresh").click();
        await until(
          () =>
            el("wallet-balance").textContent === "2" &&
            !el("wallet-button").disabled,
          "empty market did not update balances",
        );
        assert.equal(el("market-title").textContent, "No enabled assets");
        assert.equal(el("price").textContent, "Not available");
        assert.equal(el("chart-empty").hidden, false);
        assert.equal(el("trade-review").disabled, true);
        assert.equal(el("capital").textContent, "0");
        noAssets = false;
        el("refresh").click();
        await until(
          () =>
            el("price").textContent === "150" && !el("wallet-button").disabled,
          "market did not recover",
        );
      },
    );
    for (const status of ["revoked", "expired"])
      await t.test(
        `${status === "expired" ? "an" : "a"} ${status} maker disables trade review`,
        async () => {
          makerStatus = status;
          el("refresh").click();
          await until(
            () =>
              el("maker-state").textContent === "Unavailable" &&
              !el("wallet-button").disabled,
            "maker change did not render",
          );
          assert.equal(el("trade-review").disabled, true);
          makerStatus = "enabled";
          el("refresh").click();
          await until(
            () =>
              el("maker-state").textContent === "Authorized" &&
              !el("wallet-button").disabled,
            "maker did not recover",
          );
        },
      );
    await t.test(
      "RPC failure clears actionable market data and recovery restores it",
      async () => {
        rejectRpc = true;
        el("refresh").click();
        await until(
          () =>
            el("feedback").textContent === "RPC unavailable" &&
            !el("wallet-button").disabled,
          "RPC error not reported",
        );
        unavailable();
        rejectRpc = false;
        el("refresh").click();
        await until(
          () =>
            el("price").textContent === "150" && !el("wallet-button").disabled,
          "RPC recovery did not reload the market",
        );
        assert.equal(el("trade-review").disabled, false);
      },
    );
    // Restore the session even when a regression above fails.
    rejectRpc = false;
    el("refresh").click();
    await until(() => !el("wallet-button").disabled, "refresh did not settle");
    await t.test(
      "disconnect clears old maker, network and receipt messages",
      async () => {
        w.localStorage.setItem(
          "outright.transaction.v1:" + f.client.scope(account.address),
          JSON.stringify({
            scope: f.client.scope(account.address),
            summary: "Previous action",
            status: "expiredUnresolved",
            signature: bs58.encode(Buffer.alloc(64, 7)),
          }),
        );
        el("refresh").click();
        await until(
          () =>
            el("receipt-state").textContent === "Expired, outcome unresolved" &&
            !el("wallet-button").disabled,
          "receipt did not load",
        );
        el("wallet-button").click();
        unavailable();
        assert.equal(
          el("receipt-state").textContent,
          "No transaction submitted",
        );
        assert.ok(!el("receipt-note").textContent.includes("unresolved"));
        w.localStorage.clear();
      },
    );
    await t.test(
      "an account losing signing support disconnects immediately",
      async () => {
        await connect();
        changed({ accounts: [{ ...account, features: [] }] });
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        unavailable();
      },
    );
    if (el("wallet-button").textContent !== "Connect wallet")
      el("wallet-button").click();
    await t.test(
      "a late RPC response cannot repopulate a disconnected wallet",
      async () => {
        await connect();
        let release;
        holdRpc = new Promise((resolve) => {
          release = resolve;
        });
        el("refresh").click();
        changed({ accounts: [] });
        release();
        holdRpc = null;
        await until(
          () => !el("wallet-button").disabled,
          "pending refresh did not settle",
        );
        unavailable();
        assert.equal(el("wallet-button").textContent, "Connect wallet");
      },
    );
    for (const outcome of ["submitted", "unknown", "receipt write failure"])
      await t.test(
        `a late ${outcome} result stays with the disconnected account`,
        async () => {
          await connect();
          const send = f.rpc.sendRawTransaction;
          const write = f.journal.write;
          const entered = Promise.withResolvers();
          const release = Promise.withResolvers();
          const before = f.rpc.sent.length;
          f.journal.write = async (scope, record) => {
            if (
              outcome === "receipt write failure" &&
              record.status !== "signed"
            )
              throw new Error("Receipt storage unavailable");
            await write(scope, record);
            w.localStorage.setItem(
              "outright.transaction.v1:" + scope,
              JSON.stringify(record),
            );
          };
          f.rpc.sendRawTransaction = async (bytes) => {
            const signature = await send(bytes);
            entered.resolve();
            await release.promise;
            if (outcome === "unknown") throw new Error("Send response lost");
            return signature;
          };
          try {
            el("trade-form").dispatchEvent(
              new w.Event("submit", { cancelable: true }),
            );
            await until(
              () => el("review-dialog").open && !el("sign").disabled,
              "trade review did not open",
            );
            el("sign").click();
            await entered.promise;
            const saved = await f.client.pending(account.address);
            assert.equal(saved.status, "signed");
            changed({ accounts: [] });
            release.resolve();
            await until(
              () => !el("wallet-button").disabled,
              "send response did not settle",
            );
            unavailable();
            assert.equal(
              el("receipt-state").textContent,
              "No transaction submitted",
            );
            assert.equal(el("receipt-link").hidden, true);
            assert.equal(
              el("feedback").textContent,
              "Wallet account changed. Reconnect the account you want to use.",
            );
            assert.equal(
              (await f.client.pending(account.address)).signature,
              saved.signature,
            );
            await connect();
            assert.equal(el("receipt-link").textContent, saved.signature);
            assert.equal(
              el("receipt-state").textContent,
              outcome === "submitted"
                ? "Sent, awaiting confirmation"
                : outcome === "unknown"
                  ? "Confirmation unknown"
                  : "Signature saved",
            );
            assert.equal(f.rpc.sent.length, before + 1);
          } finally {
            release.resolve();
            f.rpc.sendRawTransaction = send;
            f.journal.write = write;
            f.records.clear();
            w.localStorage.clear();
            if (el("wallet-button").textContent !== "Connect wallet")
              changed({ accounts: [] });
          }
        },
      );
    await t.test(
      "resolved market offers bounded settlement review and clears it on disconnect",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        const portfolioData = Buffer.from(
          f.accounts.get(f.identity.address.toBase58()).data,
        );
        try {
          setSettlement(f);
          await connect();
          assert.equal(el("settlement-panel").hidden, false);
          assert.equal(el("collateral-form").hidden, true);
          assert.equal(el("initialize").hidden, true);
          assert.equal(el("trade-review").disabled, true);
          assert.equal(el("settlement-face").textContent, "0.002");
          assert.equal(el("settlement-paid").textContent, "0.00125");
          assert.equal(el("settlement-due").textContent, "0.00025");
          for (const id of ["settlement-close", "settlement-claim"]) {
            assert.equal(el(id).disabled, false);
            el(id).click();
            await until(
              () => el("review-dialog").open && !el("sign").disabled,
              "settlement review did not open",
            );
            assert.match(el("review-details").textContent, /bounded step/);
            assert.match(
              el("review-details").textContent,
              /Maintenance fee per slot/,
            );
            assert.match(el("review-details").textContent, /0.00025 TEST/);
            el("review-dialog").close();
          }
          changed({ accounts: [] });
          assert.equal(el("settlement-panel").hidden, true);
          assert.equal(el("settlement-face").textContent, "Not available");
          assert.equal(el("settlement-due").textContent, "Not available");
          assert.equal(el("settlement-close").disabled, true);
        } finally {
          f.accounts.get(f.market.toBase58()).data = marketData;
          f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
          if (el("wallet-button").textContent !== "Connect wallet")
            changed({ accounts: [] });
        }
      },
    );
    await t.test(
      "zero-due settlement disables claims even without enabled assets",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        const portfolioData = Buffer.from(
          f.accounts.get(f.identity.address.toBase58()).data,
        );
        try {
          setSettlement(f, { receipt: { paid_effective: 1500n } });
          await connect();
          noAssets = true;
          el("refresh").click();
          await until(
            () =>
              el("market-title").textContent === "No enabled assets" &&
              !el("refresh").disabled,
            "resolved empty-assets refresh failed",
          );
          assert.equal(el("settlement-panel").hidden, false);
          assert.equal(el("settlement-due").textContent, "0");
          assert.equal(el("settlement-claim").disabled, true);
          assert.equal(el("settlement-close").disabled, false);
        } finally {
          noAssets = false;
          f.accounts.get(f.market.toBase58()).data = marketData;
          f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
          changed({ accounts: [] });
        }
      },
    );
    await t.test(
      "recovery market cannot expose resolved or live wallet actions",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        const portfolioData = Buffer.from(
          f.accounts.get(f.identity.address.toBase58()).data,
        );
        try {
          setSettlement(f, { market: { mode: 2 } });
          await connect();
          assert.equal(el("settlement-panel").hidden, true);
          assert.equal(el("settlement-close").disabled, true);
          assert.equal(el("settlement-claim").disabled, true);
          assert.equal(el("collateral-form").hidden, true);
          assert.equal(el("trade-review").disabled, true);
        } finally {
          f.accounts.get(f.market.toBase58()).data = marketData;
          f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
          changed({ accounts: [] });
        }
      },
    );
    await t.test(
      "unregistering multiple wallets clears the selected wallet",
      async () => {
        await connect();
        unregister();
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        unavailable();
      },
    );
  } finally {
    unregister();
    OutrightClient.prototype.snapshot = originalSnapshot;
    OutrightClient.prototype.prepare = originalPrepare;
    OutrightClient.prototype.submit = originalSubmit;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
