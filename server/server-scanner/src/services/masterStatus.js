const fs = require("fs");
const { stockLensScannerConfigPaths } = require("../../../../shared/config/paths");

const DEFAULT_MASTER_MAX_AGE_MINUTES = 30;
const MASTER_MAX_AGE_FILE = stockLensScannerConfigPaths.masterMaxAgeMinutesFile;

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function getMasterMaxAgeMinutes() {
  try {
    const raw = fs.readFileSync(MASTER_MAX_AGE_FILE, "utf8");
    const parsed = parsePositiveInt(raw);
    return parsed || DEFAULT_MASTER_MAX_AGE_MINUTES;
  } catch {
    return DEFAULT_MASTER_MAX_AGE_MINUTES;
  }
}

function formatTimestampIST(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

module.exports = {
  DEFAULT_MASTER_MAX_AGE_MINUTES,
  MASTER_MAX_AGE_FILE,
  getMasterMaxAgeMinutes,
  formatTimestampIST,
};
