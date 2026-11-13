import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { fixture, withMaker } from "./support/client-fixture.mjs";

// Exercise the shipped page in its default trader mode. Network responses are
// controlled here; no wallet extension, external RPC or funds are involved.
test("trader onboarding loads the official market without operator setup", async (t) => {
  const f = await withMaker(await fixture());
  const dom = new JSDOM(
    await readFile(new URL("../terminal/index.html", import.meta.url), "utf8"),
    { url: "https://outright.test/trade/", pretendToBeVisual: true },
  );
  const w = dom.window,
    el = (id) => w.document.getElementById(id);
  const saved = new Map();
  const replace = (name, value) => {
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
    replace(name, name === "window" ? w : w[name]);
  replace(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  replace("setInterval", () => 0);
  const requests = [],
    deadlines = new Map();
  const originalTimeout = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  replace("setTimeout", (work, delay, ...args) => {
    if (delay !== 15_000) return originalTimeout(work, delay, ...args);
    const id = Symbol("market timeout");
    deadlines.set(id, work);
    return id;
  });
  replace("clearTimeout", (id) => {
    if (!deadlines.delete(id)) originalClear(id);
  });
  replace(
    "fetch",
    (url, options) =>
      new Promise((resolve, reject) => {
        assert.ok(String(url).endsWith("/deployment.json"));
        assert.equal(options.cache, "no-store");
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        requests.push({ resolve, reject, signal: options.signal });
      }),
  );
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
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  const until = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await pause(5);
    }
    assert.fail("onboarding did not reach the expected state");
  };
  const state = () => el("deployment-notice").dataset.state;
  const respond = async (body, expected, status = 200) => {
    requests.at(-1).resolve(new Response(body, { status }));
    await until(() => state() === expected);
  };
  const retry = () => {
    const count = requests.length;
    el("market-retry").click();
    assert.equal(requests.length, count + 1);
    assert.equal(state(), "loading");
    assert.equal(el("market-retry").hidden, true);
    assert.equal(el("wallet-button").disabled, true);
  };
  const locked = () => {
    assert.equal(el("wallet-button").disabled, true);
    assert.equal(el("initialize").disabled, true);
    assert.equal(el("trade-review").disabled, true);
    assert.equal(el("settings-dialog").open, false);
    assert.equal(el("operator-notice").hidden, true);
  };
  try {
    await import("../terminal/terminal.mjs");
    await t.test(
      "startup is automatic and cannot open operator settings",
      async () => {
        assert.equal(requests.length, 1);
        assert.equal(state(), "loading");
        locked();
        assert.equal(el("settings-button").hidden, true);
        assert.equal(el("profile-file").disabled, true);
        // Dispatching an event directly also cannot bypass the trader-mode guard.
        el("settings-button").dispatchEvent(new w.Event("click"));
        Object.defineProperty(el("profile-file"), "files", {
          value: [{ size: 4096, text: async () => JSON.stringify(f.profile) }],
        });
        el("profile-file").dispatchEvent(new w.Event("change"));
        await pause(5);
        assert.equal(state(), "loading");
        locked();
      },
    );
    await t.test(
      "an absent market has a clear status and a retry action",
      async () => {
        await respond("null", "unavailable");
        assert.match(el("availability-title").textContent, /not open yet/);
        assert.equal(el("market-retry").hidden, false);
        assert.equal(deadlines.size, 0);
        locked();
      },
    );
    await t.test(
      "failed requests can be retried without duplicate fetches",
      async () => {
        retry();
        const count = requests.length;
        el("market-retry").dispatchEvent(new w.Event("click"));
        assert.equal(requests.length, count);
        await respond("upstream unavailable", "error", 503);
        assert.equal(el("market-retry").disabled, false);
        locked();
      },
    );
    await t.test(
      "network errors do not strand the page in loading",
      async () => {
        retry();
        requests.at(-1).reject(new TypeError("Network failed"));
        await until(() => state() === "error");
        assert.equal(deadlines.size, 0);
        locked();
      },
    );
    await t.test(
      "invalid JSON and invalid source identities keep trading locked",
      async () => {
        retry();
        await respond("{broken", "error");
        locked();
        retry();
        await respond(
          JSON.stringify({ ...f.profile, engineCommit: "0".repeat(40) }),
          "error",
        );
        locked();
        retry();
        await respond(
          JSON.stringify({ ...f.profile, cluster: "mainnet-beta" }),
          "error",
        );
        locked();
      },
    );
    await t.test(
      "oversized profiles are rejected without wallet actions",
      async () => {
        retry();
        await respond(" ".repeat(65537) + JSON.stringify(f.profile), "error");
        locked();
      },
    );
    await t.test(
      "a timed-out request aborts and permits a fresh attempt",
      async () => {
        retry();
        const request = requests.at(-1);
        assert.equal(deadlines.size, 1);
        deadlines.values().next().value();
        await until(() => state() === "error");
        assert.equal(request.signal.aborted, true);
        assert.equal(deadlines.size, 0);
        request.resolve(new Response(JSON.stringify(f.profile)));
        await pause(5);
        assert.equal(state(), "error");
        locked();
      },
    );
    await t.test(
      "a valid official profile opens the wallet chooser directly",
      async () => {
        retry();
        await respond(JSON.stringify(f.profile), "ready");
        assert.equal(el("wallet-button").disabled, false);
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        assert.match(el("availability-title").textContent, /Test market/);
        assert.equal(el("market-retry").hidden, true);
        assert.equal(el("profile-file").disabled, true);
        el("wallet-button").click();
        assert.equal(el("wallet-dialog").open, true);
        assert.equal(el("settings-dialog").open, false);
        assert.match(el("wallet-help").textContent, /wallet browser/);
        assert.equal(el("trade-review").disabled, true);
        assert.equal(deadlines.size, 0);
      },
    );
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
});
