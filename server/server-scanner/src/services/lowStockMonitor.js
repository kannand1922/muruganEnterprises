const fs = require("fs");
const { masterFilePath } = require("./masterProducts");
const { runLowStockCheckAndNotify } = require("./lowStockAlerts");

const DEFAULT_POLL_INTERVAL_MS = 15000;

let intervalHandle = null;
let lastMtimeMs = null;
let scanInFlight = false;
let warnedMissingFile = false;

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
    const result = await runLowStockCheckAndNotify({ trigger });
    const notifySummary = Array.isArray(result.notifyResults)
      ? result.notifyResults
          .map((row) => {
            const locationName = String(row.locationName || row.shopLocationId || "location");
            const status = row.sent ? "sent" : row.reason || "skipped";
            return `${locationName}:${status}:${Number(row.lowCount || 0)}`;
          })
          .join(" | ")
      : "no-results";
    console.log(
      `Low stock monitor: trigger=${trigger}, lowLocations=${result.locationsWithLowStock}, totalLowProducts=${result.totalLowProducts}, csvVersion=${result.csvVersion}, notify=${notifySummary}`
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

  const pollIntervalMs = getPollIntervalMs();
  intervalHandle = setInterval(() => {
    void pollOnce();
  }, pollIntervalMs);

  console.log(
    `Low stock monitor started. Watching ${masterFilePath} every ${pollIntervalMs}ms for changes.`
  );
}

function stopLowStockMonitor() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  console.log("Low stock monitor stopped.");
}

module.exports = {
  startLowStockMonitor,
  stopLowStockMonitor,
  triggerLowStockScan,
};
