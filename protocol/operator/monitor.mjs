import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const hash = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const amount = (s) => typeof s === "string" && /^(0|[1-9][0-9]{0,19})$/.test(s);
const results = new Set([
  "simulated", "submitted", "unknown", "pending", "confirmed", "finalized",
  "failed", "expiredUnresolved", "waitingForBlockhash", "idle",
  "simulationRejected", "deferred", "noTargets",
]);
const visits = new Set(["simulated", "submitted", "unknown", "idle", "simulationRejected", "deferred"]);
const reasons = new Set(["portfolioMissing", "ownerDelay", "payoutAccountMissing", "payoutHalted"]);

// These files contain observations only. They never replace or repair state.json.
export async function readPrivateJson(directory, name, optional = false) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink() || root.mode & 0o077)
    throw new Error("Keeper monitoring requires a private state directory");
  let file;
  try {
    file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1_048_576 || stat.mode & 0o077)
      throw new Error("Invalid keeper monitoring file");
    const bytes = await file.readFile();
    if (bytes.length > 1_048_576) throw new Error("Invalid keeper monitoring file");
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await file.close();
  }
}

async function writeReport(directory, report) {
  const path = join(directory, `health-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(path, "wx", 0o600);
    await file.writeFile(JSON.stringify(report) + "\n");
    await file.sync();
    await file.close();
    file = null;
    await rename(path, join(directory, "health.json"));
    const root = await open(directory, "r");
    try { await root.sync(); } finally { await root.close(); }
  } finally {
    if (file) await file.close();
    await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

function validateReport(r) {
  if (!r || r.version !== 1 || !hash(r.configHash) || !hash(r.stateHash) ||
      !["starting", "running", "stopped", "failed"].includes(r.phase) ||
      !["send", "simulate"].includes(r.mode) ||
      !["updatedAtMs", "minimumSlot", "cursor", "targetCount", "totalSteps", "sweepFailures", "lastSweepFailures"].every((k) => integer(r[k])) ||
      !["lastTickAtMs", "cycleMs", "slotAdvancedAtMs", "sweepStartedAtMs", "lastSweepAtMs", "pendingSinceMs"].every((k) =>
        r[k] === null || integer(r[k])) ||
      !["reservedFees", "feeBudget", "maxFee"].every((k) => amount(r[k])) ||
      (r.result !== null && !results.has(r.result)) ||
      (r.reason !== null && !reasons.has(r.reason)) ||
      (r.pendingStatus !== null && !["signed", "submitted", "unknown", "pending", "expiredUnresolved"].includes(r.pendingStatus)))
    throw new Error("Invalid keeper health report");
  return r;
}

export async function openKeeperMonitor(directory, config, state, { send = false, now = Date.now } = {}) {
  const configHash = digest(config);
  if (state && state.configHash !== configHash)
    throw new Error("Keeper journal does not match the configuration");
  const previous = await readPrivateJson(directory, "health.json", true);
  if (previous) validateReport(previous);
  if (previous?.configHash && previous.configHash !== configHash)
    throw new Error("Keeper health history does not match the configuration");
  let report = previous ?? {
    version: 1, configHash, stateHash: digest(state), mode: send ? "send" : "simulate",
    phase: "starting", updatedAtMs: 0, lastTickAtMs: null, cycleMs: null,
    result: null, reason: null, minimumSlot: 0, slotAdvancedAtMs: null,
    cursor: 0, targetCount: config.discovery ? 0 : config.targets.length,
    totalSteps: config.discovery ? 0 : config.targets.length * config.assets.length,
    sweepStartedAtMs: null, lastSweepAtMs: null, sweepFailures: 0, lastSweepFailures: 0,
    pendingStatus: null, pendingSinceMs: null,
    reservedFees: "0", feeBudget: config.feeBudgetLamports, maxFee: config.maxFeeLamports,
  };
  // A crash between the journal and health writes leaves timing unknown. Do not
  // restart a partially visited sweep's clock and advertise a fresh service.
  if (state && (!previous || previous.stateHash !== digest(state)))
    report = { ...report, sweepStartedAtMs: null, slotAdvancedAtMs: null,
      sweepFailures: report.sweepFailures + 1 };
  const save = async (changes) => {
    const timestamp = now();
    if (!integer(timestamp) || timestamp < report.updatedAtMs)
      throw new Error("Keeper monitoring clock moved backwards");
    report = validateReport({ ...report, ...changes, updatedAtMs: timestamp });
    await writeReport(directory, report);
  };
  await save({ phase: "starting", mode: send ? "send" : "simulate" });
  return {
    async record(result, before, after, startedAtMs, discoveredTargets = before?.discovery?.targets.length) {
      const timestamp = now();
      if (!integer(startedAtMs) || startedAtMs > timestamp || !after ||
          after.configHash !== configHash || !integer(after.minimumSlot) ||
          after.minimumSlot < report.minimumSlot || !results.has(result.status))
        throw new Error("Invalid keeper monitoring observation");
      let sweepStartedAtMs = report.sweepStartedAtMs;
      let lastSweepAtMs = report.lastSweepAtMs;
      let sweepFailures = report.sweepFailures +
        Number(["failed", "simulationRejected", "unknown", "deferred"].includes(result.status));
      let lastSweepFailures = report.lastSweepFailures;
      // A sweep counts visits, including rejected/deferred attempts, not successful
      // liquidations or payouts. Pending receipts have a separate age check.
      if (result.status === "noTargets" || (visits.has(result.status) && after.cursor === 0)) {
        sweepStartedAtMs = null;
        lastSweepAtMs = timestamp;
        if (result.status !== "noTargets") {
          lastSweepFailures = sweepFailures;
          sweepFailures = 0;
        }
      } else if (!before?.pending && sweepStartedAtMs === null &&
          (!before || (before.cursor === 0 && !before.discovery))) {
        sweepStartedAtMs = startedAtMs;
      }
      const targetCount = config.discovery
        ? after.discovery?.targets.length ?? (result.status === "noTargets" ? 0 : discoveredTargets ?? report.targetCount)
        : config.targets.length;
      const pendingSinceMs = after.pending ? Date.parse(after.pending.createdAt) : null;
      await save({
        phase: "running", stateHash: digest(after), lastTickAtMs: timestamp,
        cycleMs: timestamp - startedAtMs, result: result.status,
        reason: reasons.has(result.reason) ? result.reason : null,
        minimumSlot: after.minimumSlot,
        slotAdvancedAtMs: after.minimumSlot > report.minimumSlot ? timestamp : report.slotAdvancedAtMs,
        cursor: after.cursor, targetCount,
        totalSteps: targetCount * config.assets.length, sweepStartedAtMs, lastSweepAtMs,
        sweepFailures, lastSweepFailures,
        pendingStatus: after.pending?.status ?? null,
        pendingSinceMs: integer(pendingSinceMs) ? pendingSinceMs : null,
        reservedFees: after.reservedFees,
      });
    },
    async stop(failed = false) {
      await save({ phase: failed || report.phase === "failed" ? "failed" : "stopped" });
    },
  };
}

export const defaultHealthLimits = Object.freeze({
  maxAgeMs: 15000, maxPendingMs: 60000, maxSweepMs: 300000,
  maxSlotStallMs: 30000, maxCycleMs: 15000, minTargets: 1,
});

export function evaluateKeeperHealth(report, state, config, limits = {}, now = Date.now()) {
  const bounds = { ...defaultHealthLimits, ...limits };
  if (!integer(now) || Object.keys(bounds).some((k) => !(k in defaultHealthLimits) ||
      !integer(bounds[k]) || (k !== "minTargets" && bounds[k] === 0)))
    throw new Error("Invalid keeper health thresholds");
  validateReport(report);
  const problems = [];
  const add = (test, reason) => { if (test) problems.push(reason); };
  add(report.configHash !== digest(config), "configurationMismatch");
  add(report.stateHash !== digest(state) || state?.configHash !== report.configHash, "journalChanged");
  add(report.phase !== "running", report.phase);
  add(report.mode !== "send", "simulationOnly");
  const timeFields = ["updatedAtMs", "lastTickAtMs", "slotAdvancedAtMs", "sweepStartedAtMs", "lastSweepAtMs", "pendingSinceMs"];
  add(timeFields.some((k) => report[k] !== null && report[k] > now), "clockMovedBackwards");
  add(report.lastTickAtMs === null || now - report.lastTickAtMs > bounds.maxAgeMs, "heartbeatStale");
  add(report.cycleMs !== null && report.cycleMs > bounds.maxCycleMs, "cycleSlow");
  add(report.slotAdvancedAtMs === null || now - report.slotAdvancedAtMs > bounds.maxSlotStallMs, "slotStalled");
  add(report.targetCount < bounds.minTargets, "tooFewTargets");
  add(!!config.discovery && report.targetCount >= config.discovery.maxTargets, "discoveryCapacityReached");
  add(report.sweepStartedAtMs === null && (report.cursor !== 0 || state?.discovery != null), "sweepHistoryMissing");
  const sweepTime = report.sweepStartedAtMs ?? report.lastSweepAtMs;
  add(report.targetCount > 0 && (sweepTime === null || now - sweepTime > bounds.maxSweepMs), "sweepOverdue");
  add(report.pendingStatus !== null && report.pendingSinceMs === null, "receiptTimeMissing");
  add(report.pendingSinceMs !== null && now - report.pendingSinceMs > bounds.maxPendingMs, "receiptOverdue");
  add(report.pendingStatus === "expiredUnresolved", "receiptUnresolved");
  add(["failed", "simulationRejected", "unknown"].includes(report.result), "transactionRejectedOrUnknown");
  add(report.result === "deferred", report.reason ?? "targetDeferred");
  add(report.sweepFailures > 0 || report.lastSweepFailures > 0, "sweepHadFailures");
  const remaining = BigInt(report.feeBudget) - BigInt(report.reservedFees);
  add(remaining < BigInt(report.maxFee), "feeBudgetLow");
  return {
    version: 1, status: problems.length ? "unhealthy" : "healthy", reasons: problems,
    phase: report.phase, mode: report.mode, result: report.result,
    updatedAtMs: report.updatedAtMs, lastTickAtMs: report.lastTickAtMs,
    cycleMs: report.cycleMs, minimumSlot: report.minimumSlot,
    targetCount: report.targetCount, totalSteps: report.totalSteps, cursor: report.cursor,
    sweepFailures: report.sweepFailures, lastSweepFailures: report.lastSweepFailures,
    pendingAgeMs: report.pendingSinceMs === null ? null : Math.max(0, now - report.pendingSinceMs),
    sweepAgeMs: sweepTime === null ? null : Math.max(0, now - sweepTime),
    reservedFeeLamports: report.reservedFees, remainingFeeLamports: remaining.toString(),
  };
}
