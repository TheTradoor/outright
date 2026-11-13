import { getWallets } from "@wallet-standard/app";
import {
  OutrightClient,
  browserJournal,
  validateProfile,
} from "../src/client.mjs";

const $ = (id) => document.getElementById(id);
const setText = (id, value) => {
  $(id).textContent = value;
};
const registry = getWallets(),
  journal = browserJournal();
let client = null,
  wallet = null,
  account = null,
  snapshot = null,
  review = null,
  busy = false,
  loading = false,
  generation = 0,
  stopWalletEvents = null;
const prices = new Map();
function units(value, decimals = 6) {
  const n = BigInt(value),
    magnitude = n < 0n ? -n : n;
  const base = 10n ** BigInt(decimals),
    fraction = (magnitude % base)
      .toString()
      .padStart(decimals, "0")
      .replace(/0+$/, "");
  return `${n < 0n ? "-" : ""}${magnitude / base}${fraction ? "." + fraction : ""}`;
}
function notice(message, error = false) {
  setText("feedback", message);
  $("feedback").hidden = !message;
  $("feedback").classList.toggle("error", error);
}
function invalidateReview() {
  review = null;
  if ($("review-dialog").open) $("review-dialog").close();
}
function clearSnapshot(message = "Not connected") {
  snapshot = null;
  prices.clear();
  for (const id of ["wallet-balance", "capital", "pnl"]) setText(id, message);
  for (const id of ["price", "oi-long", "oi-short"])
    setText(id, "Not available");
  setText("market-title", "Select a market");
  setText("market-state", "Offline");
  setText("maker-state", "Unavailable");
  setText("snapshot-label", "No chain snapshot");
  $("asset-select").replaceChildren();
  $("chart-empty").hidden = false;
  renderPositions([]);
  drawChart();
}
function controls() {
  const ready = Boolean(client && account && snapshot && !busy && !loading);
  $("wallet-button").disabled = busy;
  $("settings-button").disabled = busy;
  $("refresh").disabled = !client || !account || busy || loading;
  $("initialize").hidden = Boolean(snapshot?.portfolio);
  $("initialize").disabled = !ready || Boolean(snapshot?.portfolio);
  for (const button of $("collateral-form").querySelectorAll("button"))
    button.disabled = !ready || !snapshot.portfolio;
  $("trade-review").disabled =
    !ready ||
    !snapshot?.portfolio ||
    !snapshot?.maker?.matcherEnabled ||
    snapshot.maker.matcherExpirySlot <= BigInt(snapshot.slot) ||
    selectedAsset()?.lifecycle !== "active" ||
    snapshot.market.mode !== "live";
  $("asset-select").disabled = !client || !snapshot || busy;
  $("sign").disabled = busy || !review;
}
async function action(work) {
  if (busy) return;
  busy = true;
  controls();
  notice("");
  try {
    await work();
  } catch (error) {
    notice(error.message || "The operation could not be completed.", true);
  } finally {
    busy = false;
    controls();
  }
}
function resetWallet() {
  stopWalletEvents?.();
  stopWalletEvents = null;
  generation++;
  loading = false;
  wallet = null;
  account = null;
  invalidateReview();
  clearSnapshot();
  setText("wallet-button", "Connect wallet");
  setText(
    "footer-state",
    client ? `${client.profile.cluster} profile loaded` : "Awaiting deployment",
  );
  controls();
  renderReceipt(null);
}
function renderReceipt(record) {
  $("receipt-link").hidden = !record;
  $("reconcile").hidden =
    !record || ["confirmed", "finalized", "failed"].includes(record.status);
  if (!record) {
    $("receipt-link").removeAttribute("href");
    setText("receipt-link", "");
    setText(
      "receipt-note",
      "Transaction receipts stay in this browser. Keep your signature until confirmation is known.",
    );
    setText("receipt-state", "No transaction submitted");
    setText(
      "receipt-description",
      "Review, simulate, sign, then confirm on Solana.",
    );
    return;
  }
  const labels = {
    signed: "Signature saved",
    submitted: "Sent, awaiting confirmation",
    pending: "Awaiting confirmation",
    unknown: "Confirmation unknown",
    expiredUnresolved: "Expired, outcome unresolved",
    confirmed: "Confirmed on Solana",
    finalized: "Finalized on Solana",
    failed: "Failed on Solana",
  };
  setText("receipt-state", labels[record.status] || "Unknown status");
  setText("receipt-description", record.summary);
  setText("receipt-link", record.signature);
  const url = new URL(`https://explorer.solana.com/tx/${record.signature}`);
  if (client.profile.cluster === "devnet")
    url.searchParams.set("cluster", "devnet");
  else {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", client.profile.rpcUrl);
  }
  $("receipt-link").href = url.href;
  setText(
    "receipt-note",
    record.status === "expiredUnresolved"
      ? "The RPC has not established the outcome. New actions remain blocked. Check the signature and account state with the market operator."
      : record.status === "failed"
        ? `The transaction failed atomically. Network fees may still apply. ${JSON.stringify(record.error || "")}`
        : "Keep this signature until the result is confirmed. An uncertain response does not trigger another transaction.",
  );
}
function renderPositions(positions) {
  const body = $("positions");
  body.replaceChildren();
  setText("position-count", String(positions.length));
  if (!positions.length) {
    const row = body.insertRow(),
      cell = row.insertCell();
    cell.colSpan = 5;
    cell.className = "empty-cell";
    cell.textContent = snapshot
      ? "No active positions in this portfolio."
      : account
        ? "Portfolio data is unavailable. Refresh to try again."
        : "Connect a wallet to read your portfolio.";
    return;
  }
  for (const p of positions) {
    const row = body.insertRow(),
      metadata = client.profile.assets.find((a) => a.index === p.asset_index);
    const values = [
      metadata?.symbol || `Asset ${p.asset_index}`,
      p.side === "long" ? "Long" : "Short",
      units(p.effectiveSizeQ < 0n ? -p.effectiveSizeQ : p.effectiveSizeQ),
      units(p.effectivePrice),
      p.needsCleanup
        ? "Pending cleanup"
        : p.stale || p.b_stale
          ? "Refresh required"
          : "Open",
    ];
    values.forEach((v, i) => {
      const cell = row.insertCell();
      cell.textContent = v;
      if (i === 1)
        cell.className = p.side === "long" ? "buy-text" : "sell-text";
    });
  }
}
function selectedAsset() {
  const value = $("asset-select").value;
  return value === "" ? undefined : snapshot?.market.assets[Number(value)];
}
function renderMarket() {
  const asset = selectedAsset();
  if (!snapshot) return;
  setText("snapshot-label", `Confirmed snapshot / slot ${snapshot.slot}`);
  setText("footer-state", `${client.profile.cluster} connected`);
  setText("wallet-balance", units(snapshot.tokenBalance));
  setText(
    "capital",
    snapshot.portfolio ? units(snapshot.portfolio.capital) : "No portfolio",
  );
  setText(
    "pnl",
    snapshot.portfolio ? units(snapshot.portfolio.pnl) : "No portfolio",
  );
  const liveMaker =
    snapshot.maker?.matcherEnabled &&
    snapshot.maker.matcherExpirySlot > BigInt(snapshot.slot);
  setText(
    "maker-state",
    liveMaker
      ? "Authorized"
      : snapshot.makerError
        ? "Verification failed"
        : "Unavailable",
  );
  renderPositions(snapshot.positions);
  if (!asset) {
    prices.clear();
    for (const id of ["price", "oi-long", "oi-short"])
      setText(id, "Not available");
    setText("market-title", "No enabled assets");
    setText("market-state", snapshot.market.mode);
    $("chart-empty").hidden = false;
    drawChart();
    controls();
    return;
  }
  setText("price", units(asset.effective_price));
  setText("oi-long", units(asset.oi_eff_long_q));
  setText("oi-short", units(asset.oi_eff_short_q));
  setText(
    "market-title",
    client.profile.assets.find((a) => a.index === asset.index)?.symbol ||
      `Asset ${asset.index}`,
  );
  setText("market-state", `${snapshot.market.mode} / ${asset.lifecycle}`);
  const points = prices.get(asset.index) || [];
  if (!points.length || points.at(-1).slot !== snapshot.slot)
    points.push({ slot: snapshot.slot, value: asset.effective_price });
  prices.set(asset.index, points.slice(-120));
  $("chart-empty").hidden = points.length > 0;
  drawChart();
  controls();
}
function drawChart() {
  const canvas = $("price-chart"),
    box = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, box.width * ratio);
  canvas.height = Math.max(1, box.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const points = prices.get(Number($("asset-select").value)) || [];
  if (!points.length) return;
  const values = points.map((p) => Number(p.value)),
    min = Math.min(...values),
    max = Math.max(...values);
  const padding = Math.max((max - min) * 0.2, Math.max(max, 1) * 0.0005),
    range = max - min + padding * 2;
  const coords = values.map((v, i) => [
    16 +
      (points.length === 1 ? 0.5 : i / (points.length - 1)) * (box.width - 32),
    20 + ((max + padding - v) / range) * (box.height - 40),
  ]);
  ctx.strokeStyle = "#e5e3d8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  coords.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  const [x, y] = coords.at(-1);
  ctx.fillStyle = "#e5e3d8";
  ctx.fillRect(x - 3, y - 3, 6, 6);
  ctx.font = "10px monospace";
  ctx.fillStyle = "#a4ada5";
  ctx.fillText(
    points.length === 1
      ? "First observation received"
      : `${points.length} observations`,
    16,
    box.height - 8,
  );
}
new ResizeObserver(drawChart).observe($("chart"));
async function refresh() {
  if (!client || !account || loading) return;
  const current = generation,
    selectedClient = client,
    selectedAccount = account;
  loading = true;
  controls();
  try {
    const next = await selectedClient.snapshot(selectedAccount.address);
    if (current !== generation) return;
    snapshot = next;
    const chosen = $("asset-select").value;
    $("asset-select").replaceChildren();
    for (const asset of next.market.assets.filter(
      (a) => a.lifecycle !== "disabled",
    )) {
      const option = document.createElement("option");
      option.value = String(asset.index);
      option.textContent =
        client.profile.assets.find((a) => a.index === asset.index)?.symbol ||
        `Asset ${asset.index}`;
      $("asset-select").append(option);
    }
    if ([...$("asset-select").options].some((o) => o.value === chosen))
      $("asset-select").value = chosen;
    renderMarket();
    const record = await selectedClient.journal.read(
      selectedClient.scope(selectedAccount.address),
    );
    if (current === generation) renderReceipt(record);
  } catch (error) {
    if (current === generation) {
      invalidateReview();
      clearSnapshot("Not available");
      setText("footer-state", "Connection needs attention");
      notice(error.message, true);
    }
  } finally {
    if (current === generation) {
      loading = false;
      controls();
    }
  }
}
async function loadProfile(input) {
  const validated = validateProfile(input);
  resetWallet();
  client = new OutrightClient(validated, { journal });
  prices.clear();
  setText("network", validated.cluster);
  setText("collateral-symbol", validated.collateral.symbol);
  setText("amount-symbol", validated.collateral.symbol);
  setText(
    "trade-fee",
    validated.maker
      ? `${units(BigInt(validated.maker.feeBps), 2)}%`
      : "Not configured",
  );
  setText(
    "backing-fee",
    validated.maker
      ? `${units(BigInt(validated.maker.backingFeeCapBps), 2)}%`
      : "Not configured",
  );
  setText(
    "profile-detail",
    `Network: ${validated.cluster}\nRPC: ${new URL(validated.rpcUrl).host}\nMarket: ${validated.market}\nProgram: ${validated.program.address}`,
  );
  $("profile-detail").style.whiteSpace = "pre-wrap";
  setText("footer-state", `${validated.cluster} profile loaded`);
  notice(
    "Deployment profile loaded. Connect a wallet to verify the on-chain accounts.",
  );
  controls();
}
function compatible(w) {
  return (
    w.features["standard:connect"] &&
    w.features["solana:signTransaction"]?.supportedTransactionVersions.includes(
      0,
    )
  );
}
function supportsAccount(a) {
  return (
    a.features.includes("solana:signTransaction") &&
    (client.profile.cluster === "localnet" ||
      a.chains.includes("solana:devnet"))
  );
}
function showWallets() {
  const list = $("wallet-list");
  list.replaceChildren();
  const wallets = registry.get().filter(compatible);
  setText(
    "wallet-help",
    wallets.length
      ? "Choose a wallet. Connecting does not sign a transaction."
      : "No compatible wallet was detected. Open this page in a Solana wallet browser or use a browser with a wallet extension that supports versioned transactions.",
  );
  for (const w of wallets) {
    const button = document.createElement("button");
    button.className = "button outline";
    button.textContent = w.name;
    button.addEventListener("click", () =>
      action(async () => {
        const connected = await w.features["standard:connect"].connect();
        const accounts = connected.accounts.filter(supportsAccount);
        if (!accounts.length)
          throw new Error(
            "Choose an account that supports this network and transaction signing",
          );
        if (accounts.length === 1) await selectAccount(w, accounts[0]);
        else {
          list.replaceChildren();
          setText("wallet-help", "Choose the account to use for this market.");
          for (const a of accounts) {
            const b = document.createElement("button");
            b.className = "button outline";
            b.textContent = a.address;
            b.addEventListener("click", () =>
              action(() => selectAccount(w, a)),
            );
            list.append(b);
          }
        }
      }),
    );
    list.append(button);
  }
}
async function selectAccount(w, a) {
  resetWallet();
  wallet = w;
  account = a;
  setText("wallet-button", `${a.address.slice(0, 4)}…${a.address.slice(-4)} ×`);
  if (w.features["standard:events"])
    stopWalletEvents = w.features["standard:events"].on("change", (event) => {
      invalidateReview();
      if (event.accounts) {
        const next = event.accounts.find((v) => v.address === account?.address);
        if (!next || !supportsAccount(next)) {
          resetWallet();
          notice(
            "Wallet account changed. Reconnect the account you want to use.",
          );
        } else {
          account = next;
          generation++;
          loading = false;
          clearSnapshot("Refreshing");
          setText("footer-state", "Refreshing wallet account");
          void refresh();
        }
      }
    });
  $("wallet-dialog").close();
  await refresh();
}
async function reviewAction(value) {
  if (!client || !account)
    throw new Error("Connect a deployment and wallet first");
  const selected = account,
    selectedClient = client,
    current = generation;
  const prepared = await selectedClient.prepare(selected.address, value);
  if (current !== generation || selected !== account)
    throw new Error("Wallet changed during simulation. Review again.");
  review = prepared;
  setText("review-summary", prepared.summary);
  const fields = [
    ["Network", client.profile.cluster],
    ["Wallet", prepared.owner],
    ["Market", client.profile.market],
    ["Portfolio", prepared.snapshot.portfolioAddress],
    ["Network fee", `${units(BigInt(prepared.networkFeeLamports), 9)} SOL`],
    ["Account rent", `${units(BigInt(prepared.rentLamports), 9)} SOL`],
    ["Simulation slot", String(prepared.snapshot.slot)],
  ];
  if (value.type === "trade")
    fields.push(
      ["Trading fee", `${units(BigInt(client.profile.maker.feeBps), 2)}%`],
      [
        "Backing fee cap",
        `${units(BigInt(client.profile.maker.backingFeeCapBps), 2)}%`,
      ],
    );
  $("review-details").replaceChildren();
  for (const [title, text] of fields) {
    const row = document.createElement("div"),
      dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = title;
    dd.textContent = text;
    row.append(dt, dd);
    $("review-details").append(row);
  }
  $("review-dialog").showModal();
}
$("settings-button").addEventListener("click", () =>
  $("settings-dialog").showModal(),
);
$("profile-file").addEventListener("change", (event) =>
  action(async () => {
    const file = event.target.files[0];
    if (!file) return;
    setText("profile-error", "");
    try {
      if (file.size > 65536) throw new Error("Deployment profile is too large");
      await loadProfile(JSON.parse(await file.text()));
      $("settings-dialog").close();
    } catch (error) {
      setText("profile-error", error.message);
      throw error;
    } finally {
      event.target.value = "";
    }
  }),
);
$("wallet-button").addEventListener("click", () => {
  if (account) {
    resetWallet();
    return;
  }
  if (!client) {
    $("settings-dialog").showModal();
    notice("Load a deployment profile before connecting your wallet.");
    return;
  }
  showWallets();
  $("wallet-dialog").showModal();
});
registry.on("register", () => {
  if ($("wallet-dialog").open) showWallets();
});
registry.on("unregister", (...wallets) => {
  if (wallets.includes(wallet)) resetWallet();
  if ($("wallet-dialog").open) showWallets();
});
$("asset-select").addEventListener("change", () => {
  invalidateReview();
  renderMarket();
});
$("refresh").addEventListener("click", () => action(refresh));
$("initialize").addEventListener("click", () =>
  action(() => reviewAction({ type: "initialize" })),
);
$("collateral-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  void action(() =>
    reviewAction({ type: event.submitter?.value, amount: form.get("amount") }),
  );
});
$("trade-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  void action(() =>
    reviewAction({
      type: "trade",
      assetIndex: Number($("asset-select").value),
      side: form.get("side"),
      size: form.get("size"),
      limitPrice: form.get("limitPrice"),
    }),
  );
});
$("trade-form").addEventListener("change", () =>
  setText(
    "limit-label",
    new FormData($("trade-form")).get("side") === "buy"
      ? "Maximum execution price"
      : "Minimum execution price",
  ),
);
$("review-dialog").addEventListener("close", () => {
  review = null;
  controls();
});
$("sign").addEventListener("click", () =>
  action(async () => {
    const prepared = review,
      selectedWallet = wallet,
      selectedAccount = account,
      selectedClient = client;
    if (!prepared || !selectedAccount)
      throw new Error("Review the action again");
    const record = await selectedClient.submit(
      prepared,
      async (transaction) => {
        if (wallet !== selectedWallet || account !== selectedAccount)
          throw new Error("Wallet account changed");
        const [result] = await selectedWallet.features[
          "solana:signTransaction"
        ].signTransaction({
          account: selectedAccount,
          transaction,
          ...(selectedClient.profile.cluster === "devnet"
            ? { chain: "solana:devnet" }
            : {}),
        });
        if (wallet !== selectedWallet || account !== selectedAccount)
          throw new Error("Wallet account changed before submission");
        return result.signedTransaction;
      },
    );
    $("review-dialog").close();
    renderReceipt(record);
    notice("Signature saved. Waiting for on-chain confirmation.");
  }),
);
async function reconcile() {
  if (!client || !account) return;
  const current = generation,
    selectedClient = client,
    selectedAccount = account;
  const record = await selectedClient.reconcile(selectedAccount.address);
  if (current !== generation || !record) return;
  renderReceipt(record);
  if (["confirmed", "finalized", "failed"].includes(record.status)) {
    notice(
      record.status === "failed"
        ? "The transaction failed on-chain. Check the receipt."
        : "Transaction confirmed on Solana.",
      record.status === "failed",
    );
    await refresh();
  }
}
$("reconcile").addEventListener("click", () => action(reconcile));
setInterval(() => {
  if (
    busy ||
    loading ||
    document.hidden ||
    document.querySelector("dialog[open]")
  )
    return;
  void action(async () => {
    await reconcile();
    if (client && account) await refresh();
  });
}, 10_000);
controls();
fetch(new URL("./deployment.json", import.meta.url), { cache: "no-store" })
  .then((response) => {
    if (!response.ok)
      throw new Error("Deployment configuration could not be loaded");
    return response.json();
  })
  .then((profile) => profile && loadProfile(profile))
  .catch((error) => notice(error.message, true));
