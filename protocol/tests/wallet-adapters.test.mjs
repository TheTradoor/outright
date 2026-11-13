import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { OutrightClient } from "../src/client.mjs";
import { fixture, withMaker } from "./support/client-fixture.mjs";

test("optional chart and malformed wallet adapters do not block a healthy wallet", async (t) => {
  const f = await withMaker(await fixture());
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
  let resize,
    context = null,
    accountChange;
  replace(
    "ResizeObserver",
    class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
    },
  );
  replace("setInterval", () => 0);
  replace("fetch", async (url) => {
    assert.ok(String(url).endsWith("/deployment.json"));
    return new Response(JSON.stringify(f.profile));
  });
  w.HTMLCanvasElement.prototype.getContext = () => context;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  const originalSnapshot = OutrightClient.prototype.snapshot;
  OutrightClient.prototype.snapshot = function (...args) {
    return originalSnapshot.apply(f.client, args);
  };
  const wallet = {
    version: "1.0.0",
    name: "Healthy wallet",
    accounts: [],
    chains: ["solana:devnet"],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: wallet.accounts }),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signTransaction: async () => {
          throw new Error("Signing is outside this fixture");
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (_, callback) => {
          accountChange = callback;
          return () => {
            accountChange = undefined;
          };
        },
      },
    },
  };
  const { getWallets } = await import("@wallet-standard/app");
  const registry = getWallets(),
    unregister = registry.register(wallet);
  const until = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await pause(5);
    }
    assert.fail("terminal did not reach the expected state");
  };
  const assertChooser = () => {
    assert.equal(el("wallet-dialog").open, true);
    assert.deepEqual(
      [...el("wallet-list").querySelectorAll("button")].map(
        (b) => b.textContent,
      ),
      [wallet.name],
    );
    assert.deepEqual(errors, []);
  };
  try {
    await import("../terminal/terminal.mjs");
    await t.test(
      "a missing canvas context cannot strand valid market startup",
      async () => {
        await until(() => el("deployment-notice").dataset.state === "ready");
        assert.equal(el("wallet-button").disabled, false);
        assert.equal(
          el("chart-empty").querySelector("h2").textContent,
          "Chart unavailable",
        );
        el("wallet-button").click();
        assertChooser();
        el("wallet-dialog").close();
      },
    );
    const broken = (features) => ({
      ...wallet,
      name: "Broken wallet",
      features,
    });
    const cases = [
      ["null registration", null],
      ["missing features", { name: "Broken wallet" }],
      [
        "missing transaction versions",
        broken({
          ...wallet.features,
          "solana:signTransaction": { signTransaction() {} },
        }),
      ],
      [
        "non-array transaction versions",
        broken({
          ...wallet.features,
          "solana:signTransaction": {
            signTransaction() {},
            supportedTransactionVersions: {},
          },
        }),
      ],
      [
        "non-callable connect",
        broken({ ...wallet.features, "standard:connect": { connect: true } }),
      ],
      [
        "non-callable signer",
        broken({
          ...wallet.features,
          "solana:signTransaction": {
            signTransaction: true,
            supportedTransactionVersions: [0],
          },
        }),
      ],
      [
        "non-callable event subscription",
        broken({ ...wallet.features, "standard:events": { on: true } }),
      ],
      [
        "throwing feature getter",
        {
          name: "Broken wallet",
          get features() {
            throw new Error("Adapter unavailable");
          },
        },
      ],
    ];
    for (const [name, adapter] of cases)
      await t.test(`${name} cannot hide a healthy wallet`, () => {
        const remove = registry.register(adapter);
        try {
          el("wallet-button").click();
          assertChooser();
        } finally {
          el("wallet-dialog").close();
          remove();
        }
      });
    await t.test(
      "late malformed registration leaves an open chooser usable",
      () => {
        el("wallet-button").click();
        const remove = registry.register(cases[2][1]);
        try {
          assertChooser();
        } finally {
          remove();
          el("wallet-dialog").close();
        }
      },
    );
    await t.test(
      "malformed returned accounts are skipped while a valid authorized account connects",
      async () => {
        wallet.accounts = [
          null,
          {},
          { address: "broken", features: {}, chains: [] },
          {
            address: f.owner.publicKey.toBase58(),
            publicKey: f.owner.publicKey.toBytes(),
            features: ["solana:signTransaction"],
            chains: ["solana:devnet"],
          },
        ];
        el("wallet-button").click();
        el("wallet-list").querySelector("button").click();
        await until(
          () =>
            el("price").textContent === "150" && !el("wallet-button").disabled,
        );
        assert.equal(el("wallet-dialog").open, false);
        assert.equal(el("wallet-balance").textContent, "1000");
        assert.equal(
          el("chart-empty").querySelector("h2").textContent,
          "Chart unavailable",
        );
        assert.deepEqual(errors, []);
      },
    );
    await t.test(
      "chart recovery renders existing observations without reconnecting",
      () => {
        let points = 0;
        context = {
          scale() {},
          beginPath() {},
          moveTo() {
            points++;
          },
          lineTo() {
            points++;
          },
          stroke() {},
          fillRect() {},
          fillText() {},
        };
        resize();
        assert.equal(el("chart-empty").hidden, true);
        assert.ok(points > 0);
        assert.equal(el("wallet-balance").textContent, "1000");
      },
    );
    await t.test(
      "malformed wallet account updates clear actionable state",
      () => {
        accountChange({ accounts: {} });
        assert.equal(el("wallet-button").textContent, "Connect wallet");
        assert.equal(el("trade-review").disabled, true);
        assert.equal(el("wallet-balance").textContent, "Not connected");
        assert.match(el("feedback").textContent, /invalid account update/);
        assert.deepEqual(errors, []);
      },
    );
    await t.test(
      "an invalid connect response remains recoverable inside the chooser",
      async () => {
        const original = wallet.features["standard:connect"].connect;
        wallet.features["standard:connect"].connect = async () => ({
          accounts: null,
        });
        try {
          el("wallet-button").click();
          el("wallet-list").querySelector("button").click();
          await until(() =>
            /invalid account list/.test(el("wallet-error").textContent),
          );
          assert.equal(el("wallet-dialog").open, true);
          assert.deepEqual(errors, []);
        } finally {
          wallet.features["standard:connect"].connect = original;
          el("wallet-dialog").close();
        }
      },
    );
    for (const setupFailure of ["invalid cleanup", "throwing subscription"])
      await t.test(
        `${setupFailure} leaves no authorization or live old callback`,
        async () => {
          const original = wallet.features["standard:events"].on;
          let staleChange;
          wallet.features["standard:events"].on = (_, callback) => {
            staleChange = callback;
            if (setupFailure === "throwing subscription")
              throw new Error("Adapter subscription failed");
            return {};
          };
          try {
            el("wallet-button").click();
            el("wallet-list").querySelector("button").click();
            await until(() =>
              /account updates are unavailable/.test(
                el("wallet-error").textContent,
              ),
            );
            assert.equal(el("wallet-dialog").open, true);
            assert.equal(el("wallet-button").textContent, "Connect wallet");
            assert.equal(el("wallet-balance").textContent, "Not connected");
            assert.equal(el("trade-review").disabled, true);
          } finally {
            wallet.features["standard:events"].on = original;
          }
          // Reuse the same adapter identity to prove callback isolation is
          // per subscription, not merely a comparison of wallet objects.
          el("wallet-list").querySelector("button").click();
          await until(() => el("wallet-balance").textContent === "1000");
          staleChange({ accounts: [] });
          assert.equal(el("wallet-balance").textContent, "1000");
          assert.equal(el("trade-review").disabled, false);
          assert.deepEqual(errors, []);
          await until(() => !el("wallet-button").disabled);
          el("wallet-button").click();
        },
      );
    await t.test(
      "throwing listener cleanup cannot block disconnect or affect a later session",
      async () => {
        const original = wallet.features["standard:events"].on;
        let staleChange;
        wallet.features["standard:events"].on = (_, callback) => {
          staleChange = callback;
          return () => {
            throw new Error("Adapter cleanup failed");
          };
        };
        try {
          el("wallet-button").click();
          el("wallet-list").querySelector("button").click();
          await until(
            () =>
              el("wallet-balance").textContent === "1000" &&
              !el("wallet-button").disabled,
          );
          el("wallet-button").click();
          assert.equal(el("wallet-button").textContent, "Connect wallet");
          assert.equal(el("wallet-balance").textContent, "Not connected");
          assert.equal(el("trade-review").disabled, true);
          assert.deepEqual(errors, []);
        } finally {
          wallet.features["standard:events"].on = original;
        }
        el("wallet-button").click();
        el("wallet-list").querySelector("button").click();
        await until(
          () =>
            el("wallet-balance").textContent === "1000" &&
            !el("wallet-button").disabled,
        );
        staleChange({ accounts: [] });
        assert.equal(el("wallet-balance").textContent, "1000");
        assert.equal(el("trade-review").disabled, false);
        assert.deepEqual(errors, []);
        el("wallet-button").click();
      },
    );
    await t.test(
      "a synchronous disconnect during subscription cannot complete connection",
      async () => {
        const original = wallet.features["standard:events"].on;
        let cleanupCount = 0;
        wallet.features["standard:events"].on = (_, callback) => {
          callback({ accounts: [] });
          return () => cleanupCount++;
        };
        try {
          el("wallet-button").click();
          el("wallet-list").querySelector("button").click();
          await until(() =>
            /account updates are unavailable/.test(
              el("wallet-error").textContent,
            ),
          );
          assert.equal(el("wallet-dialog").open, true);
          assert.equal(el("wallet-button").textContent, "Connect wallet");
          assert.equal(el("wallet-balance").textContent, "Not connected");
          assert.equal(el("trade-review").disabled, true);
          assert.equal(cleanupCount, 1);
          assert.deepEqual(errors, []);
        } finally {
          wallet.features["standard:events"].on = original;
          el("wallet-dialog").close();
        }
      },
    );
  } finally {
    unregister();
    OutrightClient.prototype.snapshot = originalSnapshot;
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    w.close();
  }
});
