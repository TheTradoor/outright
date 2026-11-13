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
    { url: "https://outright.test/trade/?operator=1", pretendToBeVisual: true },
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
    const choose = (candidate = wallet) => {
      el("wallet-button").click();
      [...el("wallet-list").querySelectorAll("button")]
        .find((b) => b.textContent === candidate.name)
        .click();
    };
    const choiceSettled = () =>
      until(
        () => !el("wallet-button").disabled,
        "wallet choice did not settle",
      );
    const choiceError = (pattern) => {
      const error = el("wallet-dialog").querySelector('[role="alert"]');
      assert.ok(
        error && !error.hidden,
        "connection error must be inside the open chooser",
      );
      assert.match(error.textContent, pattern);
      assert.equal(el("wallet-dialog").open, true);
      assert.equal(el("wallet-button").textContent, "Connect wallet");
    };
    const choiceCase = (name, work) =>
      t.test(name, { timeout: 15_000 }, async () => {
        changed({ accounts: [] });
        const previousConnect = wallet.features["standard:connect"].connect;
        const previousAccounts = wallet.accounts;
        const sent = f.rpc.sent.length;
        try {
          await work();
        } finally {
          wallet.features["standard:connect"].connect = previousConnect;
          wallet.accounts = previousAccounts;
          if (el("wallet-dialog").open) el("wallet-dialog").close();
          changed({ accounts: [] });
          await choiceSettled();
          assert.equal(
            f.rpc.sent.length,
            sent,
            "wallet selection must not send a transaction",
          );
        }
      });
    await choiceCase(
      "wallet connection rejection is visible in the chooser and retry succeeds",
      async () => {
        const connectWallet = wallet.features["standard:connect"].connect;
        wallet.features["standard:connect"].connect = async () => {
          throw new Error("Connection rejected by wallet");
        };
        choose();
        await choiceSettled();
        choiceError(/Connection rejected by wallet/);
        wallet.features["standard:connect"].connect = connectWallet;
        [...el("wallet-list").querySelectorAll("button")]
          .find((b) => b.textContent === wallet.name)
          .click();
        await choiceSettled();
        assert.equal(el("wallet-dialog").open, false);
        assert.equal(el("price").textContent, "150");
        assert.equal(el("wallet-error").hidden, true);
      },
    );
    for (const rejected of [false, true])
      await choiceCase(
        `closing wallet selection ignores a late ${rejected ? "rejection" : "approval"}`,
        async () => {
          let resolve, reject;
          const pending = new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          });
          wallet.features["standard:connect"].connect = () => pending;
          try {
            choose();
            el("wallet-dialog").close();
            if (rejected) reject(new Error("Late connection rejection"));
            else resolve({ accounts: [account] });
            await choiceSettled();
            assert.equal(el("wallet-button").textContent, "Connect wallet");
            assert.equal(el("wallet-dialog").open, false);
            assert.equal(
              el("feedback").hidden,
              true,
              "canceled connection must not overwrite current feedback",
            );
            unavailable();
          } finally {
            resolve({ accounts: [account] });
            await choiceSettled();
          }
        },
      );
    await choiceCase(
      "an unregistered wallet cannot attach after its connection resolves",
      async () => {
        let resolve;
        const pending = new Promise((yes) => {
          resolve = yes;
        });
        const candidate = {
          ...wallet,
          name: "Removed wallet",
          features: {
            ...wallet.features,
            "standard:connect": { version: "1.0.0", connect: () => pending },
          },
        };
        const remove = registry.register(candidate);
        try {
          choose(candidate);
          remove();
          resolve({ accounts: [account] });
          await choiceSettled();
          assert.equal(el("wallet-button").textContent, "Connect wallet");
          unavailable();
          choiceError(/no longer available/i);
        } finally {
          resolve({ accounts: [account] });
          await choiceSettled();
          remove();
        }
      },
    );
    await choiceCase(
      "a stale connect result cannot authorize an account the wallet has removed",
      async () => {
        wallet.features["standard:connect"].connect = async () => {
          wallet.accounts = [];
          return { accounts: [account] };
        };
        choose();
        await choiceSettled();
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        unavailable();
        choiceError(/account.*network|account.*available/i);
      },
    );
    const otherAccount = {
      ...account,
      address: pub(45).toBase58(),
      publicKey: pub(45).toBytes(),
    };
    for (const lost of ["authorization", "signing support"])
      await choiceCase(`account selection rechecks lost ${lost}`, async () => {
        wallet.accounts = [account, otherAccount];
        wallet.features["standard:connect"].connect = async () => ({
          accounts: [account, otherAccount],
        });
        choose();
        await choiceSettled();
        const choice = [...el("wallet-list").querySelectorAll("button")].find(
          (b) => b.textContent === account.address,
        );
        assert.ok(choice, "account choices must be visible");
        wallet.accounts =
          lost === "authorization"
            ? [otherAccount]
            : [{ ...account, features: [] }, otherAccount];
        choice.click();
        await choiceSettled();
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        unavailable();
        choiceError(/account.*available/i);
      });
    await choiceCase(
      "a current authorized replacement account remains selectable",
      async () => {
        wallet.accounts = [account, otherAccount];
        wallet.features["standard:connect"].connect = async () => ({
          accounts: [account, otherAccount],
        });
        choose();
        await choiceSettled();
        const choice = [...el("wallet-list").querySelectorAll("button")].find(
          (b) => b.textContent === account.address,
        );
        wallet.accounts = [{ ...account }, otherAccount];
        choice.click();
        await choiceSettled();
        assert.equal(el("wallet-dialog").open, false);
        assert.equal(el("price").textContent, "150");
        assert.equal(el("trade-review").disabled, false);
      },
    );
    await connect();
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

    const prepareTrade = async () => {
      el("trade-form").dispatchEvent(
        new w.Event("submit", { cancelable: true }),
      );
      await until(
        () => el("review-dialog").open && !el("sign").disabled,
        "trade review did not open",
      );
    };
    await t.test(
      "review cancellation stays unavailable from the wallet prompt through broadcast",
      { timeout: 15_000 },
      async () => {
        await connect();
        const sign = f.sign,
          read = f.rpc.getMultipleAccountsInfoAndContext,
          send = f.rpc.sendRawTransaction,
          write = f.journal.write;
        const walletEntered = Promise.withResolvers(),
          walletRelease = Promise.withResolvers();
        const verifyEntered = Promise.withResolvers(),
          verifyRelease = Promise.withResolvers();
        const sendEntered = Promise.withResolvers(),
          sendRelease = Promise.withResolvers();
        let holdVerification = false,
          prompts = 0;
        const before = f.rpc.sent.length;
        f.sign = async (bytes) => {
          prompts++;
          const result = await sign(bytes);
          walletEntered.resolve();
          await walletRelease.promise;
          return result;
        };
        f.rpc.getMultipleAccountsInfoAndContext = async (...args) => {
          if (holdVerification) {
            holdVerification = false;
            verifyEntered.resolve();
            await verifyRelease.promise;
          }
          return read(...args);
        };
        f.rpc.sendRawTransaction = async (bytes) => {
          const signature = await send(bytes);
          sendEntered.resolve();
          await sendRelease.promise;
          return signature;
        };
        f.journal.write = async (scope, record) => {
          await write(scope, record);
          w.localStorage.setItem(
            "outright.transaction.v1:" + scope,
            JSON.stringify(record),
          );
        };
        const cancel = el("review-dialog").querySelector(
          '[aria-label="Cancel transaction review"]',
        );
        const locked = () => {
          assert.equal(
            cancel.disabled,
            true,
            "Cancel must not imply it can undo an active submission",
          );
          const event = new w.Event("cancel", { cancelable: true });
          el("review-dialog").dispatchEvent(event);
          assert.equal(
            event.defaultPrevented,
            true,
            "Escape must not dismiss an active submission",
          );
          const closeForm = new w.Event("submit", { cancelable: true });
          el("review-dialog").querySelector("form").dispatchEvent(closeForm);
          assert.equal(closeForm.defaultPrevented, true);
          assert.equal(el("review-dialog").open, true);
          assert.equal(el("sign").disabled, true);
          assert.equal(el("review-progress").hidden, false);
        };
        try {
          await prepareTrade();
          assert.equal(cancel.disabled, false);
          el("review-dialog").close();
          assert.equal(prompts, 0);
          assert.equal(f.rpc.sent.length, before);
          await prepareTrade();
          holdVerification = true;
          el("sign").click();
          await walletEntered.promise;
          locked();
          assert.match(el("review-progress").textContent, /wallet/i);
          el("sign").click();
          assert.equal(prompts, 1);
          walletRelease.resolve();
          await verifyEntered.promise;
          locked();
          assert.match(el("review-progress").textContent, /verifying/i);
          verifyRelease.resolve();
          await sendEntered.promise;
          locked();
          sendRelease.resolve();
          await until(
            () => !el("wallet-button").disabled,
            "submission did not finish",
          );
          assert.equal(el("review-dialog").open, false);
          assert.equal(cancel.disabled, false);
          assert.equal(el("review-progress").hidden, true);
          assert.equal(
            el("receipt-state").textContent,
            "Sent, awaiting confirmation",
          );
          assert.equal(f.rpc.sent.length, before + 1);
        } finally {
          walletRelease.resolve();
          verifyRelease.resolve();
          sendRelease.resolve();
          await until(
            () => !el("wallet-button").disabled,
            "submission did not settle during cleanup",
          );
          f.sign = sign;
          f.rpc.getMultipleAccountsInfoAndContext = read;
          f.rpc.sendRawTransaction = send;
          f.journal.write = write;
          f.records.clear();
          w.localStorage.clear();
          changed({ accounts: [] });
        }
      },
    );
    for (const outcome of [
      "acknowledged",
      "response lost",
      "receipt unreadable",
      "previous final receipt",
    ])
      await t.test(
        `post-send persistence failure preserves recovery: ${outcome}`,
        { timeout: 15_000 },
        async () => {
          const write = f.journal.write,
            send = f.rpc.sendRawTransaction,
            getItem = w.Storage.prototype.getItem,
            latest = f.rpc.getLatestBlockhashAndContext;
          let unreadable = false,
            previousSignature;
          const mirror = async (scope, record) => {
            await write(scope, record);
            w.localStorage.setItem(
              "outright.transaction.v1:" + scope,
              JSON.stringify(record),
            );
          };
          try {
            if (outcome === "previous final receipt") {
              const old = await seedPending();
              previousSignature = old.signature;
              f.rpc.status = {
                slot: 123,
                confirmationStatus: "confirmed",
                err: null,
              };
              const final = await f.client.reconcile(account.address);
              w.localStorage.setItem(
                "outright.transaction.v1:" + final.scope,
                JSON.stringify(final),
              );
              f.rpc.getLatestBlockhashAndContext = async () => ({
                context: { slot: 123 },
                value: {
                  blockhash: pub(24).toBase58(),
                  lastValidBlockHeight: 201,
                },
              });
            }
            f.rpc.status = null;
            await connect();
            const before = f.rpc.sent.length;
            f.journal.write = async (scope, record) => {
              if (record.status !== "signed") {
                unreadable = outcome === "receipt unreadable";
                throw new Error("Receipt status could not be saved");
              }
              await mirror(scope, record);
            };
            w.Storage.prototype.getItem = function (key) {
              if (unreadable) throw new Error("Receipt reads unavailable");
              return getItem.call(this, key);
            };
            f.rpc.sendRawTransaction = async (bytes) => {
              const signature = await send(bytes);
              if (outcome === "response lost")
                throw new Error("Send response lost");
              return signature;
            };
            await prepareTrade();
            el("sign").click();
            await until(
              () => !el("wallet-button").disabled,
              "send failure did not settle",
            );
            const pending = await f.client.pending(account.address);
            assert.equal(pending.status, "signed");
            assert.equal(f.rpc.sent.length, before + 1);
            assert.equal(el("review-dialog").open, false);
            assert.match(
              el("feedback").textContent,
              /Receipt status could not be saved/,
            );
            unavailable();
            if (unreadable) {
              assert.equal(
                el("receipt-state").textContent,
                "Receipt unavailable",
              );
              assert.equal(el("receipt-link").hidden, true);
              unreadable = false;
              el("refresh").click();
              await until(
                () => !el("wallet-button").disabled,
                "storage recovery did not refresh",
              );
            }
            assert.equal(el("receipt-state").textContent, "Signature saved");
            assert.equal(el("receipt-link").hidden, false);
            assert.equal(el("receipt-link").textContent, pending.signature);
            if (previousSignature)
              assert.notEqual(pending.signature, previousSignature);
            f.journal.write = mirror;
            f.rpc.status = {
              slot: 123,
              confirmationStatus: "confirmed",
              err: null,
            };
            el("reconcile").click();
            await until(
              () =>
                el("receipt-state").textContent === "Confirmed on Solana" &&
                !el("wallet-button").disabled,
              "saved signature did not recover",
            );
            assert.equal(el("price").textContent, "150");
            assert.equal(f.rpc.sent.length, before + 1);
          } finally {
            unreadable = false;
            w.Storage.prototype.getItem = getItem;
            f.journal.write = write;
            f.rpc.sendRawTransaction = send;
            f.rpc.getLatestBlockhashAndContext = latest;
            f.rpc.status = null;
            f.records.clear();
            w.localStorage.clear();
            changed({ accounts: [] });
          }
        },
      );
    for (const status of ["confirmed", "finalized", "failed"])
      await t.test(
        `submission failure recovers a receipt already ${status} by another tab`,
        { timeout: 15_000 },
        async () => {
          const write = f.journal.write,
            lock = f.journal.withLock;
          const mirror = async (scope, record) => {
            await write(scope, record);
            w.localStorage.setItem(
              "outright.transaction.v1:" + scope,
              JSON.stringify(record),
            );
          };
          let recover = false,
            settled;
          try {
            await connect();
            const before = f.rpc.sent.length;
            f.journal.write = async (scope, record) => {
              if (record.status !== "signed") {
                recover = true;
                throw new Error("Receipt status could not be saved");
              }
              await mirror(scope, record);
            };
            f.journal.withLock = async (scope, work) => {
              try {
                return await lock(scope, work);
              } catch (error) {
                // The send lock is released before a different tab can reconcile.
                if (recover) {
                  recover = false;
                  f.journal.write = mirror;
                  f.rpc.status = {
                    slot: 123,
                    confirmationStatus:
                      status === "finalized" ? "finalized" : "confirmed",
                    err:
                      status === "failed"
                        ? { InstructionError: [2, "InvalidArgument"] }
                        : null,
                  };
                  const second = new OutrightClient(f.profile, {
                    connection: f.rpc,
                    journal: f.journal,
                  });
                  settled = await originalReconcile.call(
                    second,
                    account.address,
                  );
                }
                throw error;
              }
            };
            await prepareTrade();
            el("sign").click();
            await until(
              () => !el("wallet-button").disabled,
              "submission recovery did not settle",
            );
            assert.equal(settled.status, status);
            assert.equal(await f.client.pending(account.address), null);
            assert.equal(el("receipt-link").hidden, false);
            assert.equal(el("receipt-link").textContent, settled.signature);
            assert.equal(
              el("receipt-state").textContent,
              {
                confirmed: "Confirmed on Solana",
                finalized: "Finalized on Solana",
                failed: "Failed on Solana",
              }[status],
            );
            assert.equal(el("reconcile").hidden, true);
            unavailable();
            el("refresh").click();
            await until(
              () => !el("wallet-button").disabled,
              "final receipt refresh did not settle",
            );
            assert.equal(el("price").textContent, "150");
            assert.equal(el("receipt-link").textContent, settled.signature);
            assert.equal(f.rpc.sent.length, before + 1);
          } finally {
            f.journal.write = write;
            f.journal.withLock = lock;
            f.rpc.status = null;
            f.records.clear();
            w.localStorage.clear();
            changed({ accounts: [] });
          }
        },
      );
    await t.test(
      "refresh cannot pair a newer receipt with older account balances",
      { timeout: 15_000 },
      async () => {
        const savedReceipt = await seedPending();
        await connect();
        const snapshotRead = OutrightClient.prototype.snapshot;
        let newer = false,
          currentBank = false;
        OutrightClient.prototype.snapshot = async function (...args) {
          const result = await snapshotRead.apply(this, args);
          if (!newer) {
            newer = true;
            w.localStorage.setItem(
              "outright.transaction.v1:" + savedReceipt.scope,
              JSON.stringify({
                ...savedReceipt,
                status: "confirmed",
                minimumSlot: 140,
                confirmedSlot: 140,
              }),
            );
          }
          return currentBank ? { ...result, slot: 140 } : result;
        };
        try {
          const before = f.rpc.sent.length;
          el("refresh").click();
          await until(
            () => !el("wallet-button").disabled,
            "receipt race did not settle",
          );
          unavailable();
          assert.equal(el("receipt-state").textContent, "Confirmed on Solana");
          assert.equal(el("receipt-link").textContent, savedReceipt.signature);
          assert.match(el("feedback").textContent, /receipt|snapshot/i);
          currentBank = true;
          el("refresh").click();
          await until(
            () => !el("wallet-button").disabled,
            "fresh balance read did not settle",
          );
          assert.equal(el("price").textContent, "150");
          assert.equal(
            el("snapshot-label").textContent,
            "Confirmed snapshot / slot 140",
          );
          assert.equal(f.rpc.sent.length, before);
        } finally {
          OutrightClient.prototype.snapshot = snapshotRead;
          f.records.clear();
          w.localStorage.clear();
          changed({ accounts: [] });
        }
      },
    );
    await t.test(
      "a late submission receipt lookup cannot repopulate a disconnected wallet",
      { timeout: 15_000 },
      async () => {
        await connect();
        const write = f.journal.write,
          receipt = OutrightClient.prototype.receipt;
        const release = Promise.withResolvers();
        let lookupStarted = false,
          holdLookup = false;
        const before = f.rpc.sent.length;
        OutrightClient.prototype.receipt = async function (owner) {
          const record = await receipt.call(this, owner);
          if (this !== f.client && holdLookup) {
            lookupStarted = true;
            await release.promise;
          }
          return record;
        };
        f.journal.write = async (scope, record) => {
          if (record.status !== "signed") {
            holdLookup = true;
            throw new Error("Receipt status could not be saved");
          }
          await write(scope, record);
          w.localStorage.setItem(
            "outright.transaction.v1:" + scope,
            JSON.stringify(record),
          );
        };
        try {
          await prepareTrade();
          el("sign").click();
          await until(
            () => lookupStarted || !el("wallet-button").disabled,
            "receipt recovery did not start",
          );
          assert.equal(
            lookupStarted,
            true,
            "submission failure must recover the saved receipt",
          );
          changed({ accounts: [] });
          release.resolve();
          await until(
            () => !el("wallet-button").disabled,
            "late lookup did not settle",
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
          assert.equal(
            (await f.client.pending(account.address)).status,
            "signed",
          );
          assert.equal(f.rpc.sent.length, before + 1);
        } finally {
          release.resolve();
          await until(
            () => !el("wallet-button").disabled,
            "lookup cleanup did not settle",
          );
          OutrightClient.prototype.receipt = receipt;
          f.journal.write = write;
          f.records.clear();
          w.localStorage.clear();
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
