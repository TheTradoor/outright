import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { JSDOM } from "jsdom";
import bs58 from "bs58";
import contract from "../upstream-contract.json" with { type: "json" };
import { OutrightClient } from "../src/client.mjs";
import { fixture, pub, withMaker } from "./support/client-fixture.mjs";
import { setSettlement } from "./support/settlement-fixture.mjs";
import { setRecovery } from "./support/recovery-fixture.mjs";

// Execute the actual terminal module and HTML with deterministic wallet/RPC
// fixtures. This is DOM behavior coverage, not browser-extension or layout QA.
test("terminal recovers from unavailable RPC and wallet lifecycle changes", async (t) => {
  const f = await withMaker(await fixture());
  const dom = new JSDOM(
    await readFile(new URL("../terminal/index.html", import.meta.url), "utf8"),
    { url: "https://outright.test/trade/", pretendToBeVisual: true },
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
  let poll;
  setGlobal("setInterval", (work, interval) => {
    assert.equal(interval, 10_000);
    poll = work;
    return 0;
  });
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
  const originalReconcile = OutrightClient.prototype.reconcile;
  OutrightClient.prototype.prepare = function (...args) {
    return originalPrepare.apply(f.client, args);
  };
  OutrightClient.prototype.submit = function (...args) {
    return originalSubmit.apply(f.client, args);
  };
  OutrightClient.prototype.reconcile = function (...args) {
    return originalReconcile.apply(f.client, args);
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
    for (const outcome of ["success", "RPC failure"])
      await t.test(
        `a late simulation ${outcome} preserves the disconnected session`,
        { timeout: 15_000 },
        async () => {
          await connect();
          const simulate = f.rpc.simulateTransaction;
          const entered = Promise.withResolvers();
          const release = Promise.withResolvers();
          const before = f.rpc.sent.length;
          f.rpc.simulateTransaction = async (...args) => {
            entered.resolve();
            await release.promise;
            if (outcome === "RPC failure")
              throw new Error("Simulation RPC unavailable");
            return simulate(...args);
          };
          try {
            el("trade-form").dispatchEvent(
              new w.Event("submit", { cancelable: true }),
            );
            await entered.promise;
            changed({ accounts: [] });
            release.resolve();
            await until(
              () => !el("wallet-button").disabled,
              "simulation did not settle",
            );
            unavailable();
            assert.equal(el("review-dialog").open, false);
            assert.equal(
              el("feedback").textContent,
              "Wallet account changed. Reconnect the account you want to use.",
            );
            assert.equal(f.rpc.sent.length, before);
          } finally {
            release.resolve();
            f.rpc.simulateTransaction = simulate;
            if (el("wallet-button").textContent !== "Connect wallet")
              changed({ accounts: [] });
          }
        },
      );

    const seedPending = async () => {
      const review = await f.client.prepare(account.address, {
        type: "deposit",
        amount: "1",
      });
      const record = await f.client.submit(review, f.sign);
      w.localStorage.setItem(
        "outright.transaction.v1:" + record.scope,
        JSON.stringify(record),
      );
      return record;
    };
    for (const outcome of ["confirmed", "RPC failure"])
      await t.test(
        `a late reconciliation ${outcome} preserves the disconnected session`,
        { timeout: 15_000 },
        async () => {
          const savedReceipt = await seedPending();
          await connect();
          const status = f.rpc.getSignatureStatuses;
          const entered = Promise.withResolvers();
          const release = Promise.withResolvers();
          const before = f.rpc.sent.length;
          f.rpc.getSignatureStatuses = async () => {
            entered.resolve();
            await release.promise;
            if (outcome === "RPC failure")
              throw new Error("Confirmation RPC unavailable");
            return {
              context: { slot: 123 },
              value: [
                { slot: 123, confirmationStatus: "confirmed", err: null },
              ],
            };
          };
          try {
            el("reconcile").click();
            await entered.promise;
            changed({ accounts: [] });
            release.resolve();
            await until(
              () => !el("wallet-button").disabled,
              "reconciliation did not settle",
            );
            unavailable();
            assert.equal(el("receipt-link").hidden, true);
            assert.equal(
              el("receipt-state").textContent,
              "No transaction submitted",
            );
            assert.equal(
              el("feedback").textContent,
              "Wallet account changed. Reconnect the account you want to use.",
            );
            const retained = await f.journal.read(savedReceipt.scope);
            assert.equal(retained.signature, savedReceipt.signature);
            assert.equal(
              retained.status,
              outcome === "confirmed" ? "confirmed" : "submitted",
            );
            assert.equal(f.rpc.sent.length, before);
          } finally {
            release.resolve();
            f.rpc.getSignatureStatuses = status;
            f.records.clear();
            w.localStorage.clear();
            if (el("wallet-button").textContent !== "Connect wallet")
              changed({ accounts: [] });
          }
        },
      );

    for (const failure of [
      "RPC unavailable",
      "malformed status",
      "receipt write failure",
    ])
      await t.test(
        `reconciliation ${failure} disables stale actions and retains the saved signature`,
        { timeout: 15_000 },
        async () => {
          const savedReceipt = await seedPending();
          await connect();
          const status = f.rpc.getSignatureStatuses;
          const write = f.journal.write;
          const before = f.rpc.sent.length;
          const errorText =
            failure === "malformed status"
              ? "Invalid transaction status"
              : failure === "receipt write failure"
                ? "Receipt storage unavailable"
                : "Confirmation RPC unavailable";
          f.rpc.getSignatureStatuses = async () => {
            if (failure === "RPC unavailable") throw new Error(errorText);
            return {
              context: { slot: 123 },
              value: [
                {
                  slot: 123,
                  confirmationStatus:
                    failure === "malformed status" ? "invalid" : "confirmed",
                  err: null,
                },
              ],
            };
          };
          if (failure === "receipt write failure")
            f.journal.write = async () => {
              throw new Error(errorText);
            };
          try {
            el("reconcile").click();
            await until(
              () =>
                el("feedback").textContent === errorText &&
                !el("wallet-button").disabled,
              "reconciliation failure did not surface",
            );
            unavailable();
            assert.equal(el("initialize").disabled, true);
            for (const button of el("collateral-form").querySelectorAll(
              "button",
            ))
              assert.equal(button.disabled, true);
            assert.equal(
              el("receipt-link").textContent,
              savedReceipt.signature,
            );
            assert.equal(el("reconcile").hidden, false);
            assert.deepEqual(
              await f.journal.read(savedReceipt.scope),
              savedReceipt,
            );
            f.journal.write = async (scope, record) => {
              await write(scope, record);
              w.localStorage.setItem(
                "outright.transaction.v1:" + scope,
                JSON.stringify(record),
              );
            };
            f.rpc.getSignatureStatuses = async () => ({
              context: { slot: 123 },
              value: [
                { slot: 123, confirmationStatus: "confirmed", err: null },
              ],
            });
            el("reconcile").click();
            await until(
              () =>
                el("receipt-state").textContent === "Confirmed on Solana" &&
                !el("wallet-button").disabled,
              "reconciliation did not recover",
            );
            assert.equal(el("price").textContent, "150");
            assert.equal(el("trade-review").disabled, false);
            assert.equal(el("reconcile").hidden, true);
            assert.equal(f.rpc.sent.length, before);
          } finally {
            f.rpc.getSignatureStatuses = status;
            f.journal.write = write;
            f.records.clear();
            w.localStorage.clear();
            if (el("wallet-button").textContent !== "Connect wallet")
              changed({ accounts: [] });
          }
        },
      );

    await t.test(
      "an obsolete poll cannot clear or reread the refreshed wallet session",
      { timeout: 15_000 },
      async () => {
        const savedReceipt = await seedPending();
        await connect();
        const status = f.rpc.getSignatureStatuses;
        const read = f.rpc.getMultipleAccountsInfoAndContext;
        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        const before = f.rpc.sent.length;
        let accountReads = 0;
        f.rpc.getSignatureStatuses = async () => {
          entered.resolve();
          await release.promise;
          throw new Error("Old-session RPC unavailable");
        };
        f.rpc.getMultipleAccountsInfoAndContext = async (...args) => {
          accountReads++;
          return read(...args);
        };
        try {
          poll();
          await entered.promise;
          changed({ accounts: [{ ...account }] });
          await until(
            () => el("footer-state").textContent === "localnet connected",
            "replacement session did not refresh",
          );
          release.resolve();
          await until(
            () => !el("wallet-button").disabled,
            "old poll did not settle",
          );
          assert.equal(el("price").textContent, "150");
          assert.equal(el("trade-review").disabled, false);
          assert.equal(el("feedback").textContent, "");
          assert.equal(el("receipt-link").textContent, savedReceipt.signature);
          assert.equal(accountReads, 1);
          assert.deepEqual(
            await f.journal.read(savedReceipt.scope),
            savedReceipt,
          );
          assert.equal(f.rpc.sent.length, before);
        } finally {
          release.resolve();
          f.rpc.getSignatureStatuses = status;
          f.rpc.getMultipleAccountsInfoAndContext = read;
          f.records.clear();
          w.localStorage.clear();
          if (el("wallet-button").textContent !== "Connect wallet")
            changed({ accounts: [] });
        }
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
      "a failed deposit keeps its receipt until a fresh blockhash permits a new review",
      async () => {
        const latest = f.rpc.getLatestBlockhashAndContext;
        const sign = f.sign;
        try {
          const action = { type: "deposit", amount: "1" };
          const review = await f.client.prepare(account.address, action);
          const sent = await f.client.submit(review, f.sign);
          f.rpc.status = {
            slot: 123,
            confirmationStatus: "confirmed",
            err: { InstructionError: [2, "InvalidArgument"] },
          };
          const failed = await f.client.reconcile(account.address);
          w.localStorage.setItem(
            "outright.transaction.v1:" + f.client.scope(account.address),
            JSON.stringify(failed),
          );
          await connect();
          assert.equal(el("receipt-link").textContent, sent.signature);
          let prompts = 0;
          f.sign = async (bytes) => {
            prompts++;
            return sign(bytes);
          };
          const before = f.rpc.sent.length;
          const form = el("collateral-form");
          form.elements.namedItem("amount").value = "1";
          const deposit = form.querySelector('button[value="deposit"]');
          deposit.click();
          await until(
            () =>
              el("feedback").textContent.includes("new blockhash") &&
              !el("wallet-button").disabled,
            "repeat deposit did not report the blockhash wait",
          );
          assert.equal(el("review-dialog").open, false);
          assert.equal(el("receipt-link").textContent, sent.signature);
          assert.deepEqual(
            await f.journal.read(f.client.scope(account.address)),
            failed,
          );
          f.rpc.getLatestBlockhashAndContext = async () => ({
            context: { slot: 123 },
            value: { blockhash: pub(24).toBase58(), lastValidBlockHeight: 201 },
          });
          deposit.click();
          await until(
            () => el("review-dialog").open && !el("sign").disabled,
            "fresh deposit review did not open",
          );
          assert.equal(prompts, 0);
          assert.equal(f.rpc.sent.length, before);
          assert.equal(el("receipt-link").textContent, sent.signature);
          el("review-dialog").close();
        } finally {
          f.sign = sign;
          f.rpc.getLatestBlockhashAndContext = latest;
          f.rpc.status = null;
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
          assert.equal(el("portfolio-close").disabled, true);
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
    for (const id of ["settlement-close", "settlement-claim"])
      await t.test(
        `${id} clears a changed review without sending`,
        async () => {
          const marketData = Buffer.from(
            f.accounts.get(f.market.toBase58()).data,
          );
          const portfolioData = Buffer.from(
            f.accounts.get(f.identity.address.toBase58()).data,
          );
          const sign = f.sign;
          const sent = f.rpc.sent.length;
          try {
            setSettlement(f);
            await connect();
            el(id).click();
            await until(
              () => el("review-dialog").open && !el("sign").disabled,
              "settlement review did not open",
            );
            f.sign = async (bytes) => {
              const offset =
                contract.constants.headerLength +
                contract.layouts.reviewAccountingOffsets.closeResidual;
              f.accounts.get(f.identity.address.toBase58()).data[offset] ^= 1;
              return sign(bytes);
            };
            el("sign").click();
            await until(
              () =>
                el("feedback").textContent ===
                  "Settlement state changed; review the action again" &&
                !el("wallet-button").disabled,
              "changed settlement review did not report the rejection",
            );
            assert.equal(el("review-dialog").open, false);
            assert.equal(f.rpc.sent.length, sent);
            assert.equal(await f.client.pending(account.address), null);
            assert.equal(
              el("receipt-state").textContent,
              "No transaction submitted",
            );
            f.sign = sign;
            el(id).click();
            await until(
              () => el("review-dialog").open && !el("sign").disabled,
              "a new settlement review could not be opened",
            );
            el("review-dialog").close();
          } finally {
            f.sign = sign;
            f.accounts.get(f.market.toBase58()).data = marketData;
            f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
            if (el("wallet-button").textContent !== "Connect wallet")
              changed({ accounts: [] });
          }
        },
      );
    await t.test(
      "account closure explains the SOL destination and clears controls after removal",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        const portfolioAccount = {
          ...f.accounts.get(f.identity.address.toBase58()),
          data: Buffer.from(f.accounts.get(f.identity.address.toBase58()).data),
        };
        const before = f.rpc.sent.length;
        try {
          setSettlement(f, {
            receipt: { paid_effective: 2000n, finalized: true },
          });
          await connect();
          assert.equal(el("portfolio-close").disabled, false);
          el("portfolio-close").click();
          await until(
            () => el("review-dialog").open && !el("sign").disabled,
            "closure review did not open",
          );
          assert.match(
            el("review-details").textContent,
            /All SOL held by this portfolio account/,
          );
          assert.match(
            el("review-details").textContent,
            /not returned to your wallet/,
          );
          assert.ok(
            el("review-details").textContent.includes(f.market.toBase58()),
          );
          el("sign").click();
          await until(
            () => !el("review-dialog").open && !el("wallet-button").disabled,
            "closure submit did not settle",
          );
          assert.equal(f.rpc.sent.length, before + 1);
          f.rpc.status = {
            slot: 123,
            confirmations: 1,
            err: null,
            confirmationStatus: "confirmed",
          };
          await f.client.reconcile(account.address);
          f.accounts.delete(f.identity.address.toBase58());
          el("refresh").click();
          await until(
            () =>
              el("settlement-status").textContent ===
                "No portfolio for this wallet." && !el("refresh").disabled,
            "closed account refresh failed",
          );
          for (const id of [
            "portfolio-close",
            "settlement-close",
            "settlement-claim",
          ])
            assert.equal(el(id).disabled, true);
        } finally {
          f.accounts.get(f.market.toBase58()).data = marketData;
          f.accounts.set(f.identity.address.toBase58(), portfolioAccount);
          f.records.clear();
          f.rpc.status = null;
          if (el("wallet-button").textContent !== "Connect wallet")
            changed({ accounts: [] });
        }
      },
    );
    await t.test(
      "a closed market clears wallet actions and explains the stopped deployment",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        try {
          await connect();
          f.accounts.get(f.market.toBase58()).data = Buffer.from(
            contract.closedMarketFixtureHex,
            "hex",
          );
          el("refresh").click();
          await until(
            () =>
              el("feedback").textContent.includes("Market has been closed") &&
              !el("wallet-button").disabled,
            "closed market message missing",
          );
          unavailable();
          assert.equal(el("portfolio-close").disabled, true);
        } finally {
          f.accounts.get(f.market.toBase58()).data = marketData;
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
      "recovery exit requires consent and explains the budget before signing",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        const portfolioData = Buffer.from(
          f.accounts.get(f.identity.address.toBase58()).data,
        );
        try {
          setRecovery(f);
          await connect();
          assert.equal(el("recovery-panel").hidden, false);
          assert.equal(el("trade-review").disabled, true);
          assert.equal(el("recovery-review").disabled, true);
          el("recovery-budget").value = "0.000001";
          el("recovery-budget").dispatchEvent(new w.Event("input"));
          assert.equal(el("recovery-review").disabled, true);
          el("recovery-consent").checked = true;
          el("recovery-consent").dispatchEvent(new w.Event("change"));
          assert.equal(el("recovery-review").disabled, false);
          el("recovery-review").click();
          await until(
            () => el("review-dialog").open && !el("sign").disabled,
            "recovery review did not open",
          );
          assert.match(
            el("review-summary").textContent,
            /Forfeit unbooked gains/,
          );
          assert.match(el("review-details").textContent, /0.000001 TEST/);
          assert.match(
            el("review-details").textContent,
            /does not cap price or funding losses/,
          );
          assert.match(el("review-details").textContent, /No token withdrawal/);
          changed({ accounts: [] });
          assert.equal(el("review-dialog").open, false);
          assert.equal(el("recovery-panel").hidden, true);
          assert.equal(el("recovery-consent").checked, false);
          assert.equal(el("recovery-budget").value, "");
          assert.equal(el("recovery-review").disabled, true);
        } finally {
          f.accounts.get(f.market.toBase58()).data = marketData;
          f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
          if (el("wallet-button").textContent !== "Connect wallet")
            changed({ accounts: [] });
        }
      },
    );
    for (const side of [0, 1])
      await t.test(
        `zero-exposure ${side === 0 ? "long" : "short"} obligation renders as pending cleanup`,
        async () => {
          const marketData = Buffer.from(
            f.accounts.get(f.market.toBase58()).data,
          );
          const portfolioData = Buffer.from(
            f.accounts.get(f.identity.address.toBase58()).data,
          );
          try {
            setRecovery(f, { side, leg: { basis_pos_q: 0n } });
            await connect();
            assert.equal(el("position-count").textContent, "1");
            const cells = el("positions").querySelectorAll("td");
            assert.equal(cells[1].textContent, side === 0 ? "Long" : "Short");
            assert.equal(cells[2].textContent, "0");
            assert.equal(cells[4].textContent, "Pending cleanup");
            assert.equal(el("recovery-panel").hidden, false);
            assert.equal(el("recovery-review").disabled, true);
            assert.equal(el("trade-review").disabled, true);
            assert.equal(el("settlement-panel").hidden, true);
          } finally {
            f.accounts.get(f.market.toBase58()).data = marketData;
            f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
            changed({ accounts: [] });
          }
        },
      );
    await t.test(
      "ordinary live positions do not offer a recovery forfeiture",
      async () => {
        const marketData = Buffer.from(
          f.accounts.get(f.market.toBase58()).data,
        );
        const portfolioData = Buffer.from(
          f.accounts.get(f.identity.address.toBase58()).data,
        );
        try {
          setRecovery(f, { lifecycle: 2 });
          await connect();
          assert.equal(el("recovery-panel").hidden, true);
          assert.equal(el("recovery-review").disabled, true);
        } finally {
          f.accounts.get(f.market.toBase58()).data = marketData;
          f.accounts.get(f.identity.address.toBase58()).data = portfolioData;
          changed({ accounts: [] });
        }
      },
    );
    await t.test(
      "unsupported collateral decimals leave the active profile unchanged",
      async () => {
        const profile = {
          ...f.profile,
          collateral: { ...f.profile.collateral, decimals: 9 },
        };
        Object.defineProperty(el("profile-file"), "files", {
          configurable: true,
          value: [{ size: 4096, text: async () => JSON.stringify(profile) }],
        });
        el("profile-file").dispatchEvent(new w.Event("change"));
        await until(
          () =>
            /collateral decimals/.test(el("profile-error").textContent) &&
            !el("wallet-button").disabled,
          "invalid decimal profile was not rejected",
        );
        await connect();
        assert.equal(el("wallet-balance").textContent, "1000");
        changed({ accounts: [] });
        Object.defineProperty(el("profile-file"), "files", {
          configurable: true,
          value: [{ size: 4096, text: async () => JSON.stringify(f.profile) }],
        });
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
    OutrightClient.prototype.reconcile = originalReconcile;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
