const fs = require("fs");
const { masterFilePath } = require("./masterProducts");
const { runLowStockCheckAndNotify } = require("./lowStockAlerts");
const { runNilStockCheckAndNotify } = require("./nilStockAlerts");

const DEFAULT_POLL_INTERVAL_MS = 15000;

let intervalHandle = null;
let lastMtimeMs = null;
let scanInFlight = false;
let warnedMissingFile = false;
let dailyResetTimeoutHandle = null;

function formatTimestamp(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString();
}

function getPollIntervalMs() {
  const raw = Number(process.env.LOW_STOCK_WATCH_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 5000) return DEFAULT_POLL_INTERVAL_MS;
  return Math.trunc(raw);
}

function getMsUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleDailyResetTrigger() {
  if (dailyResetTimeoutHandle) {
    clearTimeout(dailyResetTimeoutHandle);
    dailyResetTimeoutHandle = null;
  }

  dailyResetTimeoutHandle = setTimeout(() => {
    dailyResetTimeoutHandle = null;
    void (async () => {
      await triggerLowStockScan("daily_reset");
      scheduleDailyResetTrigger();
    })();
  }, getMsUntilNextLocalMidnight());

  if (typeof dailyResetTimeoutHandle.unref === "function") {
    dailyResetTimeoutHandle.unref();
  }
}

async function readCsvMtimeMs() {
  try {
    const stat = await fs.promises.stat(masterFilePath);
    warnedMissingFile = false;
    return stat.mtimeMs;
  } catch (error) {
    if (!warnedMissingFile) {
      warnedMissingFile = true;
      console.warn(`Low stock monitor: master CSV not available at ${masterFilePath}`);
    }
    return null;
  }
}

async function triggerLowStockScan(trigger) {
  if (scanInFlight) {
    console.log(`Low stock monitor: skipped trigger=${trigger} because scan is already running`);
    return;
  }
  scanInFlight = true;
  try {
    const [lowResult, nilResult] = await Promise.all([
      runLowStockCheckAndNotify({ trigger }),
      runNilStockCheckAndNotify({ trigger }),
    ]);
    const lowNotifySummary = Array.isArray(lowResult.notifyResults)
      ? lowResult.notifyResults
          .map((row) => {
            const locationName = String(row.locationName || row.shopLocationId || "location");
            const status = row.sent ? "sent" : row.reason || "skipped";
            return `${locationName}:${status}:${Number(row.lowCount || 0)}`;
          })
          .join(" | ")
      : "no-results";
    const nilNotifySummary = Array.isArray(nilResult.notifyResults)
      ? nilResult.notifyResults
          .map((row) => {
            const locationName = String(row.locationName || row.shopLocationId || "location");
            const status = row.sent ? "sent" : row.reason || "skipped";
            return `${locationName}:${status}:${Number(row.nilCount || 0)}`;
          })
          .join(" | ")
      : "no-results";
    console.log(
      `Low stock monitor: trigger=${trigger}, lowLocations=${lowResult.locationsWithLowStock}, totalLowProducts=${lowResult.totalLowProducts}, nilLocations=${nilResult.locationsWithNilStock}, totalNilProducts=${nilResult.totalNilProducts}, csvVersion=${lowResult.csvVersion}, lowNotify=${lowNotifySummary}, nilNotify=${nilNotifySummary}`
    );
  } catch (error) {
    console.error(`Low stock monitor failed (${trigger}):`, error);
  } finally {
    scanInFlight = false;
  }
}

async function pollOnce() {
  const mtimeMs = await readCsvMtimeMs();
  if (!mtimeMs) return;

  if (lastMtimeMs === null) {
    lastMtimeMs = mtimeMs;
    console.log(
      `Low stock monitor: baseline mtime set to ${formatTimestamp(mtimeMs)}`
    );
    return;
  }

  if (mtimeMs !== lastMtimeMs) {
    console.log(
      `Low stock monitor: brands.csv changed from ${formatTimestamp(lastMtimeMs)} to ${formatTimestamp(mtimeMs)}`
    );
    lastMtimeMs = mtimeMs;
    await triggerLowStockScan("master_csv_changed");
  }
}

async function startLowStockMonitor() {
  if (intervalHandle) return;

  lastMtimeMs = await readCsvMtimeMs();
  console.log(
    `Low stock monitor: initial csv mtime ${lastMtimeMs ? formatTimestamp(lastMtimeMs) : "missing"}`
  );
  if (lastMtimeMs !== null) {
    await triggerLowStockScan("server_startup");
  }

  scheduleDailyResetTrigger();
  const pollIntervalMs = getPollIntervalMs();
  intervalHandle = setInterval(() => {
    void pollOnce();
  }, pollIntervalMs);

  console.log(
    `Low stock monitor started. Watching ${masterFilePath} every ${pollIntervalMs}ms for changes.`
  );
}

function stopLowStockMonitor() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (dailyResetTimeoutHandle) {
    clearTimeout(dailyResetTimeoutHandle);
    dailyResetTimeoutHandle = null;
  }
  console.log("Low stock monitor stopped.");
}

module.exports = {
  startLowStockMonitor,
  stopLowStockMonitor,
  triggerLowStockScan,
};
