import { getWallets } from "@wallet-standard/app";
import {
  OutrightClient,
  browserJournal,
  validateProfile,
  isTradeOracleFresh,
} from "../src/client.mjs";
import {
  isSettlementAction,
  canReviewPortfolioClosure,
} from "../src/settlement.mjs";
import { isRecoveryAction, recoveryPosition } from "../src/recovery.mjs";
import { walletChain, transactionExplorerUrl } from "../src/network.mjs";

const $ = (id) => document.getElementById(id);
const setText = (id, value) => {
  $(id).textContent = value;
};
const registry = getWallets(),
  journal = browserJournal();
const operatorMode =
  new URL(window.location.href).searchParams.get("operator") === "1";
let availability = "loading",
  profileRequest = 0,
  profileAbort = null;
let client = null,
  wallet = null,
  account = null,
  snapshot = null,
  review = null,
  busy = false,
  submitting = false,
  loading = false,
  generation = 0,
  walletSelection = 0,
  stopWalletEvents = null;
const prices = new Map();
const chartEmptyTitle = $("chart-empty").querySelector("h2").textContent,
  chartEmptyDescription = $("chart-empty").querySelector("p").textContent;
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
  $("settlement-panel").hidden = true;
  $("recovery-panel").hidden = true;
  $("recovery-consent").checked = false;
  $("recovery-budget").value = "";
  $("settlement-balances").hidden = true;
  setText("settlement-status", "");
  for (const id of ["settlement-face", "settlement-paid", "settlement-due"])
    setText(id, "Not available");
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
  $("wallet-button").disabled = busy || !client;
  if (!account)
    setText(
      "wallet-button",
      client
        ? "Connect wallet"
        : availability === "loading"
          ? "Loading market…"
          : "Market not open",
    );
  $("settings-button").disabled = busy || !operatorMode;
  $("profile-file").disabled = busy || !operatorMode;
  $("market-retry").disabled = busy || availability === "loading";
  $("refresh").disabled = !client || !account || busy || loading;
  const live = snapshot?.market.mode === "live";
  const resolved = snapshot?.market.mode === "resolved";
  const asset = selectedAsset();
  const oracleUnavailable = Boolean(
    live &&
      asset?.lifecycle === "active" &&
      !isTradeOracleFresh(client.profile, snapshot, asset),
  );
  $("trade-availability").hidden = !oracleUnavailable;
  if (oracleUnavailable)
    $("trade-review").setAttribute("aria-describedby", "trade-availability");
  else $("trade-review").removeAttribute("aria-describedby");
  $("initialize").hidden =
    Boolean(snapshot?.portfolio) || Boolean(snapshot && !live);
  $("initialize").disabled = !ready || !live || Boolean(snapshot?.portfolio);
  $("collateral-form").hidden = Boolean(snapshot && !live);
  for (const button of $("collateral-form").querySelectorAll("button"))
    button.disabled = !ready || !live || !snapshot?.portfolio;
  $("settlement-close").disabled = !ready || !resolved || !snapshot?.portfolio;
  $("portfolio-close").disabled =
    !ready || !canReviewPortfolioClosure(snapshot);
  $("settlement-claim").disabled =
    !ready ||
    !resolved ||
    !snapshot?.portfolio ||
    snapshot.recordedSettlementPayout === 0n;
  $("recovery-review").disabled =
    !ready ||
    !recoveryPosition(snapshot, selectedAsset()?.index) ||
    !$("recovery-consent").checked ||
    !$("recovery-budget").value;
  $("trade-review").disabled =
    !ready ||
    !snapshot?.portfolio ||
    !snapshot?.maker?.matcherEnabled ||
    snapshot.maker.matcherExpirySlot <= BigInt(snapshot.slot) ||
    asset?.lifecycle !== "active" ||
    oracleUnavailable ||
    snapshot.market.mode !== "live";
  $("asset-select").disabled = !client || !snapshot || busy;
  $("sign").disabled = busy || !review;
  $("review-cancel").disabled = submitting;
  $("review-progress").hidden = !submitting;
}
async function action(work) {
  if (busy) return;
  const current = generation;
  busy = true;
  controls();
  notice("");
  try {
    await work();
  } catch (error) {
    // Wallet events can replace the session while an RPC request is pending.
    // Its error belongs to the old session just as its successful result does.
    if (current === generation)
      notice(error.message || "The operation could not be completed.", true);
  } finally {
    busy = false;
    controls();
  }
}
function resetWallet() {
  const stop = stopWalletEvents;
  stopWalletEvents = null;
  // Adapter cleanup must not prevent clearing local authorization. The
  // subscription wrapper invalidates its callback before calling the adapter.
  try {
    stop?.();
  } catch {}
  generation++;
  loading = false;
  wallet = null;
  account = null;
  invalidateReview();
  clearSnapshot();
  setText("wallet-button", "Connect wallet");
  setText(
    "footer-state",
    client ? `${client.profile.cluster} profile loaded` : "Market not open",
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
  $("receipt-link").href = transactionExplorerUrl(
    client.profile,
    record.signature,
  );
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
  $("recovery-panel").hidden = !recoveryPosition(snapshot, asset?.index);
  $("recovery-consent").checked = false;
  setText("recovery-budget-symbol", client.profile.collateral.symbol);
  $("settlement-panel").hidden = snapshot.market.mode !== "resolved";
  const receipt = snapshot.portfolio?.resolvedPayout;
  $("settlement-balances").hidden = !receipt?.present;
  setText(
    "settlement-status",
    !snapshot.portfolio
      ? "No portfolio for this wallet."
      : snapshot.market.resolvedPayout.payout_halted
        ? "Payouts are halted by the engine. Operator recovery is required."
        : receipt?.present
          ? "Receipt values exclude separate capital payouts. Refresh after each confirmed step."
          : "No payout receipt is recorded. This alone does not mean settlement is complete.",
  );
  for (const [id, value] of [
    ["settlement-face", receipt?.terminal_positive_claim_face],
    ["settlement-paid", receipt?.paid_effective],
    ["settlement-due", snapshot.recordedSettlementPayout],
  ])
    setText(
      id,
      value === undefined
        ? "Not available"
        : units(value, client.profile.collateral.decimals),
    );
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
  // Chart rendering is optional. A browser that cannot provide a canvas
  // context must still load the market and permit verified wallet actions.
  if (!ctx) {
    $("chart-empty").hidden = false;
    $("chart-empty").querySelector("h2").textContent = "Chart unavailable";
    $("chart-empty").querySelector("p").textContent =
      "Market and account values remain available without the chart.";
    return;
  }
  $("chart-empty").querySelector("h2").textContent = chartEmptyTitle;
  $("chart-empty").querySelector("p").textContent = chartEmptyDescription;
  ctx.scale(ratio, ratio);
  const points = prices.get(Number($("asset-select").value)) || [];
  $("chart-empty").hidden = points.length > 0;
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
    const record = await selectedClient.receipt(selectedAccount.address);
    if (current !== generation) return;
    renderReceipt(record);
    if (
      next.slot < Math.max(record?.minimumSlot ?? 0, record?.confirmedSlot ?? 0)
    )
      throw new Error(
        "The transaction receipt is newer than this account snapshot. Refresh to load current balances.",
      );
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
  // Construct before replacing an active session; invalid input must not
  // disconnect a wallet or discard its transaction review.
  const next = new OutrightClient(validated, { journal });
  profileRequest++;
  profileAbort?.abort();
  profileAbort = null;
  resetWallet();
  client = next;
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
  setAvailability("ready");
  notice("");
  controls();
}
function setAvailability(state) {
  availability = state;
  $("deployment-notice").dataset.state = state;
  $("market-retry").hidden = state === "loading" || state === "ready";
  const messages = {
    loading: [
      "Checking market availability.",
      "The official market loads automatically.",
    ],
    unavailable: [
      "Trading is not open yet.",
      "This page will connect to the official market automatically when it opens.",
    ],
    error: [
      "The market could not be loaded.",
      "Check your connection and try again. Trading stays unavailable until the market can be verified.",
    ],
    ready:
      client?.profile.cluster === "mainnet-beta"
        ? [
            "Solana mainnet",
            "Connect your wallet to view balances. Transactions use real funds.",
          ]
        : [
            `Test market · ${client?.profile.cluster}`,
            "Connect your wallet to view balances. This market uses test funds.",
          ],
  };
  const [title, detail] = messages[state];
  setText("availability-title", title);
  setText("availability-detail", detail);
  if (!client) {
    setText("network", "Offline");
    setText(
      "footer-state",
      state === "loading" ? "Checking market availability" : "Market not open",
    );
  }
  controls();
}
async function loadOfficialMarket() {
  if (client || profileAbort) return;
  const request = ++profileRequest;
  const controller = new AbortController();
  profileAbort = controller;
  setAvailability("loading");
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      new URL("./deployment.json", import.meta.url),
      {
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error("Market configuration is unavailable");
    const body = await response.text();
    if (controller.signal.aborted) throw new Error("Market request timed out");
    if (new TextEncoder().encode(body).length > 65536)
      throw new Error("Deployment profile is too large");
    if (request !== profileRequest || client) return;
    const profile = JSON.parse(body);
    if (profile === null) setAvailability("unavailable");
    else await loadProfile(profile);
  } catch (error) {
    if (request !== profileRequest || client) return;
    setAvailability("error");
    if (operatorMode)
      setText(
        "profile-error",
        error.message || "Market configuration could not be loaded",
      );
  } finally {
    clearTimeout(timeout);
    if (profileAbort === controller) profileAbort = null;
  }
}
function compatible(w) {
  // The registry accepts third-party objects without runtime validation.
  // One broken adapter must not prevent other wallets from being selected.
  try {
    const features = w?.features,
      connect = features?.["standard:connect"],
      sign = features?.["solana:signTransaction"],
      events = features?.["standard:events"];
    return (
      typeof w?.name === "string" &&
      w.name.length > 0 &&
      Array.isArray(w.accounts) &&
      typeof connect?.connect === "function" &&
      typeof sign?.signTransaction === "function" &&
      Array.isArray(sign.supportedTransactionVersions) &&
      sign.supportedTransactionVersions.includes(0) &&
      (events === undefined || typeof events?.on === "function")
    );
  } catch {
    return false;
  }
}
function supportsAccount(a) {
  try {
    return (
      typeof a?.address === "string" &&
      Array.isArray(a.features) &&
      a.features.includes("solana:signTransaction") &&
      Array.isArray(a.chains) &&
      (walletChain(client?.profile.cluster) === null ||
        a.chains.includes(walletChain(client.profile.cluster)))
    );
  } catch {
    return false;
  }
}
function walletError(message = "") {
  setText("wallet-error", message);
  $("wallet-error").hidden = !message;
}
function selectionAction(work) {
  const current = walletSelection,
    selectedClient = client;
  const active = () =>
    current === walletSelection &&
    selectedClient === client &&
    $("wallet-dialog").open;
  return action(async () => {
    if (!active()) return;
    walletError();
    try {
      await work(active);
    } catch (error) {
      // The page behind a modal dialog is inert. Keep connection errors in
      // the chooser, and ignore an answer to a choice the user has closed.
      if (active())
        walletError(error.message || "The wallet could not be connected.");
    }
  });
}
function requireWallet(w) {
  if (!registry.get().includes(w) || !compatible(w))
    throw new Error(
      "This wallet is no longer available. Choose another wallet.",
    );
}
async function selectAvailableAccount(w, a, active) {
  if (!active()) return;
  requireWallet(w);
  // Account objects may be replaced while the user is choosing. Use the
  // wallet's currently authorized object, not the earlier connect result.
  const current = w.accounts.find(
    (next) => supportsAccount(next) && next.address === a.address,
  );
  if (!current)
    throw new Error(
      "This account is no longer available for this network. Connect again.",
    );
  await selectAccount(w, current);
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
      selectionAction(async (active) => {
        requireWallet(w);
        const connected = await w.features["standard:connect"].connect();
        if (!active()) return;
        requireWallet(w);
        if (!Array.isArray(connected?.accounts))
          throw new Error(
            "The wallet returned an invalid account list. Connect again.",
          );
        const offered = new Set(
          connected.accounts.filter(supportsAccount).map((a) => a.address),
        );
        const accounts = w.accounts.filter(
          (a) => supportsAccount(a) && offered.has(a.address),
        );
        if (!accounts.length)
          throw new Error(
            "Choose an account that supports this network and transaction signing",
          );
        if (accounts.length === 1)
          await selectAvailableAccount(w, accounts[0], active);
        else {
          list.replaceChildren();
          setText("wallet-help", "Choose the account to use for this market.");
          for (const a of accounts) {
            const b = document.createElement("button");
            b.className = "button outline";
            b.textContent = a.address;
            b.addEventListener("click", () =>
              selectionAction((active) => selectAvailableAccount(w, a, active)),
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
  if (w.features["standard:events"]) {
    let listening = true,
      unsubscribe;
    stopWalletEvents = () => {
      listening = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
    try {
      unsubscribe = w.features["standard:events"].on("change", (event) => {
        if (!listening || wallet !== w) return;
        invalidateReview();
        if (
          !event ||
          (event.accounts !== undefined && !Array.isArray(event.accounts))
        ) {
          resetWallet();
          notice(
            "The wallet returned an invalid account update. Reconnect your wallet.",
            true,
          );
          return;
        }
        if (event.accounts) {
          const next = event.accounts.find(
            (v) => supportsAccount(v) && v.address === account?.address,
          );
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
      if (typeof unsubscribe !== "function")
        throw new Error("Invalid wallet event cleanup");
      // An adapter can synchronously emit a disconnect while subscribing.
      if (!listening) {
        unsubscribe();
        throw new Error("Wallet disconnected while connecting");
      }
    } catch {
      resetWallet();
      throw new Error(
        "Wallet account updates are unavailable. Choose another wallet.",
      );
    }
  }
  $("wallet-dialog").close();
  await refresh();
}
async function reviewAction(value) {
  if (!client || !account)
    throw new Error("Connect your wallet when the market is available");
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
      [
        "Current base fee",
        `${units(prepared.snapshot.market.wrapper.trade_fee_base_bps, 2)}%`,
      ],
      ["Base fee cap", `${units(BigInt(client.profile.maker.feeBps), 2)}%`],
      [
        "Engine fee limit",
        `${units(prepared.snapshot.market.config.max_trading_fee_bps, 2)}%`,
      ],
      [
        "Backing fee cap",
        `${units(BigInt(client.profile.maker.backingFeeCapBps), 2)}%`,
      ],
      [
        "Fee policy",
        "Market rules determine fees at execution. Mark-movement fees can exceed the base fee cap, up to the engine fee limit. Backing fees are separate.",
      ],
    );
  if (isSettlementAction(value.type))
    fields.push(
      [
        "Maintenance fee per slot",
        `${units(prepared.snapshot.market.wrapper.maintenance_fee_per_slot, client.profile.collateral.decimals)} ${client.profile.collateral.symbol}`,
      ],
      [
        "Additional payout at recorded rate",
        `${units(prepared.snapshot.recordedSettlementPayout, client.profile.collateral.decimals)} ${client.profile.collateral.symbol}`,
      ],
      [
        "Settlement",
        "This is a bounded step. It may update accounting without a transfer. The recorded payout excludes capital and is not a guaranteed quote. Refresh after confirmation.",
      ],
    );
  if (value.type === "closePortfolio")
    fields.push(
      ["Account", prepared.snapshot.portfolioAddress],
      ["SOL destination", client.profile.market],
      [
        "Account closure",
        "All SOL held by this portfolio account, including rent, goes to the market account. It is not returned to your wallet. No collateral payout is included.",
      ],
      [
        "Engine checks",
        "Simulation checks that no balances, claims or obligations remain. The program verifies this again at execution. Closure cannot be undone. Refresh after confirmation.",
      ],
    );
  if (isRecoveryAction(value.type)) {
    const position = recoveryPosition(prepared.snapshot, value.assetIndex);
    const symbol =
      client.profile.assets.find((a) => a.index === value.assetIndex)?.symbol ||
      `Asset ${value.assetIndex}`;
    fields.push(
      ["Position", `${symbol} / ${position.side}`],
      ["Asset incarnation", value.marketId],
      [
        "Shared-loss step budget",
        `${value.budget} ${client.profile.collateral.symbol}`,
      ],
      [
        "Forfeiture",
        "This step discards positive price and funding gains that have not been booked for this leg. It still applies losses and may consume collateral. It cannot be undone.",
      ],
      [
        "Budget scope",
        "The budget only bounds shared-loss settlement work. It does not cap price or funding losses, collateral consumed, or gains forfeited.",
      ],
      [
        "Completion",
        "One step may leave an obligation or require further recovery. No token withdrawal is included. Refresh after confirmation.",
      ],
    );
  }
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
$("operator-notice").hidden = !operatorMode;
$("settings-button").hidden = !operatorMode;
$("settings-button").addEventListener("click", () => {
  if (operatorMode && !busy) $("settings-dialog").showModal();
});
$("profile-file").addEventListener("change", (event) => {
  if (!operatorMode) return;
  void action(async () => {
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
  });
});
$("market-retry").addEventListener("click", () => {
  if (!busy) void loadOfficialMarket();
});
$("wallet-button").addEventListener("click", () => {
  if (account) {
    resetWallet();
    return;
  }
  if (!client) {
    return;
  }
  walletSelection++;
  walletError();
  showWallets();
  $("wallet-dialog").showModal();
});
$("wallet-dialog").addEventListener("cancel", () => walletSelection++);
$("wallet-dialog").addEventListener("close", () => {
  if (!$("wallet-dialog").open) walletSelection++;
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
$("settlement-close").addEventListener("click", () =>
  action(() => reviewAction({ type: "closeResolved" })),
);
$("settlement-claim").addEventListener("click", () =>
  action(() => reviewAction({ type: "claimResolvedPayoutTopup" })),
);
$("portfolio-close").addEventListener("click", () =>
  action(() => reviewAction({ type: "closePortfolio" })),
);
$("recovery-consent").addEventListener("change", controls);
$("recovery-budget").addEventListener("input", controls);
$("recovery-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const asset = selectedAsset();
  void action(() =>
    reviewAction({
      type: "forfeitRecoveryLeg",
      assetIndex: asset?.index,
      marketId: asset?.market_id.toString(),
      budget: $("recovery-budget").value,
      acceptForfeiture: $("recovery-consent").checked,
    }),
  );
});
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
function preventSubmissionDismissal(event) {
  if (submitting) event.preventDefault();
}
$("review-dialog").addEventListener("cancel", preventSubmissionDismissal);
$("review-dialog")
  .querySelector("form")
  .addEventListener("submit", preventSubmissionDismissal);
$("sign").addEventListener("click", () =>
  action(async () => {
    const prepared = review,
      selectedWallet = wallet,
      selectedAccount = account,
      selectedClient = client,
      current = generation;
    if (!prepared || !selectedAccount)
      throw new Error("Review the action again");
    submitting = true;
    setText(
      "review-progress",
      "Complete or reject the request in your wallet.",
    );
    controls();
    let record;
    try {
      record = await selectedClient.submit(prepared, async (transaction) => {
        if (wallet !== selectedWallet || account !== selectedAccount)
          throw new Error("Wallet account changed");
        const [result] = await selectedWallet.features[
          "solana:signTransaction"
        ].signTransaction({
          account: selectedAccount,
          transaction,
          ...(walletChain(selectedClient.profile.cluster)
            ? { chain: walletChain(selectedClient.profile.cluster) }
            : {}),
        });
        if (wallet !== selectedWallet || account !== selectedAccount)
          throw new Error("Wallet account changed before submission");
        setText(
          "review-progress",
          "Verifying and submitting the signed transaction.",
        );
        return result.signedTransaction;
      });
    } catch (error) {
      if (current !== generation) return;
      // Submission consumes its review even when signing or revalidation fails.
      // Close the unusable dialog so its error and the next review are reachable.
      invalidateReview();
      // The send may have succeeded before its status update failed. Recover
      // the durable signature instead of leaving an earlier or empty receipt.
      let savedReceipt,
        receiptUnavailable = false;
      try {
        savedReceipt = await selectedClient.receipt(selectedAccount.address);
      } catch {
        receiptUnavailable = true;
      }
      if (current !== generation) return;
      if (savedReceipt || receiptUnavailable) {
        clearSnapshot("Not available");
        setText("footer-state", "Connection needs attention");
        renderReceipt(savedReceipt || null);
        if (receiptUnavailable) {
          setText("receipt-state", "Receipt unavailable");
          setText(
            "receipt-description",
            "The saved receipt could not be read. Restore browser storage and refresh before taking another action.",
          );
        }
      }
      throw error;
    } finally {
      submitting = false;
      controls();
    }
    // A signed transaction can outlive its wallet session. Keep its durable
    // receipt for that account without restoring the old session's display.
    if (current !== generation) return;
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
  let record;
  try {
    record = await selectedClient.reconcile(selectedAccount.address);
  } catch (error) {
    if (current !== generation) return;
    invalidateReview();
    clearSnapshot("Not available");
    setText("footer-state", "Connection needs attention");
    // Keep the visible signature and durable receipt available for recovery.
    throw error;
  }
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
  const current = generation;
  void action(async () => {
    await reconcile();
    if (current === generation && client && account) await refresh();
  });
}, 10_000);
controls();
void loadOfficialMarket();
