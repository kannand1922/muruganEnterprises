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

function formatAgeLabel(ageMs) {
  const safeAgeMs = Math.max(0, Number(ageMs) || 0);
  const totalMinutes = Math.floor(safeAgeMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    if (hours > 0) return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"} ago`;
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (hours > 0) {
    if (minutes > 0) return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

module.exports = {
  DEFAULT_MASTER_MAX_AGE_MINUTES,
  MASTER_MAX_AGE_FILE,
  getMasterMaxAgeMinutes,
  formatTimestampIST,
  formatAgeLabel,
};
