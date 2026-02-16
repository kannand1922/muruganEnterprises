const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Readable } = require("stream");
const {
  myAppPaths,
  stockLensPaths,
  getCycleFilePath,
  adminPasswordFile,
} = require("../path/path");
const {
  allocateCode,
  releaseCode,
  markPrinted,
  getStatus,
} = require("../pool/codePool");

const { productsCsv: myAppProducts, printersCsv: myAppPrinters } = myAppPaths;

const {
  brandsCsv: stockLensBrands,
  bestSellingCsv: stockLensBestSelling,
  cycleManagementCsv: stockLensCycleManagement,
  workerCsv: stockLensWorkerCsv,
  dataDir: stockLensDir,
} = stockLensPaths;

const CYCLE_MANAGEMENT_FILE = stockLensCycleManagement;
const ADMIN_PASSWORD_FILE = adminPasswordFile;
const SUPER_ADMIN_PASSWORD =
  typeof process.env.SUPER_ADMIN_PASSWORD === "string"
    ? process.env.SUPER_ADMIN_PASSWORD.trim()
    : "super@admin";
const fsPromises = fs.promises;
const BRAND_MONITOR_INTERVAL_MS = parseInt(
  process.env.BRAND_MONITOR_INTERVAL_MS || "60000",
  10
);
const CYCLE_HISTORY_ENABLED =
  typeof process.env.CYCLE_HISTORY_ENABLED === "string"
    ? process.env.CYCLE_HISTORY_ENABLED.trim().toLowerCase() === "true"
    : false;

let brandMonitorTimer = null;
let brandMonitorState = {
  snapshot: null,
  mtimeMs: null,
};
let brandMonitorStarted = false;

function readAdminPassword() {
  const envPassword =
    typeof process.env.ADMIN_PASSWORD === "string"
      ? process.env.ADMIN_PASSWORD.trim()
      : "";
  if (envPassword) {
    return envPassword;
  }

  try {
    const raw = fs.readFileSync(ADMIN_PASSWORD_FILE, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const [key, ...rest] = line.split("=");
      if (!key || rest.length === 0) continue;
      if (key.trim().toLowerCase() === "admin_password") {
        const value = rest.join("=").trim();
        return value || "admin";
      }
    }
    const firstLine = lines.find((line) => line && !line.startsWith("#"));
    return firstLine || "admin";
  } catch (error) {
    return "admin";
  }
}

function readAdminConfigValue(key) {
  try {
    const raw = fs.readFileSync(ADMIN_PASSWORD_FILE, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const [k, ...rest] = line.split("=");
      if (!k || rest.length === 0) continue;
      if (k.trim().toLowerCase() === key.toLowerCase()) {
        return rest.join("=").trim();
      }
    }
    return "";
  } catch (error) {
    return "";
  }
}

function readShopName() {
  const envShopName =
    typeof process.env.SHOP_NAME === "string"
      ? process.env.SHOP_NAME.trim()
      : "";
  if (envShopName) {
    return envShopName;
  }
  return (
    readAdminConfigValue("shop_name") ||
    readAdminConfigValue("shop name") ||
    readAdminConfigValue("shopname") ||
    ""
  );
}

function isOptionalPasswordValid(password) {
  if (!password) {
    return true;
  }
  const normalized = password.trim();
  if (!normalized) {
    return true;
  }
  const adminPassword = readAdminPassword();
  return normalized === adminPassword || normalized === SUPER_ADMIN_PASSWORD;
}

function isAdminPasswordValid(password) {
  const normalized =
    typeof password === "string" ? password.trim() : String(password || "").trim();
  if (!normalized) {
    return false;
  }
  const adminPassword = readAdminPassword();
  return normalized === adminPassword || normalized === SUPER_ADMIN_PASSWORD;
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readCsv(filePath, res) {
  const results = [];

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", () => {
      res.json({ success: true, count: results.length, data: results });
    })
    .on("error", (error) => {
      res.status(500).json({ success: false, error: error.message });
    });
}

function readBrandsCsv(filePath, res) {
  let rawData = "";

  fs.createReadStream(filePath)
    .on("error", (error) => {
      res.status(500).json({ success: false, error: error.message });
    })
    .on("data", (chunk) => {
      rawData += chunk.toString("utf8");
    })
    .on("end", () => {
      const lines = rawData.split(/\r?\n/).filter((line) => line.trim() !== "");

      if (lines.length < 5) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid CSV format" });
      }

      const title = lines[0].replace(/^,,/, "").trim();
      const subtitle = lines[1].replace(/^,,/, "").trim();
      const dateStr = lines[2].replace(/^,,/, "").trim();

      const tableLines = lines.slice(3).join("\n");
      const results = [];

      Readable.from(tableLines)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => {
          res.json({
            success: true,
            title,
            subtitle,
            date: dateStr,
            count: results.length,
            data: results,
          });
        });
    });
}

function formatTimestampIST(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const partMap = {};
  parts.forEach(({ type, value }) => {
    partMap[type] = value;
  });

  const dayPeriod = partMap.dayPeriod ? partMap.dayPeriod.toLowerCase() : "";
  const timeString = [partMap.hour, partMap.minute, partMap.second]
    .filter(Boolean)
    .join(":");

  return `${partMap.year}-${partMap.month}-${partMap.day}, ${timeString} ${
    dayPeriod || ""
  }`.trim();
}

function extractDateFromLastUpdated(lastUpdated) {
  if (!lastUpdated || typeof lastUpdated !== "string") return null;
  const [datePart] = lastUpdated.split(",");
  return datePart ? datePart.trim() : null;
}

function parseJsonArray(rawValue) {
  if (!rawValue || !rawValue.toString().trim()) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function extractDateFromTimestamp(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const datePart = extractDateFromLastUpdated(trimmed);
  if (datePart) {
    const normalized = normalizeBrandsDate(datePart) || datePart;
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return normalized;
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return null;
}

function hasProductActivityOnDate(product, targetDate) {
  if (!product || !targetDate) return false;

  const directDates = [
    product.LastUpdated,
    product.UnfinishedLastUpdated,
    product.FinishedLastUpdated,
  ]
    .map(extractDateFromTimestamp)
    .filter(Boolean);

  if (directDates.includes(targetDate)) return true;

  const changeLog = parseJsonArray(product.ChangeLog || "[]");
  if (
    changeLog.some(
      (entry) =>
        extractDateFromTimestamp(entry?.date || entry?.time) === targetDate
    )
  ) {
    return true;
  }

  const unfinishedChangeLog = parseUnfinishedData(
    product.UnfinishedChangeLog || "[]"
  );
  for (const container of unfinishedChangeLog) {
    const containerDate = extractDateFromTimestamp(container?.date);
    if (containerDate === targetDate) return true;
    const data =
      container && typeof container === "object" && container.data
        ? container.data
        : container;
    const logs = Array.isArray(data?.logs)
      ? data.logs
      : Array.isArray(container?.logs)
      ? container.logs
      : [];
    if (
      logs.some(
        (entry) =>
          extractDateFromTimestamp(entry?.date || entry?.time) === targetDate
      )
    ) {
      return true;
    }
  }

  return false;
}

function normalizeOperatorName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeLocationKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "shop") return "shop";
  if (normalized === "godown") return "godown";
  return normalized;
}

function parseRecheckShown(rawValue) {
  if (!rawValue) return { shop: false, godown: false };
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return { shop: false, godown: false };
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          shop: Boolean(parsed?.shop),
          godown: Boolean(parsed?.godown),
        };
      } catch {
        return { shop: false, godown: false };
      }
    }
    const upper = trimmed.toUpperCase();
    if (upper === "YES") return { shop: true, godown: true };
    if (upper === "NO") return { shop: false, godown: false };
  }
  return { shop: false, godown: false };
}

function serializeRecheckShown(state) {
  const shop = Boolean(state?.shop);
  const godown = Boolean(state?.godown);
  if (shop && godown) return "YES";
  if (!shop && !godown) return "NO";
  return JSON.stringify({ shop, godown });
}

function hasRecheckShownForLocation(rawValue, location) {
  const state = parseRecheckShown(rawValue);
  const key = normalizeLocationKey(location);
  if (key === "shop") return state.shop;
  if (key === "godown") return state.godown;
  return false;
}

function setRecheckShownForLocation(row, location, value) {
  if (!row) return;
  const state = parseRecheckShown(row.RecheckShown);
  const key = normalizeLocationKey(location);
  if (key === "shop") state.shop = Boolean(value);
  if (key === "godown") state.godown = Boolean(value);
  row.RecheckShown = serializeRecheckShown(state);
}

function resolveOperatorFromLog(entry) {
  if (!entry || typeof entry !== "object") return "";
  return normalizeOperatorName(
    entry.operatorName || entry.user || entry.userName || entry.operator || ""
  );
}

function hasOperatorUnfinishedOnDate(product, targetDate, operatorName) {
  if (!product || !targetDate) return false;
  const normalizedOperator = normalizeOperatorName(operatorName);
  if (!normalizedOperator) return false;

  const unfinishedChangeLog = parseUnfinishedData(
    product.UnfinishedChangeLog || "[]"
  );
  let latestOperator = "";
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let latestSequence = -1;
  let sequence = 0;

  for (const container of unfinishedChangeLog) {
    const containerDate = extractDateFromTimestamp(container?.date);
    const data =
      container && typeof container === "object" && container.data
        ? container.data
        : container;
    const logs = Array.isArray(data?.logs)
      ? data.logs
      : Array.isArray(container?.logs)
      ? container.logs
      : [];
    for (const entry of logs) {
      const currentSequence = sequence;
      sequence += 1;
      const entryDate = extractDateFromTimestamp(
        entry?.date || entry?.time || containerDate
      );
      if (entryDate !== targetDate) continue;
      const entryOperator = resolveOperatorFromLog(entry);
      if (!entryOperator) continue;
      const rawTimestamp = entry?.time || entry?.date || container?.date || "";
      const parsedTimestamp = rawTimestamp ? Date.parse(rawTimestamp) : NaN;
      const comparableTimestamp = Number.isFinite(parsedTimestamp)
        ? parsedTimestamp
        : Number.NEGATIVE_INFINITY;
      if (
        comparableTimestamp > latestTimestamp ||
        (comparableTimestamp === latestTimestamp &&
          currentSequence > latestSequence)
      ) {
        latestTimestamp = comparableTimestamp;
        latestSequence = currentSequence;
        latestOperator = entryOperator;
      }
    }
  }

  return Boolean(latestOperator) && latestOperator === normalizedOperator;
}

function hasLocationActivityOnDate(product, targetDate, locationType) {
  if (!product || !targetDate || !locationType) return false;
  const normalizedLocation = locationType.toString().toLowerCase();
  const entryMatchesLocation = (entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (entry.location) {
      return entry.location.toString().toLowerCase() === normalizedLocation;
    }
    if (entry.changes && typeof entry.changes === "object") {
      const keys = Object.keys(entry.changes).map((key) => key.toLowerCase());
      return keys.includes(normalizedLocation);
    }
    return false;
  };

  const changeLog = parseJsonArray(product.ChangeLog || "[]");
  for (const entry of changeLog) {
    const entryDate = extractDateFromTimestamp(entry?.date || entry?.time);
    if (entryDate !== targetDate) continue;
    if (entryMatchesLocation(entry)) {
      return true;
    }
  }

  const unfinishedChangeLog = parseUnfinishedData(
    product.UnfinishedChangeLog || "[]"
  );

  for (const container of unfinishedChangeLog) {
    const containerDate = extractDateFromTimestamp(container?.date);
    const data =
      container && typeof container === "object" && container.data
        ? container.data
        : container;
    const logs = Array.isArray(data?.logs)
      ? data.logs
      : Array.isArray(container?.logs)
      ? container.logs
      : [];
    for (const entry of logs) {
      const entryDate = extractDateFromTimestamp(
        entry?.date || entry?.time || containerDate
      );
      if (entryDate !== targetDate) continue;
      if (entryMatchesLocation(entry)) {
        return true;
      }
    }
  }

  return false;
}

function filterCycleProductsByActivityDate(products, targetDate) {
  if (!Array.isArray(products) || !targetDate) return products || [];
  return products.filter((product) =>
    hasProductActivityOnDate(product, targetDate)
  );
}

function isMatchFlagNo(value) {
  return (
    String(value || "")
      .toUpperCase()
      .trim() === "NO"
  );
}

function isStaleUnmatched(row, todayDate) {
  if (!row || !todayDate) return false;
  const hasUnmatched =
    isMatchFlagNo(row.ShopMatched) || isMatchFlagNo(row.GodownMatched);
  if (!hasUnmatched) return false;
  const lastUpdatedDate = extractDateFromLastUpdated(row.LastUpdated);
  if (!lastUpdatedDate) return false;
  return lastUpdatedDate !== todayDate;
}

function getTodayDateString() {
  return extractDateFromLastUpdated(formatTimestampIST(new Date()));
}

function normalizeBrandsDate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const dmyMatch = trimmed.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  return null;
}

function parseUnfinishedData(rawValue) {
  if (!rawValue || !rawValue.toString().trim()) {
    return [];
  }
  try {
    // Clean up the value - remove any leading/trailing whitespace and fix common issues
    let cleanedValue = rawValue.toString().trim();

    // If it looks like it was truncated (starts with [ but doesn't end with ]), try to fix it
    if (cleanedValue.startsWith("[") && !cleanedValue.endsWith("]")) {
      // Try to find the last complete entry
      const lastCompleteIndex = cleanedValue.lastIndexOf("}");
      if (lastCompleteIndex > 0) {
        cleanedValue = cleanedValue.substring(0, lastCompleteIndex + 1) + "]";
      } else {
        // If we can't fix it, return empty array
        console.warn(
          "⚠️ Malformed unfinished data, returning empty array:",
          cleanedValue.substring(0, 50)
        );
        return [];
      }
    }

    const parsed = JSON.parse(cleanedValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(
      "⚠️ Failed to parse unfinished data:",
      error.message,
      "Raw value:",
      rawValue?.toString().substring(0, 100)
    );
    return [];
  }
}

function getUnfinishedForDate(unfinishedArray, date) {
  if (!Array.isArray(unfinishedArray)) return null;
  const entry = unfinishedArray.find((item) => item.date === date);
  return entry ? entry.data : null;
}

function updateUnfinishedForDate(unfinishedArray, date, data) {
  if (!Array.isArray(unfinishedArray)) {
    unfinishedArray = [];
  }
  const existingIndex = unfinishedArray.findIndex((item) => item.date === date);
  if (existingIndex >= 0) {
    unfinishedArray[existingIndex].data = data;
  } else {
    unfinishedArray.push({ date, data });
  }
  return unfinishedArray;
}

function collectUnfinishedProductsForDate(data, todayDate, operatorName = "") {
  const unfinishedProducts = [];
  const normalizedOperator = normalizeOperatorName(operatorName);

  data.forEach((row) => {
    if (!row.Brand || !row.Pack) return;
    if (
      normalizedOperator &&
      !hasOperatorUnfinishedOnDate(row, todayDate, normalizedOperator)
    ) {
      return;
    }

    const unfinishedShopArray = parseUnfinishedData(row.UnfinishedShop || "[]");
    const unfinishedGodownArray = parseUnfinishedData(
      row.UnfinishedGodown || "[]"
    );
    const unfinishedChangeLogArray = parseUnfinishedData(
      row.UnfinishedChangeLog || "[]"
    );

    const todayUnfinishedShop = getUnfinishedForDate(
      unfinishedShopArray,
      todayDate
    );
    const todayUnfinishedGodown = getUnfinishedForDate(
      unfinishedGodownArray,
      todayDate
    );
    const todayUnfinishedChangeLog = getUnfinishedForDate(
      unfinishedChangeLogArray,
      todayDate
    );

    const bpc = parseInt(row.BPC || "12", 10);
    const shopCount = todayUnfinishedShop
      ? parseCountValue(todayUnfinishedShop.shop || "0.000", bpc)
      : parseCountValue("0.000", bpc);
    const godownCount = todayUnfinishedGodown
      ? parseCountValue(todayUnfinishedGodown.godown || "0.000", bpc)
      : parseCountValue("0.000", bpc);

    const hasTodayUnfinished = todayUnfinishedShop || todayUnfinishedGodown;
    const includeStaleUnmatched =
      !hasTodayUnfinished && isStaleUnmatched(row, todayDate);
    const hasShopEntry = shopCount.total > 0;
    const hasGodownEntry = godownCount.total > 0;
    const shopFinished = hasShopEntry && !!todayUnfinishedShop?.finished;
    const godownFinished = hasGodownEntry && !!todayUnfinishedGodown?.finished;
    const isFullyFinished =
      (hasShopEntry ? shopFinished : true) &&
      (hasGodownEntry ? godownFinished : true);

    if (hasTodayUnfinished && isFullyFinished) {
      return;
    }

    if (hasTodayUnfinished || includeStaleUnmatched) {
      const hasCounts = shopCount.total > 0 || godownCount.total > 0;
      if (hasCounts || includeStaleUnmatched) {
        unfinishedProducts.push({
          brand: row.Brand,
          pack: row.Pack,
          item:
            row.Item ||
            todayUnfinishedShop?.item ||
            todayUnfinishedGodown?.item ||
            "BEER",
          bpc: bpc,
          mrp: parseFloat(
            row.MRP ||
              todayUnfinishedShop?.mrp ||
              todayUnfinishedGodown?.mrp ||
              "0.00"
          ),
          shop: {
            formatted: shopCount.formatted,
            total: shopCount.total,
            finished: shopFinished,
            hasEntry: hasShopEntry,
          },
          godown: {
            formatted: godownCount.formatted,
            total: godownCount.total,
            finished: godownFinished,
            hasEntry: hasGodownEntry,
          },
          changeLog: todayUnfinishedChangeLog?.logs || [],
        });
      }
    }
  });

  return unfinishedProducts;
}

function getScannedCountsByLocation(data, todayDate, operatorName = "") {
  const counts = { shop: 0, godown: 0 };
  const normalizedOperator = normalizeOperatorName(operatorName);
  if (!Array.isArray(data)) return counts;
  data.forEach((row) => {
    if (
      normalizedOperator &&
      !hasOperatorUnfinishedOnDate(row, todayDate, normalizedOperator)
    ) {
      return;
    }
    if (hasLocationActivityOnDate(row, todayDate, "shop")) {
      counts.shop += 1;
    }
    if (hasLocationActivityOnDate(row, todayDate, "godown")) {
      counts.godown += 1;
    }
  });
  return counts;
}

function parseCountValue(rawValue, bpc) {
  if (rawValue === undefined || rawValue === null) {
    return {
      cases: 0,
      bottles: 0,
      total: 0,
      formatted: "0.000",
    };
  }

  const countStr = rawValue.toString().trim();
  if (!countStr) {
    return {
      cases: 0,
      bottles: 0,
      total: 0,
      formatted: "0.000",
    };
  }

  const bpcValue = parseInt(bpc, 10) || 12;

  const decimalMatch = countStr.match(/^\d+\.(\d{1,3})$/);
  if (decimalMatch) {
    const cases = parseInt(countStr.split(".")[0], 10) || 0;
    const rawBottleDigits = decimalMatch[1];
    const bottles = parseInt(rawBottleDigits, 10) || 0;
    const finalCases = cases;
    return {
      cases: finalCases,
      bottles,
      total: finalCases * bpcValue + bottles,
      formatted: `${finalCases}.${rawBottleDigits.padStart(3, "0")}`,
    };
  }

  const totalBottles = parseFloat(countStr);
  if (Number.isNaN(totalBottles)) {
    return {
      cases: 0,
      bottles: 0,
      total: 0,
      formatted: "0.000",
    };
  }

  let cases = Math.floor(totalBottles / bpcValue);
  let bottles = Math.round(totalBottles - cases * bpcValue);
  if (bottles < 0) {
    bottles = 0;
  }
  if (bottles >= bpcValue) {
    const overflowCases = Math.floor(bottles / bpcValue);
    cases += overflowCases;
    bottles = bottles % bpcValue;
  }

  return {
    cases,
    bottles,
    total: cases * bpcValue + bottles,
    formatted: `${cases}.${bottles.toString().padStart(3, "0")}`,
  };
}

function escapeCsvValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function ensureBestSellingCsvExists() {
  if (fs.existsSync(stockLensBestSelling)) {
    return;
  }
  fs.writeFileSync(stockLensBestSelling, "Item,Brand,Pack\n", "utf8");
}

function writeBestSellingCsv(filePath, rows) {
  const header = "Item,Brand,Pack\n";
  const lines = rows.map((row) => {
    const item = escapeCsvValue(row.Item || row.item || "");
    const brand = escapeCsvValue(row.Brand || row.brand || "");
    const pack = escapeCsvValue(row.Pack || row.pack || "");
    return [item, brand, pack].join(",");
  });
  fs.writeFileSync(filePath, header + lines.join("\n"), "utf8");
}

function ensureWorkerCsvExists() {
  if (fs.existsSync(stockLensWorkerCsv)) {
    return;
  }
  fs.writeFileSync(stockLensWorkerCsv, "Name,Phone,Shop\n", "utf8");
}

function readWorkersCsv(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}

function writeWorkersCsv(filePath, rows) {
  const header = "Name,Phone,Shop\n";
  const lines = rows.map((row) => {
    const name = escapeCsvValue(row.Name || row.name || "");
    const phone = escapeCsvValue(row.Phone || row.phone || "");
    const shop = escapeCsvValue(row.Shop || row.shop || "");
    return [name, phone, shop].join(",");
  });
  fs.writeFileSync(filePath, header + lines.join("\n"), "utf8");
}

async function loadFastMovingSummary({ cycleDate, location, analysisDate }) {
  const normalizedLocation = (location || "").toString().toLowerCase();
  if (
    !cycleDate ||
    (normalizedLocation !== "shop" && normalizedLocation !== "godown")
  ) {
    return null;
  }

  const brandsFilePath = stockLensBrands;
  const bestSellingPath = stockLensBestSelling;
  const cycleFilePath = getCycleFilePath(cycleDate);

  if (
    !fs.existsSync(brandsFilePath) ||
    !fs.existsSync(bestSellingPath) ||
    !fs.existsSync(cycleFilePath)
  ) {
    return null;
  }

  const [masterData, cycleData, bestSellingData] = await Promise.all([
    parseCycleCsv(brandsFilePath),
    parseCycleCsv(cycleFilePath),
    parseCycleCsv(bestSellingPath),
  ]);

  const masterProducts = masterData.data || [];
  const scannedProducts = cycleData.data || [];
  const bestSellingList = bestSellingData.data || [];

  const filteredScannedProducts = analysisDate
    ? scannedProducts.filter((product) =>
        hasLocationActivityOnDate(product, analysisDate, normalizedLocation)
      )
    : scannedProducts;

  const masterMap = new Map();
  masterProducts.forEach((product) => {
    const brand = product.Brand?.trim();
    const pack = product.Pack?.toString().trim();
    if (!brand || !pack) return;
    const key = `${brand.toLowerCase()}_${pack}`;
    masterMap.set(key, product);
  });

  const filteredMap = new Map();
  filteredScannedProducts.forEach((product) => {
    const brand = product.Brand?.toLowerCase().trim();
    const pack = product.Pack?.toString().trim();
    if (!brand || !pack) return;
    const key = `${brand}_${pack}`;
    filteredMap.set(key, product);
  });

  const locationField =
    normalizedLocation.charAt(0).toUpperCase() + normalizedLocation.slice(1);

  const parseScannedCount = (product) => {
    if (!product) return null;
    const rawCount = product[locationField];
    if (rawCount === undefined || rawCount === null || rawCount === "") {
      return null;
    }
    return parseCountValue(rawCount, product.BPC);
  };

  let trackedProducts = 0;
  let scannedProductCount = 0;

  bestSellingList.forEach((bestProduct) => {
    const brand = bestProduct.Brand?.trim();
    const pack = bestProduct.Pack?.toString().trim();
    if (!brand || !pack) return;

    const key = `${brand.toLowerCase()}_${pack}`;
    const masterProduct = masterMap.get(key);
    if (!masterProduct) return;

    const bpc =
      parseInt(masterProduct?.BPC || bestProduct.BPC || "12", 10) || 12;
    const masterCount = parseCountValue(masterProduct[locationField], bpc);
    if ((masterCount.total || 0) <= 0) return;

    trackedProducts += 1;

    const scannedProduct = filteredMap.get(key);
    const currentCount = parseScannedCount(scannedProduct);
    if (currentCount) {
      scannedProductCount += 1;
    }
  });

  return {
    trackedProducts,
    scannedProductCount,
    notScannedProductCount: Math.max(trackedProducts - scannedProductCount, 0),
    label: normalizedLocation === "shop" ? "Shop" : "Godown",
  };
}

function getMatchedFieldForLocation(location) {
  if (!location) return "GodownMatched";
  const normalized = location.toString().toLowerCase();
  return normalized === "shop" ? "ShopMatched" : "GodownMatched";
}

function getPersistedMatchTimestamp(product, matchedField) {
  if (!product) return null;
  const directValue = product[matchedField];
  if (
    directValue !== undefined &&
    directValue !== null &&
    directValue.toString().trim() !== ""
  ) {
    return directValue;
  }
  const lowerKey = matchedField.toLowerCase();
  const lowerValue = product[lowerKey];
  if (
    lowerValue !== undefined &&
    lowerValue !== null &&
    lowerValue.toString().trim() !== ""
  ) {
    return lowerValue;
  }
  return null;
}

function persistMatchStatus(product, matchedField) {
  if (!product) return null;
  const timestamp = formatTimestampIST(new Date());
  product[matchedField] = "YES";
  return timestamp;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCycleCsv(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      resolve({
        metadata: null,
        header: [],
        data: [],
      });
      return;
    }

    const fileContent = fs.readFileSync(filePath, "utf8");
    const lines = fileContent.split(/\r?\n/);

    if (lines.length === 0) {
      resolve({ metadata: null, header: [], data: [] });
      return;
    }

    try {
      let metadata = null;
      let headerLineIndex = -1;

      if (lines[0].startsWith(",,")) {
        const title = (lines[0] || "").substring(2).trim();
        const subtitle = (lines[1] || "").substring(2).trim();
        const date = (lines[2] || "").substring(2).trim();

        metadata = { title, subtitle, date };

        for (let i = 3; i < lines.length; i++) {
          const candidate = lines[i];
          if (candidate && candidate.trim()) {
            headerLineIndex = i;
            break;
          }
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          const candidate = lines[i];
          if (candidate && candidate.trim()) {
            headerLineIndex = i;
            break;
          }
        }
      }

      if (headerLineIndex === -1) {
        resolve({
          metadata,
          header: [],
          data: [],
        });
        return;
      }

      const headers = parseCSVLine(lines[headerLineIndex]).map((h) => h.trim());

      const data = [];
      for (let i = headerLineIndex + 1; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!rawLine || !rawLine.trim()) continue;

        const values = parseCSVLine(rawLine);
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] ? values[index].trim() : "";
        });

        if (row.Brand && row.Brand.trim()) {
          data.push(row);
        }
      }

      resolve({
        metadata,
        header: headers,
        data,
      });
    } catch (error) {
      reject(error);
    }
  });
}

function createProductKey(brand, pack) {
  if (brand === undefined || brand === null) return null;
  if (pack === undefined || pack === null) return null;

  const normalizedBrand = brand.toString().toLowerCase().trim();
  const normalizedPack = pack.toString().trim();

  if (!normalizedBrand || !normalizedPack) {
    return null;
  }

  return `${normalizedBrand}_${normalizedPack}`;
}

function extractOperatorName(req) {
  const headerName = req.headers["x-operator-name"];
  const bodyName = req.body?.operatorName || req.body?.userName;
  const queryName = req.query?.operatorName;
  const fallback = req.headers["x-user-name"];
  const raw = headerName || bodyName || queryName || fallback;
  if (!raw) {
    return "Unknown";
  }
  const trimmed = raw.toString().trim();
  if (!trimmed) {
    return "Unknown";
  }
  return trimmed.slice(0, 80);
}

function parseCycleHistory(rawValue) {
  if (!rawValue || !rawValue.toString().trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalizeCycleRow(row) {
  if (!row) return row;
  const normalized = { ...row };
  if (!CYCLE_HISTORY_ENABLED) {
    normalized.ChangeHistory = "";
  } else if (!normalized.ChangeHistory || !normalized.ChangeHistory.trim()) {
    normalized.ChangeHistory = "[]";
  }
  return normalized;
}

function getTrackedFieldsSnapshot(productRow) {
  if (!productRow) return null;
  return {
    Item: productRow.Item || "",
    Brand: productRow.Brand || "",
    Pack: productRow.Pack || "",
    BPC: productRow.BPC || "",
    MRP: productRow.MRP || "",
    Godown: productRow.Godown || "",
    Shop: productRow.Shop || "",
  };
}

async function loadMasterData() {
  try {
    const brandSources = [
      { path: stockLensBrands, label: "myApp" },
      { path: stockLensBrands, label: "stockLens" },
    ];

    const masterMap = new Map();
    const combinedData = [];
    let metadata = null;
    let header = null;
    let anySource = false;

    for (const source of brandSources) {
      if (!source.path || !fs.existsSync(source.path)) {
        continue;
      }

      anySource = true;
      const parsed = await parseCycleCsv(source.path);
      if (!metadata && parsed.metadata) {
        metadata = parsed.metadata;
      }
      if (!header && parsed.header) {
        header = parsed.header;
      }

      (parsed.data || []).forEach((row) => {
        const key = createProductKey(row.Brand, row.Pack);
        if (!key) return;
        if (masterMap.has(key)) {
          return;
        }
        masterMap.set(key, row);
        combinedData.push(row);
      });
    }

    if (!anySource || masterMap.size === 0) {
      return null;
    }

    return {
      metadata,
      header,
      data: combinedData,
      map: masterMap,
    };
  } catch (error) {
    console.error("❌ Failed to load master brands CSV:", error.message);
    return null;
  }
}

async function loadBrandsSnapshot(filePath = stockLensBrands) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const stats = await fsPromises.stat(filePath);
    const parsed = await parseCycleCsv(filePath);
    const map = new Map();
    (parsed.data || []).forEach((row) => {
      const key = createProductKey(row.Brand, row.Pack);
      if (!key) return;
      map.set(key, row);
    });

    return {
      path: filePath,
      map,
      rows: parsed.data || [],
      metadata: parsed.metadata || null,
      mtimeMs: stats.mtimeMs,
      mtimeISO: stats.mtime.toISOString(),
    };
  } catch (error) {
    console.error("⚠️ Failed to load brands snapshot:", error.message);
    return null;
  }
}

function diffBrandSnapshots(previousSnapshot, currentSnapshot) {
  if (!currentSnapshot || !currentSnapshot.map) {
    return [];
  }

  if (!previousSnapshot || !previousSnapshot.map) {
    return [];
  }

  const trackedFields = ["Godown", "Shop", "MRP", "BPC"];
  const changes = [];

  currentSnapshot.map.forEach((currentRow, key) => {
    const previousRow = previousSnapshot.map.get(key);
    if (!previousRow) {
      changes.push({
        type: "added",
        brand: currentRow.Brand,
        pack: currentRow.Pack,
        item: currentRow.Item || "",
        after: getTrackedFieldsSnapshot(currentRow),
        before: null,
        differences: trackedFields.map((field) => ({
          field,
          from: null,
          to: currentRow[field] || "",
        })),
      });
      return;
    }

    const differences = trackedFields
      .map((field) => {
        const beforeValue = previousRow[field] || "";
        const afterValue = currentRow[field] || "";
        if (beforeValue === afterValue) {
          return null;
        }
        return {
          field,
          from: beforeValue,
          to: afterValue,
        };
      })
      .filter(Boolean);

    if (differences.length > 0) {
      changes.push({
        type: "updated",
        brand: currentRow.Brand,
        pack: currentRow.Pack,
        item: currentRow.Item || "",
        before: getTrackedFieldsSnapshot(previousRow),
        after: getTrackedFieldsSnapshot(currentRow),
        differences,
      });
    }
  });

  previousSnapshot.map.forEach((previousRow, key) => {
    if (currentSnapshot.map.has(key)) {
      return;
    }
    changes.push({
      type: "removed",
      brand: previousRow.Brand,
      pack: previousRow.Pack,
      item: previousRow.Item || "",
      before: getTrackedFieldsSnapshot(previousRow),
      after: null,
      differences: trackedFields.map((field) => ({
        field,
        from: previousRow[field] || "",
        to: null,
      })),
    });
  });

  return changes;
}

async function appendCycleHistoryEntry(changes, snapshotMeta) {
  if (!CYCLE_HISTORY_ENABLED) {
    return;
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }

  const cycles = await readCycleManagement();
  if (!cycles.length) {
    return;
  }

  let targetIndex = cycles.findIndex((cycle) => cycle.Status === "active");
  if (targetIndex === -1) {
    targetIndex = cycles.length - 1;
  }

  if (targetIndex < 0) {
    return;
  }

  const targetCycle = cycles[targetIndex];
  const history = parseCycleHistory(targetCycle.ChangeHistory);
  history.push({
    recordedAt: new Date().toISOString(),
    fileModifiedAt: snapshotMeta?.mtimeISO || null,
    changeCount: changes.length,
    changes,
  });
  targetCycle.ChangeHistory = JSON.stringify(history);
  await writeCycleManagement(cycles);
}

async function checkBrandsFileChanges() {
  const latestSnapshot = await loadBrandsSnapshot(stockLensBrands);
  if (!latestSnapshot) {
    return;
  }

  if (!brandMonitorState.snapshot) {
    brandMonitorState = {
      snapshot: latestSnapshot,
      mtimeMs: latestSnapshot.mtimeMs,
    };
    return;
  }

  if (
    brandMonitorState.mtimeMs &&
    latestSnapshot.mtimeMs <= brandMonitorState.mtimeMs
  ) {
    return;
  }

  const changes = diffBrandSnapshots(
    brandMonitorState.snapshot,
    latestSnapshot
  );
  brandMonitorState = {
    snapshot: latestSnapshot,
    mtimeMs: latestSnapshot.mtimeMs,
  };

  if (changes.length === 0) {
    return;
  }

  await appendCycleHistoryEntry(changes, latestSnapshot);
}

function startBrandsMonitor() {
  if (!CYCLE_HISTORY_ENABLED) {
    console.warn("ℹ️ Cycle history disabled; brands monitor will not start.");
    return;
  }
  if (brandMonitorStarted) {
    return;
  }
  brandMonitorStarted = true;

  ensureCycleHistorySchema().catch((error) =>
    console.error("⚠️ Cycle history schema init failed:", error.message)
  );

  checkBrandsFileChanges().catch((error) =>
    console.error("⚠️ Initial brands snapshot failed:", error.message)
  );

  if (BRAND_MONITOR_INTERVAL_MS <= 0) {
    console.warn(
      "⚠️ Brand monitor disabled because BRAND_MONITOR_INTERVAL_MS <= 0"
    );
    return;
  }

  brandMonitorTimer = setInterval(() => {
    checkBrandsFileChanges().catch((error) =>
      console.error("⚠️ Brands monitor error:", error.message)
    );
  }, BRAND_MONITOR_INTERVAL_MS);
}

function updateLocationMatchStatus(row, location, masterProduct) {
  const matchedField = getMatchedFieldForLocation(location);
  if (!matchedField || !row) {
    return {
      matched: false,
      changed: false,
      masterCount: null,
      scannedCount: null,
      masterExists: Boolean(masterProduct),
    };
  }

  const bpcFromRow = parseInt(row.BPC, 10);
  const bpcFromMaster =
    masterProduct && masterProduct.BPC ? parseInt(masterProduct.BPC, 10) : null;
  const bpcValue = bpcFromRow || bpcFromMaster || 12;

  const scannedCount = parseCountValue(row[location], bpcValue);
  let masterCount = null;
  let matched = false;

  if (masterProduct) {
    masterCount = parseCountValue(masterProduct[location], bpcValue);
    // Compare both total and formatted values to catch differences like 1.002 vs 1.000
    matched =
      scannedCount.total === masterCount.total &&
      scannedCount.formatted === masterCount.formatted;
  } else {
    matched = false;
  }

  const previousValue = (row[matchedField] || "")
    .toString()
    .trim()
    .toUpperCase();
  const desiredValue = matched ? "YES" : "NO";
  const changed = previousValue !== desiredValue;
  row[matchedField] = desiredValue;

  return {
    matched,
    changed,
    masterCount,
    scannedCount,
    masterExists: Boolean(masterProduct),
  };
}

// New function to check matching for unfinished data
function updateUnfinishedLocationMatchStatus(
  row,
  location,
  masterProduct,
  unfinishedValue
) {
  if (!row || !unfinishedValue) {
    return {
      matched: false,
      masterCount: null,
      scannedCount: null,
      masterExists: Boolean(masterProduct),
    };
  }

  // If no master product exists, it cannot match
  if (!masterProduct) {
    return {
      matched: false,
      masterCount: null,
      scannedCount: parseCountValue(
        unfinishedValue,
        parseInt(row.BPC, 10) || 12
      ),
      masterExists: false,
    };
  }

  const bpcFromRow = parseInt(row.BPC, 10);
  const bpcFromMaster =
    masterProduct && masterProduct.BPC ? parseInt(masterProduct.BPC, 10) : null;
  const bpcValue = bpcFromRow || bpcFromMaster || 12;

  const scannedCount = parseCountValue(unfinishedValue, bpcValue);
  const masterValue = masterProduct[location];

  // If master has no value for this location, it cannot match
  if (
    !masterValue ||
    masterValue.toString().trim() === "" ||
    masterValue === "0.000"
  ) {
    return {
      matched: false,
      masterCount: parseCountValue("0.000", bpcValue),
      scannedCount: scannedCount,
      masterExists: true,
    };
  }

  const masterCount = parseCountValue(masterValue, bpcValue);

  // Compare both total and formatted values to catch differences like 1.002 vs 1.000
  // Both must match exactly for it to be considered a match
  const matched =
    scannedCount.total === masterCount.total &&
    scannedCount.formatted === masterCount.formatted;
  console.log(
    "🚀 ~ updateUnfinishedLocationMatchStatus ~ masterCount:",
    masterCount
  );
  console.log(
    "🚀 ~ updateUnfinishedLocationMatchStatus ~ scannedCount:",
    scannedCount
  );

  return {
    matched,
    masterCount,
    scannedCount,
    masterExists: true,
  };
}

function writeCycleCsv(filePath, data, cycleDate, metadata = null) {
  return new Promise((resolve, reject) => {
    try {
      const dataDir = path.dirname(filePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      let csvContent = "";

      if (metadata) {
        csvContent += `,,${metadata.title}\n`;
        csvContent += `,,${metadata.subtitle}\n`;
        csvContent += `,,${cycleDate}\n`;
        csvContent += `,,\n`;
      }

      const headers = [
        "Sl.",
        "Item",
        "Brand",
        "Pack",
        "BPC",
        "MRP",
        "Godown",
        "Shop",
        "BarCode",
        "LastUpdated",
        "UnfinishedLastUpdated",
        "FinishedLastUpdated",
        "GodownMatched",
        "ShopMatched",
        "GodownMatchedDate",
        "ShopMatchedDate",
        "ChangeLog",
        "UnfinishedShop",
        "UnfinishedGodown",
        "UnfinishedChangeLog",
        "UnfinishedShopMatched",
        "UnfinishedGodownMatched",
        "RecheckShown",
      ];
      csvContent += headers.join(",") + "\n";

      data.forEach((row) => {
        const values = headers.map((header) => {
          const value =
            row[header] !== undefined && row[header] !== null
              ? row[header].toString()
              : "";

          if (
            (header === "ChangeLog" ||
              header === "LastUpdated" ||
              header === "UnfinishedLastUpdated" ||
              header === "FinishedLastUpdated" ||
              header === "UnfinishedChangeLog" ||
              header === "UnfinishedShop" ||
              header === "UnfinishedGodown" ||
              header === "GodownMatchedDate" ||
              header === "ShopMatchedDate" ||
              header === "UnfinishedShopMatched" ||
              header === "UnfinishedGodownMatched") &&
            value
          ) {
            return `"${value.replace(/"/g, '""')}"`;
          }

          return value;
        });
        csvContent += values.join(",") + "\n";
      });

      fs.writeFileSync(filePath, csvContent, "utf8");
      resolve({ success: true });
    } catch (error) {
      reject(error);
    }
  });
}

function readCycleManagement() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CYCLE_MANAGEMENT_FILE)) {
      resolve([]);
      return;
    }

    const results = [];
    fs.createReadStream(CYCLE_MANAGEMENT_FILE)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results.map((row) => normalizeCycleRow(row))))
      .on("error", (error) => reject(error));
  });
}

function writeCycleManagement(data) {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(stockLensDir)) {
        fs.mkdirSync(stockLensDir, { recursive: true });
      }

      const headers = CYCLE_HISTORY_ENABLED
        ? ["SNo", "StartDate", "EndDate", "Status", "ChangeHistory"]
        : ["SNo", "StartDate", "EndDate", "Status"];
      let csvContent = headers.join(",") + "\n";

      data.forEach((row) => {
        const values = headers.map((header) => {
          if (header === "ChangeHistory") {
            if (!CYCLE_HISTORY_ENABLED) {
              return "";
            }
            const historyString =
              row.ChangeHistory && row.ChangeHistory.toString().trim()
                ? row.ChangeHistory.toString()
                : "[]";
            const escaped = historyString.replace(/"/g, '""');
            return `"${escaped}"`;
          }
          return row[header] || "";
        });
        csvContent += values.join(",") + "\n";
      });

      fs.writeFileSync(CYCLE_MANAGEMENT_FILE, csvContent, "utf8");
      resolve({ success: true });
    } catch (error) {
      reject(error);
    }
  });
}

async function ensureCycleHistorySchema() {
  if (!CYCLE_HISTORY_ENABLED) {
    return;
  }
  try {
    const cycles = await readCycleManagement();
    if (!cycles.length) {
      return;
    }

    let updated = false;
    const normalizedCycles = cycles.map((cycle) => {
      if (!cycle.ChangeHistory || !cycle.ChangeHistory.trim()) {
        updated = true;
        return {
          ...cycle,
          ChangeHistory: "[]",
        };
      }
      return cycle;
    });

    if (updated) {
      await writeCycleManagement(normalizedCycles);
    }
  } catch (error) {
    console.error("⚠️ Failed to ensure cycle history schema:", error.message);
  }
}

function handleCycleRouteError(res, error, contextLabel = "Cycle Error") {
  if (error && typeof error.statusCode === "number") {
    console.warn(`⚠️ ${contextLabel}: ${error.message}`);
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  console.error(`❌ ${contextLabel}:`, error);
  return res.status(500).json({
    success: false,
    error: error.message,
  });
}

async function buildCycleComparisonData({ cycleDate, location, analysisDate }) {
  const normalizedLocation =
    typeof location === "string" && location.toLowerCase() === "godown"
      ? "godown"
      : "shop";
  const locationField =
    normalizedLocation.charAt(0).toUpperCase() + normalizedLocation.slice(1);
  const matchedField = getMatchedFieldForLocation(normalizedLocation);

  const masterData = await loadMasterData();
  if (!masterData) {
    throw new HttpError(404, "Master brands.csv not found");
  }

  const cycleFilePath = getCycleFilePath(cycleDate);
  if (!fs.existsSync(cycleFilePath)) {
    throw new HttpError(404, `No data found for cycle date: ${cycleDate}`);
  }

  const cycleData = await parseCycleCsv(cycleFilePath);
  let matchStatusUpdated = false;

  const masterProducts = masterData.data || [];
  const scannedProducts = cycleData.data || [];
  const filteredScannedProducts = analysisDate
    ? scannedProducts.filter((product) => {
        const lastUpdatedDate = extractDateFromLastUpdated(product.LastUpdated);
        return lastUpdatedDate === analysisDate;
      })
    : scannedProducts;

  console.log(`\n📊 === COMPARISON ANALYSIS ===`);
  console.log(`Cycle Date: ${cycleDate}`);
  console.log(`Location: ${normalizedLocation}`);
  if (analysisDate) {
    console.log(`Analysis Date: ${analysisDate}`);
  }
  console.log(`Master Products: ${masterProducts.length}`);
  console.log(`Scanned Products (total): ${scannedProducts.length}`);
  if (analysisDate) {
    console.log(
      `Scanned Products (${analysisDate}): ${filteredScannedProducts.length}`
    );
  }

  const EMPTY_COUNT = {
    cases: 0,
    bottles: 0,
    total: 0,
    formatted: "0.000",
  };

  const getCountDetails = (product, loc) => {
    if (!product) {
      return { ...EMPTY_COUNT };
    }

    const localLocationField = loc.charAt(0).toUpperCase() + loc.slice(1);
    const rawValue = product[localLocationField];
    const parsed = parseCountValue(rawValue, product.BPC);

    return {
      cases: parsed.cases,
      bottles: parsed.bottles,
      total: parsed.total,
      formatted: parsed.formatted,
    };
  };

  const getMasterCount = (masterProduct, loc) =>
    getCountDetails(masterProduct, loc);

  const getScannedCount = (scannedProduct, loc) =>
    getCountDetails(scannedProduct, loc);

  const scannedMap = new Map();
  filteredScannedProducts.forEach((product) => {
    const key = `${product.Brand?.toLowerCase().trim()}_${product.Pack?.toString().trim()}`;
    scannedMap.set(key, product);
  });

  const matched = [];
  const unmatched = [];
  const nonScanned = [];

  masterProducts.forEach((masterProduct) => {
    const brand = masterProduct.Brand?.trim();
    const pack = masterProduct.Pack?.toString().trim();

    if (!brand || !pack) return;

    const key = `${brand.toLowerCase()}_${pack}`;
    const scannedProduct = scannedMap.get(key);

    const masterCount = getMasterCount(masterProduct, normalizedLocation);

    if (scannedProduct) {
      const persistedMatchTimestamp = getPersistedMatchTimestamp(
        scannedProduct,
        matchedField
      );
      const isPersistentlyMatched = Boolean(persistedMatchTimestamp);
      const scannedCount = getScannedCount(scannedProduct, normalizedLocation);

      if (masterCount.total === 0 && scannedCount.total === 0) {
        scannedMap.delete(key);
        return;
      }

      if (
        !isPersistentlyMatched &&
        masterCount.total === 0 &&
        scannedCount.total > 0
      ) {
        unmatched.push({
          brand: brand,
          pack: pack,
          item: masterProduct.Item || scannedProduct.Item || "BEER",
          bpc: parseInt(masterProduct.BPC) || 12,
          mrp: parseFloat(masterProduct.MRP) || 0,
          master: {
            cases: masterCount.cases,
            bottles: masterCount.bottles,
            total: masterCount.total,
            formatted: masterCount.formatted,
          },
          scanned: {
            cases: scannedCount.cases,
            bottles: scannedCount.bottles,
            total: scannedCount.total,
            formatted: scannedCount.formatted,
          },
          difference: {
            total: scannedCount.total,
            cases: scannedCount.cases,
            bottles: scannedCount.bottles,
            sign: "+",
          },
          lastUpdated: scannedProduct.LastUpdated || "",
          barCode: masterProduct.BarCode || "",
          matchStatus: {
            persisted: false,
            matchedAt: null,
            forceMatched: false,
          },
        });
        scannedMap.delete(key);
        return;
      }

      if (
        !isPersistentlyMatched &&
        scannedCount.total === 0 &&
        masterCount.total > 0
      ) {
        nonScanned.push({
          brand: brand,
          pack: pack,
          item: masterProduct.Item || "BEER",
          bpc: parseInt(masterProduct.BPC) || 12,
          mrp: parseFloat(masterProduct.MRP) || 0,
          master: {
            cases: masterCount.cases,
            bottles: masterCount.bottles,
            total: masterCount.total,
            formatted: masterCount.formatted,
          },
          barCode: masterProduct.BarCode || "",
        });
        scannedMap.delete(key);
        return;
      }

      const difference = scannedCount.total - masterCount.total;
      const isMatch = difference === 0;

      let matchedTimestamp = persistedMatchTimestamp;
      if (isMatch && !isPersistentlyMatched) {
        matchedTimestamp = persistMatchStatus(scannedProduct, matchedField);
        matchStatusUpdated = true;
      }

      const productInfo = {
        brand: brand,
        pack: pack,
        item: masterProduct.Item || scannedProduct.Item || "BEER",
        bpc: parseInt(masterProduct.BPC) || 12,
        mrp: parseFloat(masterProduct.MRP) || 0,
        master: {
          cases: masterCount.cases,
          bottles: masterCount.bottles,
          total: masterCount.total,
          formatted: masterCount.formatted,
        },
        scanned: {
          cases: scannedCount.cases,
          bottles: scannedCount.bottles,
          total: scannedCount.total,
          formatted: scannedCount.formatted,
        },
        difference: {
          total: difference,
          cases: Math.floor(
            Math.abs(difference) / (parseInt(masterProduct.BPC) || 12)
          ),
          bottles: Math.abs(difference) % (parseInt(masterProduct.BPC) || 12),
          sign: difference > 0 ? "+" : difference < 0 ? "-" : "=",
        },
        lastUpdated: scannedProduct.LastUpdated || "",
        barCode: masterProduct.BarCode || "",
        matchStatus: {
          persisted: Boolean(matchedTimestamp),
          matchedAt: matchedTimestamp || null,
          forceMatched: !isMatch && isPersistentlyMatched,
        },
      };

      if (isMatch) {
        matched.push(productInfo);
      } else {
        unmatched.push(productInfo);
      }

      scannedMap.delete(key);
    } else {
      if (masterCount.total > 0) {
        nonScanned.push({
          brand: brand,
          pack: pack,
          item: masterProduct.Item || "BEER",
          bpc: parseInt(masterProduct.BPC) || 12,
          mrp: parseFloat(masterProduct.MRP) || 0,
          master: {
            cases: masterCount.cases,
            bottles: masterCount.bottles,
            total: masterCount.total,
            formatted: masterCount.formatted,
          },
          barCode: masterProduct.BarCode || "",
        });
      }
    }
  });

  if (matchStatusUpdated) {
    try {
      await writeCycleCsv(
        cycleFilePath,
        scannedProducts,
        cycleDate,
        cycleData.metadata
      );
    } catch (writeError) {
      console.error("⚠️ Failed to persist match status:", writeError.message);
    }
  }

  const productsWithStock = masterProducts.filter((product) => {
    const count = getMasterCount(product, normalizedLocation);
    return count.total > 0;
  });

  const totalMasterCount = productsWithStock.reduce((sum, product) => {
    const count = getMasterCount(product, normalizedLocation);
    return sum + count.total;
  }, 0);

  const totalScannedCount =
    matched.reduce((sum, p) => sum + p.scanned.total, 0) +
    unmatched.reduce((sum, p) => sum + p.scanned.total, 0);

  const totalDifference = totalScannedCount - totalMasterCount;

  console.log(`\n✅ Matched: ${matched.length}`);
  console.log(`❌ Unmatched: ${unmatched.length}`);
  console.log(`⚠️  Non-Scanned: ${nonScanned.length}`);
  console.log(`📦 Products with Stock: ${productsWithStock.length}`);
  console.log(`📦 Total Master Bottles: ${totalMasterCount}`);
  console.log(`📦 Total Scanned Bottles: ${totalScannedCount}`);
  console.log(
    `📊 Difference: ${totalDifference >= 0 ? "+" : ""}${totalDifference}\n`
  );

  return {
    success: true,
    cycleDate: cycleDate,
    location: normalizedLocation,
    analysisDate: analysisDate,
    summary: {
      totalMasterProducts: masterProducts.length,
      totalProductsWithStock: productsWithStock.length,
      totalScannedProducts: filteredScannedProducts.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      nonScannedCount: nonScanned.length,
      totalMasterBottles: totalMasterCount,
      totalScannedBottles: totalScannedCount,
      totalDifference: totalDifference,
      accuracyPercentage:
        productsWithStock.length > 0
          ? ((matched.length / productsWithStock.length) * 100).toFixed(2)
          : 0,
    },
    matched,
    unmatched,
    nonScanned,
  };
}

function registerCycleRoutes(app) {
  app.get("/api/products", (req, res) => readCsv(myAppProducts, res));
  app.get("/api/allprinters", (req, res) => readCsv(myAppPrinters, res));
  app.get("/api/brands", (req, res) => readBrandsCsv(stockLensBrands, res));

  app.post("/api/admin/verify", (req, res) => {
    const { password } = req.body || {};
    const normalizedPassword =
      typeof password === "string" ? password.trim() : "";
    const expectedPassword = readAdminPassword();
    const success =
      normalizedPassword.length > 0 && normalizedPassword === expectedPassword;

    res.status(success ? 200 : 401).json({ success });
  });

  app.get("/api/admin/config", (req, res) => {
    const shopName = readShopName();
    res.json({ success: true, shopName: shopName || "" });
  });

  app.post("/api/code/allocate", async (req, res) => {
    try {
      const {
        app: appId,
        previousCode,
        releasePrevious,
        reason,
        password,
      } = req.body || {};
      if (!isOptionalPasswordValid(password)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid password" });
      }
      if (!appId || typeof appId !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "app is required" });
      }

      if (
        releasePrevious &&
        typeof previousCode === "string" &&
        previousCode.trim()
      ) {
        await releaseCode(
          appId,
          previousCode.trim(),
          "released_before_allocate"
        );
      }

      const result = await allocateCode(appId, {
        reason: reason || "allocate",
      });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/code/release", async (req, res) => {
    try {
      const { app: appId, code, reason, password } = req.body || {};
      if (!isOptionalPasswordValid(password)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid password" });
      }
      if (!appId || typeof appId !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "app is required" });
      }
      const result = await releaseCode(
        appId,
        code?.trim(),
        reason || "released"
      );
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/code/printed", async (req, res) => {
    try {
      const { app: appId, code, reason, password } = req.body || {};
      if (!isOptionalPasswordValid(password)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid password" });
      }
      if (!appId || typeof appId !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "app is required" });
      }
      const result = await markPrinted(
        appId,
        code?.trim(),
        reason || "printed"
      );
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/code/status", (req, res) => {
    try {
      const appId = typeof req.query.app === "string" ? req.query.app : "";
      const password =
        typeof req.query.password === "string" ? req.query.password : "";
      if (!isOptionalPasswordValid(password)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid password" });
      }
      if (!appId) {
        return res
          .status(400)
          .json({ success: false, message: "app is required" });
      }
      const status = getStatus(appId);
      res.json({ success: true, status });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get worker.csv operators
  app.get("/api/operators", (req, res) => {
    try {
      console.log(`📋 Fetching operators from: ${stockLensWorkerCsv}`);

      if (!fs.existsSync(stockLensWorkerCsv)) {
        console.log(`⚠️ worker.csv not found at: ${stockLensWorkerCsv}`);
        return res.json({
          success: true,
          data: [],
          operators: [],
          message: "worker.csv not found",
        });
      }

      // Read CSV and extract operators
      const results = [];
      fs.createReadStream(stockLensWorkerCsv)
        .pipe(csv())
        .on("data", (data) => {
          results.push(data);
          console.log("📋 CSV row:", data);
        })
        .on("end", () => {
          console.log(`📋 Total CSV rows read: ${results.length}`);

          // Extract operator names - try common column names
          const operators = [];
          results.forEach((row, index) => {
            // Skip empty rows
            if (!row || Object.keys(row).length === 0) {
              console.log(`📋 Row ${index}: Skipping empty row`);
              return;
            }

            // Try different column name variations
            const operatorName =
              row.Name ||
              row.NAME ||
              row.name ||
              row.Operator ||
              row.OPERATOR ||
              row.operator ||
              row["Operator Name"] ||
              row["OPERATOR NAME"] ||
              row["Name"] ||
              (Object.keys(row).length > 0 ? Object.values(row)[0] : null); // Fallback to first column value

            console.log(
              `📋 Row ${index}:`,
              row,
              `-> Operator name: ${operatorName}`
            );

            // Filter out header row, empty values, and duplicates
            if (
              operatorName &&
              operatorName.trim() !== "" &&
              operatorName.trim().toLowerCase() !== "name" &&
              !operators.includes(operatorName.trim())
            ) {
              operators.push(operatorName.trim());
            }
          });

          console.log(`✅ Extracted ${operators.length} operators:`, operators);

          res.json({
            success: true,
            data: results,
            operators: operators,
            count: operators.length,
          });
        })
        .on("error", (error) => {
          console.error("❌ Error reading worker.csv:", error);
          res.status(500).json({
            success: false,
            error: error.message,
          });
        });
    } catch (error) {
      console.error("❌ Error in /api/operators:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Add worker to worker.csv
  app.post("/api/workers", async (req, res) => {
    try {
      const { name, phone, shop } = req.body;

      // Validate required field
      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Worker name is required",
        });
      }

      const workerName = name.trim();
      const workerPhone = phone?.trim() || "";
      const workerShop = shop?.trim() || "";

      console.log(`📝 Adding worker: ${workerName}`);

      // Check if file exists, create if not
      if (!fs.existsSync(stockLensWorkerCsv)) {
        console.log(`📝 Creating worker.csv at: ${stockLensWorkerCsv}`);
        const header = "Name,Phone,Shop\n";
        fs.writeFileSync(stockLensWorkerCsv, header, "utf8");
      }

      // Read existing workers to check for duplicates
      const existingWorkers = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(stockLensWorkerCsv)
          .pipe(csv())
          .on("data", (data) => existingWorkers.push(data))
          .on("end", resolve)
          .on("error", reject);
      });

      // Check for duplicate name
      const isDuplicate = existingWorkers.some(
        (worker) => worker.Name?.toLowerCase() === workerName.toLowerCase()
      );

      if (isDuplicate) {
        return res.status(400).json({
          success: false,
          message: `Worker "${workerName}" already exists`,
        });
      }

      // Append new worker
      const newRow = `\n${workerName},${workerPhone},${workerShop}`;
      fs.appendFileSync(stockLensWorkerCsv, newRow, "utf8");

      console.log(`✅ Worker added successfully: ${workerName}`);

      res.json({
        success: true,
        message: "Worker added successfully",
        worker: {
          name: workerName,
          phone: workerPhone,
          shop: workerShop,
        },
      });
    } catch (error) {
      console.error("❌ Error adding worker:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to add worker",
      });
    }
  });

  app.get("/api/workers", async (req, res) => {
    try {
      ensureWorkerCsvExists();
      const rows = await readWorkersCsv(stockLensWorkerCsv);
      const items = rows
        .map((row) => ({
          name: (row.Name || row.name || "").toString().trim(),
          phone: (row.Phone || row.phone || "").toString().trim(),
          shop: (row.Shop || row.shop || "").toString().trim(),
        }))
        .filter((row) => row.name);

      res.json({
        success: true,
        count: items.length,
        items,
      });
    } catch (error) {
      console.error("❌ Error in GET /api/workers:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch workers",
      });
    }
  });

  app.put("/api/workers", async (req, res) => {
    try {
      const { originalName, name, phone, shop } = req.body || {};
      const normalizedOriginal = String(originalName || "").trim();
      if (!normalizedOriginal) {
        return res.status(400).json({
          success: false,
          message: "Original worker name is required",
        });
      }

      ensureWorkerCsvExists();
      const rows = await readWorkersCsv(stockLensWorkerCsv);
      const workers = rows.map((row) => ({
        Name: (row.Name || row.name || "").toString().trim(),
        Phone: (row.Phone || row.phone || "").toString().trim(),
        Shop: (row.Shop || row.shop || "").toString().trim(),
      }));

      const originalKey = normalizedOriginal.toLowerCase();
      const targetIndex = workers.findIndex(
        (worker) => worker.Name.toLowerCase() === originalKey
      );

      if (targetIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Worker not found",
        });
      }

      const updatedName = String(name ?? "").trim();
      if (updatedName) {
        const newKey = updatedName.toLowerCase();
        const duplicate = workers.some(
          (worker, index) =>
            index !== targetIndex && worker.Name.toLowerCase() === newKey
        );
        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: `Worker "${updatedName}" already exists`,
          });
        }
        workers[targetIndex].Name = updatedName;
      }

      if (phone !== undefined) {
        workers[targetIndex].Phone = String(phone || "").trim();
      }
      if (shop !== undefined) {
        workers[targetIndex].Shop = String(shop || "").trim();
      }

      writeWorkersCsv(stockLensWorkerCsv, workers);

      res.json({
        success: true,
        message: "Worker updated",
      });
    } catch (error) {
      console.error("❌ Error in PUT /api/workers:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update worker",
      });
    }
  });

  app.delete("/api/workers", async (req, res) => {
    try {
      const payload = req.body || {};
      const names = Array.isArray(payload.names)
        ? payload.names
        : payload.name
        ? [payload.name]
        : [];

      if (names.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Provide worker names to delete",
        });
      }

      ensureWorkerCsvExists();
      const rows = await readWorkersCsv(stockLensWorkerCsv);
      const workers = rows.map((row) => ({
        Name: (row.Name || row.name || "").toString().trim(),
        Phone: (row.Phone || row.phone || "").toString().trim(),
        Shop: (row.Shop || row.shop || "").toString().trim(),
      }));

      const deleteKeys = new Set(
        names.map((name) =>
          String(name || "")
            .trim()
            .toLowerCase()
        )
      );

      const filtered = workers.filter(
        (worker) => !deleteKeys.has(worker.Name.toLowerCase())
      );
      const removed = workers.length - filtered.length;

      writeWorkersCsv(stockLensWorkerCsv, filtered);

      res.json({
        success: true,
        removed,
        remaining: filtered.length,
      });
    } catch (error) {
      console.error("❌ Error in DELETE /api/workers:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete workers",
      });
    }
  });

  app.post("/api/bestselling", async (req, res) => {
    try {
      const { item, brand, pack } = req.body || {};
      const normalizedItem = String(item || "BEER").trim();
      const normalizedBrand = String(brand || "").trim();
      const normalizedPack = String(pack || "").trim();

      if (!normalizedBrand || !normalizedPack) {
        return res.status(400).json({
          success: false,
          message: "Brand and Pack are required",
        });
      }

      ensureBestSellingCsvExists();

      const row =
        [
          escapeCsvValue(normalizedItem),
          escapeCsvValue(normalizedBrand),
          escapeCsvValue(normalizedPack),
        ].join(",") + "\n";

      fs.appendFileSync(stockLensBestSelling, row, "utf8");

      res.json({
        success: true,
        message: "Best selling item added",
      });
    } catch (error) {
      console.error("❌ Error in /api/bestselling:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to add best selling item",
      });
    }
  });

  app.get("/api/bestselling", async (req, res) => {
    try {
      ensureBestSellingCsvExists();
      const parsed = await parseCycleCsv(stockLensBestSelling);
      const items = parsed.data || [];
      res.json({
        success: true,
        count: items.length,
        items,
      });
    } catch (error) {
      console.error("❌ Error in GET /api/bestselling:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch best selling items",
      });
    }
  });

  app.delete("/api/bestselling", async (req, res) => {
    try {
      const payload = req.body || {};
      const requestedItems = Array.isArray(payload.items)
        ? payload.items
        : payload.brand
        ? [payload]
        : [];

      if (requestedItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Provide items to delete",
        });
      }

      ensureBestSellingCsvExists();
      const parsed = await parseCycleCsv(stockLensBestSelling);
      const existingItems = parsed.data || [];

      const normalizeKey = (entry) => {
        const item = String(entry.item || entry.Item || "")
          .trim()
          .toLowerCase();
        const brand = String(entry.brand || entry.Brand || "")
          .trim()
          .toLowerCase();
        const pack = String(entry.pack || entry.Pack || "")
          .trim()
          .toLowerCase();
        return `${item}|${brand}|${pack}`;
      };

      const deleteKeys = new Set(
        requestedItems.map((entry) => normalizeKey(entry))
      );

      const filteredItems = existingItems.filter(
        (entry) => !deleteKeys.has(normalizeKey(entry))
      );

      const removedCount = existingItems.length - filteredItems.length;
      writeBestSellingCsv(stockLensBestSelling, filteredItems);

      res.json({
        success: true,
        removed: removedCount,
        remaining: filteredItems.length,
      });
    } catch (error) {
      console.error("❌ Error in DELETE /api/bestselling:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete best selling items",
      });
    }
  });

  app.get("/api/brands/status", async (req, res) => {
    try {
      const sourceFile = stockLensBrands;

      if (!fs.existsSync(sourceFile)) {
        return res.status(404).json({
          success: false,
          recent: false,
          message: "Master brands.csv not found",
        });
      }

      const stats = fs.statSync(sourceFile);
      const lastModified = stats.mtime;
      const now = new Date();
      const HALF_HOUR_IN_MS = 30 * 60 * 1000;
      const ageMs = now.getTime() - lastModified.getTime();
      const ageMinutes = Math.floor(ageMs / 60000);

      const isRecent = ageMs <= HALF_HOUR_IN_MS;
      const { metadata } = await parseCycleCsv(sourceFile);
      const rawDate = metadata?.date || "";
      const normalizedDate = normalizeBrandsDate(rawDate);
      const todayDate = getTodayDateString();
      const isDateToday = normalizedDate === todayDate;

      res.json({
        success: true,
        recent: isRecent,
        dateOk: isDateToday,
        allowed: isRecent && isDateToday,
        brandsDate: rawDate,
        brandsDateISO: normalizedDate,
        todayDate,
        lastModified: lastModified.toISOString(),
        lastModifiedIST: formatTimestampIST(lastModified),
        ageMinutes,
        ageMs,
      });
    } catch (error) {
      console.error("Error checking brands.csv status:", error);
      res.status(500).json({
        success: false,
        recent: false,
        message: "Unable to determine master CSV status",
        error: error.message,
      });
    }
  });
  app.get("/api/brands/missing-barcodes", async (req, res) => {
    try {
      const brandsFilePath = stockLensBrands;
      if (!fs.existsSync(brandsFilePath)) {
        return res.status(404).json({
          success: false,
          message: "Master brands.csv not found",
        });
      }

      const { metadata, data } = await parseCycleCsv(brandsFilePath);
      const missingProducts = data.filter((row = {}) => {
        const barcodeValue =
          row.BarCode ||
          row.Barcode ||
          row.BARCODE ||
          row.barcode ||
          row["Bar Code"] ||
          "";

        // Check if barcode is missing
        const hasMissingBarcode = !barcodeValue || !barcodeValue.trim();

        // Only include if barcode is missing AND product has stock in shop or godown
        if (hasMissingBarcode) {
          const bpc = parseInt(row.BPC, 10) || 12;
          const godownCount = parseCountValue(row.Godown, bpc);
          const shopCount = parseCountValue(row.Shop, bpc);

          // Include only if there's stock in either location
          return godownCount.total > 0 || shopCount.total > 0;
        }

        return false;
      });

      res.json({
        success: true,
        count: missingProducts.length,
        metadata,
        products: missingProducts,
      });
    } catch (error) {
      console.error("Error reading missing barcodes:", error);
      res.status(500).json({
        success: false,
        message: "Failed to read missing barcode data",
        error: error.message,
      });
    }
  });
  app.get("/api/brands/nil", async (req, res) => {
    try {
      const brandsFilePath = stockLensBrands;
      if (!fs.existsSync(brandsFilePath)) {
        return res.status(404).json({
          success: false,
          message: "Master brands.csv not found",
        });
      }

      const { metadata, data } = await parseCycleCsv(brandsFilePath);

      const nilProducts = data
        .map((row = {}) => {
          const brand = row.Brand ? row.Brand.toString().trim() : "";
          const pack = row.Pack ? row.Pack.toString().trim() : "";
          const bpc = parseInt(row.BPC, 10) || 12;
          const godownCount = parseCountValue(row.Godown, bpc);
          const shopCount = parseCountValue(row.Shop, bpc);

          return {
            brand,
            pack,
            item: row.Item || "",
            bpc,
            mrp: parseFloat(row.MRP) || 0,
            godown: godownCount,
            shop: shopCount,
            barcode:
              row.BarCode ||
              row.Barcode ||
              row.BARCODE ||
              row.barcode ||
              row["Bar Code"] ||
              "",
            lastUpdated: row.LastUpdated || "",
          };
        })
        .filter(
          (row) =>
            row.brand &&
            row.pack &&
            row.godown.total > 0 &&
            row.shop.total === 0
        )
        .sort((a, b) => a.brand.localeCompare(b.brand));

      res.json({
        success: true,
        count: nilProducts.length,
        metadata,
        products: nilProducts,
      });
    } catch (error) {
      console.error("Error building NIL list:", error);
      res.status(500).json({
        success: false,
        message: "Failed to build NIL brand list",
        error: error.message,
      });
    }
  });

  app.post("/api/cycle/:date/product", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const {
        brand,
        pack,
        godown,
        shop,
        item,
        mrp,
        bpc,
        shopName,
        phoneName,
        deviceMetadata,
      } = req.body;
      const operatorName = extractOperatorName(req);
      const configShopName = readShopName();
      const resolvedShopName =
        configShopName || (typeof shopName === "string" ? shopName.trim() : "");

      console.log(`\n📝 === ADDING/UPDATING PRODUCT ===`);
      console.log(
        `Brand: ${brand}, Pack: ${pack}, Location: ${
          godown ? "Godown" : "Shop"
        }, Count: ${godown || shop}, User: ${operatorName}`
      );
      console.log(
        `Shop: ${resolvedShopName || "Not specified"}, Phone: ${
          phoneName || "Not specified"
        }`
      );
      if (deviceMetadata) {
        console.log(
          `Device: ${deviceMetadata.model} (${deviceMetadata.platform}), UUID: ${deviceMetadata.uuid}`
        );
      }

      if (!brand || !pack || (!godown && !shop)) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields: brand, pack, and either godown or shop count",
        });
      }

      const filePath = getCycleFilePath(cycleDate);
      const csvData = await parseCycleCsv(filePath);
      let data = csvData.data || [];
      const masterData = await loadMasterData();
      const masterMap = masterData?.map;
      const productKey = createProductKey(brand, pack);
      const masterProduct =
        productKey && masterMap ? masterMap.get(productKey) : null;

      const count = godown || shop;
      const location = godown ? "Godown" : "Shop";

      // Check for stock mismatch with master data
      let stockMismatch = null;
      if (masterProduct) {
        const masterCount = parseCountValue(
          masterProduct[location],
          masterProduct.BPC || bpc || "12"
        );
        const enteredCount = parseCountValue(
          count,
          bpc || masterProduct.BPC || "12"
        );
        if (enteredCount.total !== masterCount.total) {
          stockMismatch = {
            brand: brand,
            pack: pack,
            location: location,
            masterValue: masterCount.formatted,
            enteredValue: enteredCount.formatted,
            masterTotal: masterCount.total,
            enteredTotal: enteredCount.total,
          };
        }
      } else {
        stockMismatch = {
          brand: brand,
          pack: pack,
          location: location,
          error: "Master product not found",
        };
      }

      const normalizedBrand = brand.toString().toLowerCase().trim();
      const brandHasRecheck = data.some(
        (row) =>
          (row.Brand || "").toString().toLowerCase().trim() ===
            normalizedBrand &&
          hasRecheckShownForLocation(row.RecheckShown, location)
      );
      const shouldShowRecheckWarning = !!stockMismatch && !brandHasRecheck;

      const existingIndex = data.findIndex(
        (row) =>
          row.Brand?.toLowerCase().trim() === brand.toLowerCase().trim() &&
          row.Pack?.toString().trim() === pack.toString().trim()
      );

      const now = new Date();
      const nowISO = now.toISOString();
      const formattedTimestamp = formatTimestampIST(now);
      const todayDate = getTodayDateString();

      if (existingIndex >= 0) {
        const existingRow = data[existingIndex];

        // Initialize new columns if they don't exist
        if (!existingRow.UnfinishedShopMatched) {
          existingRow.UnfinishedShopMatched = "NO";
        }
        if (!existingRow.UnfinishedGodownMatched) {
          existingRow.UnfinishedGodownMatched = "NO";
        }
        if (!existingRow.RecheckShown) {
          existingRow.RecheckShown = "NO";
        }
        if (brandHasRecheck) {
          setRecheckShownForLocation(existingRow, location, true);
        }
        if (!existingRow.UnfinishedLastUpdated) {
          existingRow.UnfinishedLastUpdated = "";
        }
        if (!existingRow.FinishedLastUpdated) {
          existingRow.FinishedLastUpdated = "";
        }
        if (!existingRow.GodownMatchedDate) {
          existingRow.GodownMatchedDate = "[]";
        }
        if (!existingRow.ShopMatchedDate) {
          existingRow.ShopMatchedDate = "[]";
        }

        // Get existing unfinished data
        const unfinishedShopArray = parseUnfinishedData(
          existingRow.UnfinishedShop || "[]"
        );
        const unfinishedGodownArray = parseUnfinishedData(
          existingRow.UnfinishedGodown || "[]"
        );
        const unfinishedChangeLogArray = parseUnfinishedData(
          existingRow.UnfinishedChangeLog || "[]"
        );

        // Get today's unfinished data or create new
        let todayUnfinishedShop = getUnfinishedForDate(
          unfinishedShopArray,
          todayDate
        ) || { shop: "0.000" };
        let todayUnfinishedGodown = getUnfinishedForDate(
          unfinishedGodownArray,
          todayDate
        ) || { godown: "0.000" };
        let todayUnfinishedChangeLog = getUnfinishedForDate(
          unfinishedChangeLogArray,
          todayDate
        ) || { logs: [] };

        // Update today's unfinished data
        if (location === "Godown") {
          todayUnfinishedGodown.godown = count;
        } else {
          todayUnfinishedShop.shop = count;
        }

        // Reset finished status only for the updated location
        if (location === "Shop" && todayUnfinishedShop) {
          delete todayUnfinishedShop.finished;
        }
        if (location === "Godown" && todayUnfinishedGodown) {
          delete todayUnfinishedGodown.finished;
        }
        if (item !== undefined) {
          todayUnfinishedShop.item = item;
          todayUnfinishedGodown.item = item;
        }
        if (mrp !== undefined) {
          todayUnfinishedShop.mrp = mrp;
          todayUnfinishedGodown.mrp = mrp;
        }
        if (bpc !== undefined) {
          todayUnfinishedShop.bpc = bpc;
          todayUnfinishedGodown.bpc = bpc;
        }
        if (shouldShowRecheckWarning) {
          setRecheckShownForLocation(existingRow, location, true);
        }

        // Update match status for unfinished data
        // 1. Find brand in brands.csv (already done via masterProduct)
        // 2. Check the Shop or Godown column from brands.csv
        // 3. Compare values and mark YES/NO
        const unfinishedValue =
          location === "Shop"
            ? todayUnfinishedShop.shop
            : todayUnfinishedGodown.godown;
        const matchResult = updateUnfinishedLocationMatchStatus(
          existingRow,
          location,
          masterProduct,
          unfinishedValue
        );

        // Get the value from brands.csv for the specific location (Shop or Godown column)
        const brandsCsvValue = masterProduct ? masterProduct[location] : null;

        console.log(`🔍 SAVE - Matching check for ${brand} ${pack}ml:`);
        console.log(`   Location: ${location}`);
        console.log(`   Found in brands.csv: ${masterProduct ? "YES" : "NO"}`);
        if (masterProduct) {
          console.log(
            `   brands.csv ${location} column value: ${brandsCsvValue || "N/A"}`
          );
        }
        console.log(`   Entered value: ${unfinishedValue}`);
        console.log(`   Values match: ${matchResult.matched ? "YES" : "NO"}`);
        console.log(
          `   Marking Unfinished${location}Matched: ${
            matchResult.matched ? "YES" : "NO"
          }`
        );

        if (location === "Shop") {
          existingRow.UnfinishedShopMatched = matchResult.matched
            ? "YES"
            : "NO";
        } else {
          existingRow.UnfinishedGodownMatched = matchResult.matched
            ? "YES"
            : "NO";
        }

        // Update change log for unfinished
        if (!todayUnfinishedChangeLog.logs) {
          todayUnfinishedChangeLog.logs = [];
        }
        const logEntry = {
          time: nowISO,
          action: "Updated (Unfinished)",
          user: operatorName,
          operatorName,
          date: todayDate,
          matched: matchResult.matched,
          isMatch: matchResult.matched,
          currentStock: masterProduct ? masterProduct[location] : "N/A",
          changes: {
            [location]: count,
          },
        };
        if (resolvedShopName) logEntry.shopName = resolvedShopName;
        if (phoneName) logEntry.phoneName = phoneName;
        if (deviceMetadata) {
          logEntry.device = {
            model: deviceMetadata.model || "Unknown",
            platform: deviceMetadata.platform || "Unknown",
            uuid: deviceMetadata.uuid || "Unknown",
          };
        }
        todayUnfinishedChangeLog.logs.push(logEntry);

        // Update unfinished arrays with today's data
        const updatedUnfinishedShop = updateUnfinishedForDate(
          unfinishedShopArray,
          todayDate,
          todayUnfinishedShop
        );
        const updatedUnfinishedGodown = updateUnfinishedForDate(
          unfinishedGodownArray,
          todayDate,
          todayUnfinishedGodown
        );
        const updatedUnfinishedChangeLog = updateUnfinishedForDate(
          unfinishedChangeLogArray,
          todayDate,
          todayUnfinishedChangeLog
        );

        // Save to unfinished fields
        existingRow.UnfinishedShop = JSON.stringify(updatedUnfinishedShop);
        existingRow.UnfinishedGodown = JSON.stringify(updatedUnfinishedGodown);
        existingRow.UnfinishedChangeLog = JSON.stringify(
          updatedUnfinishedChangeLog
        );
        existingRow.LastUpdated = formattedTimestamp;

        // Keep regular fields unchanged (they will be updated on finish)
        if (item !== undefined) existingRow.Item = item;
        if (mrp !== undefined) existingRow.MRP = mrp;
        if (bpc !== undefined) existingRow.BPC = bpc;

        console.log(`📝 Updated unfinished product for ${todayDate}:`, {
          location,
          count,
          user: operatorName,
        });

        data[existingIndex] = existingRow;
      } else {
        // Create new unfinished data for today
        const todayUnfinishedShop = {
          shop: location === "Shop" ? count : "0.000",
          item: item || "BEER",
          mrp: mrp || "0.00",
          bpc: bpc || "12",
        };
        const todayUnfinishedGodown = {
          godown: location === "Godown" ? count : "0.000",
          item: item || "BEER",
          mrp: mrp || "0.00",
          bpc: bpc || "12",
        };

        const newRow = {
          "Sl.": "",
          Item: item || "BEER",
          Brand: brand,
          Pack: pack,
          BPC: bpc || "12",
          MRP: mrp || "0.00",
          Godown: "0.000",
          Shop: "0.000",
          BarCode: "",
          LastUpdated: "",
          UnfinishedLastUpdated: formattedTimestamp,
          FinishedLastUpdated: "",
          GodownMatched: "NO",
          ShopMatched: "NO",
          GodownMatchedDate: "[]",
          ShopMatchedDate: "[]",
          ChangeLog: "[]",
          UnfinishedShop: "[]", // Will be set below
          UnfinishedGodown: "[]", // Will be set below
          UnfinishedChangeLog: "[]", // Will be set below
          UnfinishedShopMatched: "NO",
          UnfinishedGodownMatched: "NO",
          RecheckShown: "NO",
        };
        if (shouldShowRecheckWarning || brandHasRecheck) {
          setRecheckShownForLocation(
            newRow,
            location,
            shouldShowRecheckWarning || brandHasRecheck
          );
        }

        // Update match status for unfinished data
        // 1. Find brand in brands.csv (already done via masterProduct)
        // 2. Check the Shop or Godown column from brands.csv
        // 3. Compare values and mark YES/NO
        const unfinishedValue =
          location === "Shop"
            ? todayUnfinishedShop.shop
            : todayUnfinishedGodown.godown;
        const matchResult = updateUnfinishedLocationMatchStatus(
          newRow,
          location,
          masterProduct,
          unfinishedValue
        );

        // Get the value from brands.csv for the specific location (Shop or Godown column)
        const brandsCsvValue = masterProduct ? masterProduct[location] : null;

        console.log(`🔍 SAVE - Matching check for NEW ${brand} ${pack}ml:`);
        console.log(`   Location: ${location}`);
        console.log(`   Found in brands.csv: ${masterProduct ? "YES" : "NO"}`);
        if (masterProduct) {
          console.log(
            `   brands.csv ${location} column value: ${brandsCsvValue || "N/A"}`
          );
        }
        console.log(`   Entered value: ${unfinishedValue}`);
        console.log(`   Values match: ${matchResult.matched ? "YES" : "NO"}`);
        console.log(
          `   Marking Unfinished${location}Matched: ${
            matchResult.matched ? "YES" : "NO"
          }`
        );

        if (location === "Shop") {
          newRow.UnfinishedShopMatched = matchResult.matched ? "YES" : "NO";
        } else {
          newRow.UnfinishedGodownMatched = matchResult.matched ? "YES" : "NO";
        }

        const todayUnfinishedChangeLog = {
          logs: [
            {
              time: nowISO,
              action: "Added (Unfinished)",
              user: operatorName,
              operatorName,
              date: todayDate,
              matched: matchResult.matched,
              isMatch: matchResult.matched,
              currentStock: masterProduct ? masterProduct[location] : "N/A",
              ...(resolvedShopName && { shopName: resolvedShopName }),
              ...(phoneName && { phoneName }),
              ...(deviceMetadata && {
                device: {
                  model: deviceMetadata.model || "Unknown",
                  platform: deviceMetadata.platform || "Unknown",
                  uuid: deviceMetadata.uuid || "Unknown",
                },
              }),
              changes: {
                [location]: count,
                MRP: mrp || "0.00",
                BPC: bpc || "12",
              },
            },
          ],
        };

        newRow.UnfinishedShop = JSON.stringify([
          { date: todayDate, data: todayUnfinishedShop },
        ]);
        newRow.UnfinishedGodown = JSON.stringify([
          { date: todayDate, data: todayUnfinishedGodown },
        ]);
        newRow.UnfinishedChangeLog = JSON.stringify([
          { date: todayDate, data: todayUnfinishedChangeLog },
        ]);

        data.push(newRow);
        console.log(
          `➕ Added new unfinished product for ${todayDate}: ${brand} ${pack}ml`
        );
      }

      data.forEach((row) => {
        if (
          (row.Brand || "").toString().toLowerCase().trim() === normalizedBrand
        ) {
          if (!row.RecheckShown) {
            row.RecheckShown = "NO";
          }
          if (shouldShowRecheckWarning) {
            setRecheckShownForLocation(row, location, true);
          }
        }
      });

      data.forEach((row, index) => {
        row["Sl."] = (index + 1).toString();
      });

      await writeCycleCsv(filePath, data, cycleDate, csvData.metadata);

      console.log(`✅ SAVE COMPLETE - Total rows: ${data.length}\n`);

      res.json({
        success: true,
        message:
          existingIndex >= 0
            ? "Product updated successfully"
            : "Product added successfully",
        cycleDate,
        totalRows: data.length,
        stockMismatch: stockMismatch, // Include mismatch info for frontend to show modal
        showRecheckWarning: shouldShowRecheckWarning,
      });
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/cycle/:date/product", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const { brand, pack } = req.body;

      if (!brand || !pack) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: brand, pack",
        });
      }

      const filePath = getCycleFilePath(cycleDate);
      const csvData = await parseCycleCsv(filePath);
      let data = csvData.data || [];

      const initialLength = data.length;
      data = data.filter(
        (row) =>
          !(
            row.Brand &&
            row.Pack &&
            row.Brand.toLowerCase() === brand.toLowerCase() &&
            row.Pack.toString() === pack.toString()
          )
      );

      if (data.length === initialLength) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      data.forEach((row, index) => {
        row["Sl."] = (index + 1).toString();
      });

      const metadata = csvData.metadata || {
        title: "Vinbros and Co.",
        subtitle: "Closing Stock",
      };

      await writeCycleCsv(filePath, data, cycleDate, metadata);

      res.json({
        success: true,
        message: "Product deleted successfully",
        cycleDate,
        deletedProduct: {
          brand,
          pack,
        },
        totalRows: data.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/:date/match", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const { brand, pack } = req.query;

      if (!brand || !pack) {
        return res.status(400).json({
          success: false,
          message: "Missing required query parameters: brand, pack",
        });
      }

      const filePath = getCycleFilePath(cycleDate);
      const csvData = await parseCycleCsv(filePath);
      const data = csvData.data || [];
      const todayDate = getTodayDateString();

      console.log(
        `🔍 Matching product for Brand: '${brand}', Pack: '${pack}' in cycle: ${cycleDate}`
      );

      const matchedProduct = data.find(
        (row) =>
          row.Brand &&
          row.Pack &&
          row.Brand.toLowerCase() === brand.toLowerCase() &&
          row.Pack.toString() === pack.toString()
      );

      if (!matchedProduct) {
        return res.json({
          success: true,
          matched: false,
          cycleDate,
          message: "No matching product found",
        });
      }

      // --------------------------
      // PREFILL RULES (UNFINISHED ONLY)
      // --------------------------

      let finalGodown = "0.000";
      let finalShop = "0.000";
      let usedUnfinishedGodown = false;
      let usedUnfinishedShop = false;

      const unfinishedGodownArray = parseUnfinishedData(
        matchedProduct.UnfinishedGodown || "[]"
      );
      const unfinishedShopArray = parseUnfinishedData(
        matchedProduct.UnfinishedShop || "[]"
      );
      const unfinishedChangeLogArray = parseUnfinishedData(
        matchedProduct.UnfinishedChangeLog || "[]"
      );

      const todayUnfinishedGodown = getUnfinishedForDate(
        unfinishedGodownArray,
        todayDate
      );
      const todayUnfinishedShop = getUnfinishedForDate(
        unfinishedShopArray,
        todayDate
      );
      const todayUnfinishedChangeLog = getUnfinishedForDate(
        unfinishedChangeLogArray,
        todayDate
      );

      const getLatestUnfinishedLogDate = (logData, location) => {
        if (!logData || !Array.isArray(logData.logs)) return null;
        const locationKey = location;
        const locationKeyLower = location.toLowerCase();
        for (let i = logData.logs.length - 1; i >= 0; i -= 1) {
          const entry = logData.logs[i];
          if (!entry || typeof entry !== "object") continue;
          const changes = entry.changes || {};
          const hasLocationChange =
            Object.prototype.hasOwnProperty.call(changes, locationKey) ||
            Object.prototype.hasOwnProperty.call(changes, locationKeyLower);
          if (!hasLocationChange) continue;
          if (typeof entry.date === "string" && entry.date.trim()) {
            return entry.date.trim();
          }
          if (typeof entry.time === "string" && entry.time.includes("T")) {
            return entry.time.split("T")[0];
          }
        }
        return null;
      };

      const shouldPrefillFromUnfinished = (
        unfinishedValue,
        finishedValue,
        location
      ) => {
        if (!unfinishedValue) return false;
        const unfinishedParsed = parseCountValue(
          unfinishedValue,
          matchedProduct.BPC
        );
        if (unfinishedParsed.formatted === "0.000") return false;
        const finishedParsed = parseCountValue(
          finishedValue,
          matchedProduct.BPC
        );
        if (unfinishedParsed.total === finishedParsed.total) return false;
        const lastEditedDate = getLatestUnfinishedLogDate(
          todayUnfinishedChangeLog,
          location
        );
        if (!lastEditedDate) return false;
        return lastEditedDate === todayDate;
      };

      if (
        shouldPrefillFromUnfinished(
          todayUnfinishedGodown?.godown,
          matchedProduct.Godown,
          "Godown"
        )
      ) {
        finalGodown = todayUnfinishedGodown.godown;
        usedUnfinishedGodown = true;
        console.log(
          `📦 Prefill godown from unfinished (today ${todayDate}): ${finalGodown}`
        );
      }

      if (
        shouldPrefillFromUnfinished(
          todayUnfinishedShop?.shop,
          matchedProduct.Shop,
          "Shop"
        )
      ) {
        finalShop = todayUnfinishedShop.shop;
        usedUnfinishedShop = true;
        console.log(
          `📦 Prefill shop from unfinished (today ${todayDate}): ${finalShop}`
        );
      }

      const isStale = isStaleUnmatched(matchedProduct, todayDate);
      if (isStale) {
        if (
          isMatchFlagNo(matchedProduct.GodownMatched) &&
          !usedUnfinishedGodown
        ) {
          finalGodown = "0.000";
        }
        if (isMatchFlagNo(matchedProduct.ShopMatched) && !usedUnfinishedShop) {
          finalShop = "0.000";
        }
      }

      // --------------------------
      // RESPONSE
      // --------------------------

      const responseProduct = {
        ...matchedProduct,
        Godown: finalGodown,
        Shop: finalShop,
      };

      res.json({
        success: true,
        matched: true,
        cycleDate,
        product: responseProduct,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/:date/unfinished", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const todayDate = getTodayDateString();
      const operatorName = extractOperatorName(req);
      const normalizedOperatorName = normalizeOperatorName(operatorName);
      if (!normalizedOperatorName || normalizedOperatorName === "unknown") {
        return res.status(400).json({
          success: false,
          message:
            "operatorName is required. Pass ?operatorName=<name> or x-operator-name header.",
        });
      }
      const operatorFilter = operatorName;

      const filePath = getCycleFilePath(cycleDate);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      const data = csvData.data || [];

      const unfinishedProducts = collectUnfinishedProductsForDate(
        data,
        todayDate,
        operatorFilter
      );
      const scannedCounts = getScannedCountsByLocation(
        data,
        todayDate,
        operatorFilter
      );

      res.json({
        success: true,
        cycleDate: cycleDate,
        todayDate: todayDate,
        operatorName: operatorFilter,
        count: unfinishedProducts.length,
        scannedCounts,
        products: unfinishedProducts,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/:date/products", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const filePath = getCycleFilePath(cycleDate);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      const products = csvData.data || [];

      res.json({
        success: true,
        cycleDate: cycleDate,
        count: products.length,
        data: products,
        products: products, // Also include as 'products' for compatibility
      });
    } catch (error) {
      console.error("Error fetching cycle products:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/api/cycle/:date/finish", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const todayDate = getTodayDateString();
      const operatorName = extractOperatorName(req);
      const normalizedLocation = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        if (["goddown", "godownn", "goddwn", "godaown"].includes(normalized)) {
          return "godown";
        }
        if (["godown"].includes(normalized)) return "godown";
        if (["shop", "shops"].includes(normalized)) return "shop";
        if (
          ["both", "all", "shop&godown", "shopandgodown"].includes(normalized)
        ) {
          return "both";
        }
        return normalized ? "shop" : "both";
      };
      const locationMode = normalizedLocation(req.query.location);
      const includeShop = locationMode === "shop" || locationMode === "both";
      const includeGodown =
        locationMode === "godown" || locationMode === "both";
      const printerIP = (req.query.printer || "").toString().trim();

      const filePath = getCycleFilePath(cycleDate);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      let data = csvData.data || [];
      let updatedCount = 0;

      const unfinishedProductsForPrint = collectUnfinishedProductsForDate(
        data,
        todayDate
      );

      const masterData = await loadMasterData();
      const masterMap = masterData?.map;

      const finishedResults = [];

      console.log(`\n🏁 === FINISHING PRODUCTS FOR ${todayDate} ===\n`);

      data.forEach((row) => {
        if (!row.Brand || !row.Pack) return;

        const unfinishedShopArray = parseUnfinishedData(
          row.UnfinishedShop || "[]"
        );
        const unfinishedGodownArray = parseUnfinishedData(
          row.UnfinishedGodown || "[]"
        );
        const unfinishedChangeLogArray = parseUnfinishedData(
          row.UnfinishedChangeLog || "[]"
        );

        const todayUnfinishedShop = getUnfinishedForDate(
          unfinishedShopArray,
          todayDate
        );
        const todayUnfinishedGodown = getUnfinishedForDate(
          unfinishedGodownArray,
          todayDate
        );
        const todayUnfinishedChangeLog = getUnfinishedForDate(
          unfinishedChangeLogArray,
          todayDate
        );

        let hasUpdates = false;

        const shopCount =
          includeShop && todayUnfinishedShop
            ? parseCountValue(
                todayUnfinishedShop.shop || "0.000",
                row.BPC || "12"
              )
            : null;
        const godownCount =
          includeGodown && todayUnfinishedGodown
            ? parseCountValue(
                todayUnfinishedGodown.godown || "0.000",
                row.BPC || "12"
              )
            : null;

        const shouldFinishShop =
          includeShop && todayUnfinishedShop && (shopCount?.total || 0) > 0;
        const shouldFinishGodown =
          includeGodown &&
          todayUnfinishedGodown &&
          (godownCount?.total || 0) > 0;

        const hasRelevantEntries = shouldFinishShop || shouldFinishGodown;

        if (!hasRelevantEntries) {
          return;
        }

        console.log(`\n📦 Processing: ${row.Brand} ${row.Pack}ml`);

        // Transfer shop data - REPLACE instead of add
        if (shouldFinishShop && shopCount) {
          console.log(
            `   📍 Shop: ${row.Shop || "0.000"} → ${shopCount.formatted}`
          );
          row.Shop = shopCount.formatted;
          hasUpdates = true;
        }

        // Mark unfinished shop data as finished only if shop was updated
        if (shouldFinishShop && todayUnfinishedShop) {
          todayUnfinishedShop.finished = true;
          const updatedUnfinishedShop = updateUnfinishedForDate(
            unfinishedShopArray,
            todayDate,
            todayUnfinishedShop
          );
          row.UnfinishedShop = JSON.stringify(updatedUnfinishedShop);
        }

        // Transfer godown data - REPLACE instead of add
        if (shouldFinishGodown && godownCount) {
          console.log(
            `   📍 Godown: ${row.Godown || "0.000"} → ${godownCount.formatted}`
          );
          row.Godown = godownCount.formatted;
          hasUpdates = true;
        }

        // Mark unfinished godown data as finished only if godown was updated
        if (shouldFinishGodown && todayUnfinishedGodown) {
          todayUnfinishedGodown.finished = true;
          const updatedUnfinishedGodown = updateUnfinishedForDate(
            unfinishedGodownArray,
            todayDate,
            todayUnfinishedGodown
          );
          row.UnfinishedGodown = JSON.stringify(updatedUnfinishedGodown);
        }

        // Recalculate match status against master data only for updated locations
        let shopMatched = row.ShopMatched === "YES";
        let godownMatched = row.GodownMatched === "YES";

        const masterProduct =
          masterMap && row.Brand && row.Pack
            ? masterMap.get(createProductKey(row.Brand, row.Pack))
            : null;

        const bpcValue = parseInt(row.BPC, 10) || 12;

        if (masterProduct) {
          if (shouldFinishShop) {
            const masterShop = parseCountValue(masterProduct.Shop, bpcValue);
            const rowShop = parseCountValue(row.Shop, bpcValue);
            shopMatched = masterShop.total === rowShop.total;
          }

          if (shouldFinishGodown) {
            const masterGodown = parseCountValue(masterProduct.Godown, bpcValue);
            const rowGodown = parseCountValue(row.Godown, bpcValue);
            godownMatched = masterGodown.total === rowGodown.total;
          }
        }

        if (shouldFinishShop) {
          row.ShopMatched = shopMatched ? "YES" : "NO";
        }
        if (shouldFinishGodown) {
          row.GodownMatched = godownMatched ? "YES" : "NO";
        }

        // Update MatchedDate arrays
        if (shouldFinishShop) {
          let shopMatchedDateArray = [];
          try {
            shopMatchedDateArray = row.ShopMatchedDate
              ? JSON.parse(row.ShopMatchedDate)
              : [];
          } catch {
            shopMatchedDateArray = [];
          }

          const existingShopMatchIndex = shopMatchedDateArray.findIndex(
            (item) => item.date === todayDate
          );

          if (existingShopMatchIndex >= 0) {
            shopMatchedDateArray[existingShopMatchIndex].status =
              row.ShopMatched;
          } else {
            shopMatchedDateArray.push({
              date: todayDate,
              status: row.ShopMatched,
            });
          }

          row.ShopMatchedDate = JSON.stringify(shopMatchedDateArray);
        }

        if (shouldFinishGodown) {
          let godownMatchedDateArray = [];
          try {
            godownMatchedDateArray = row.GodownMatchedDate
              ? JSON.parse(row.GodownMatchedDate)
              : [];
          } catch {
            godownMatchedDateArray = [];
          }

          const existingGodownMatchIndex = godownMatchedDateArray.findIndex(
            (item) => item.date === todayDate
          );

          if (existingGodownMatchIndex >= 0) {
            godownMatchedDateArray[existingGodownMatchIndex].status =
              row.GodownMatched;
          } else {
            godownMatchedDateArray.push({
              date: todayDate,
              status: row.GodownMatched,
            });
          }

          row.GodownMatchedDate = JSON.stringify(godownMatchedDateArray);
        }

        // Transfer change log
        let existingLogs = [];
        try {
          existingLogs = row.ChangeLog ? JSON.parse(row.ChangeLog) : [];
        } catch {
          existingLogs = [];
        }

        const hasExistingFinishLog = existingLogs.some(
          (log) =>
            log.date === todayDate &&
            (log.action === "Created" || log.action === "Modified")
        );

        const actionType = hasExistingFinishLog ? "Modified" : "Created";

        let latestMetadata = {};
        if (
          todayUnfinishedChangeLog &&
          todayUnfinishedChangeLog.logs &&
          todayUnfinishedChangeLog.logs.length > 0
        ) {
          const latestLog =
            todayUnfinishedChangeLog.logs[
              todayUnfinishedChangeLog.logs.length - 1
            ];
          if (latestLog.shopName) latestMetadata.shopName = latestLog.shopName;
          if (latestLog.phoneName)
            latestMetadata.phoneName = latestLog.phoneName;
          if (latestLog.device) latestMetadata.device = latestLog.device;
        }

        const shopMatchFlag = row.ShopMatched === "YES";
        const godownMatchFlag = row.GodownMatched === "YES";

        const changeDetails = {
          note: `Stock ${actionType} from unfinished data`,
        };
        if (shouldFinishShop) {
          changeDetails.shop = row.Shop;
        }
        if (shouldFinishGodown) {
          changeDetails.godown = row.Godown;
        }

        if (shouldFinishShop) {
          changeDetails.shop = row.Shop;
        }
        if (shouldFinishGodown) {
          changeDetails.godown = row.Godown;
        }

        const newLogEntry = {
          time: new Date().toISOString(),
          action: actionType,
          user: operatorName,
          operatorName,
          date: todayDate,
          matched: shopMatchFlag && godownMatchFlag,
          isMatch: shopMatchFlag && godownMatchFlag,
          isMatchShop: shopMatchFlag,
          isMatchGodown: godownMatchFlag,
          locationMatches: {
            shop: shopMatchFlag,
            godown: godownMatchFlag,
          },
          currentStock: masterProduct
            ? { Shop: masterProduct.Shop, Godown: masterProduct.Godown }
            : "N/A",
          ...latestMetadata,
          changes: changeDetails,
        };

        existingLogs.push(newLogEntry);
        console.log(`   📝 Added new log entry: ${actionType}`);

        row.ChangeLog = JSON.stringify(existingLogs);
        hasUpdates = true;

        // Finalize
        if (hasUpdates) {
          row.FinishedLastUpdated = formatTimestampIST(new Date());

          updatedCount++;
          console.log(`   ✅ Finished (Copied) data for ${todayDate}`);

          finishedResults.push({
            brand: row.Brand,
            pack: row.Pack,
            shopMatched: row.ShopMatched === "YES",
            godownMatched: row.GodownMatched === "YES",
          });
        } else {
          console.log(`   ⏭️  No updates for today`);
        }
      });

      await writeCycleCsv(filePath, data, cycleDate, csvData.metadata);

      console.log(`\n🏁 FINISH COMPLETE - Updated ${updatedCount} products\n`);

      let printResult = null;
      if (printerIP) {
        const locationField = locationMode === "godown" ? "Godown" : "Shop";
        const locationLabel = locationMode.toUpperCase();

        const formatPackLabel = (packValue) => {
          const trimmed = String(packValue || "").trim();
          if (!trimmed) return "";
          if (/[a-zA-Z]/.test(trimmed)) return trimmed;
          return `${trimmed}ml`;
        };

        const formatSignedDiff = (diffValue) => {
          const numeric = Number(diffValue) || 0;
          if (numeric === 0) return "0";
          return numeric > 0 ? `+${numeric}` : `${numeric}`;
        };

        const printItems = unfinishedProductsForPrint
          .map((item) => {
            const key = createProductKey(item.brand, item.pack);
            const masterProduct = key && masterMap ? masterMap.get(key) : null;
            const bpcValue =
              parseInt(item.bpc || masterProduct?.BPC || "12", 10) || 12;
            const masterCount = parseCountValue(
              masterProduct?.[locationField] || "0.000",
              bpcValue
            );
            const currentTotal =
              locationMode === "godown"
                ? item.godown?.total || 0
                : item.shop?.total || 0;
            const diff = currentTotal - (masterCount.total || 0);
            if (diff === 0) return null;
            return {
              name: `${item.brand} ${formatPackLabel(item.pack)}`,
              diff: formatSignedDiff(diff),
            };
          })
          .filter((item) => item);

        const html = generateFinishReportHTML({
          cycleDate,
          operatorName,
          locationLabel,
          items: printItems,
        });

        try {
          const { createPrinterByIP, printHtmlBlock } = require("./printer");
          const printer = createPrinterByIP(printerIP);
          const result = await printHtmlBlock(
            printer,
            html,
            "finish_report",
            1
          );
          printResult = { success: true, ...result };
        } catch (error) {
          console.error("Error printing finish report:", error);
          printResult = {
            success: false,
            message: error.message || "Failed to print finish report",
          };
        }
      }

      res.json({
        success: true,
        message: `Finished ${updatedCount} products for ${todayDate}`,
        cycleDate: cycleDate,
        todayDate: todayDate,
        updatedCount: updatedCount,
        results: finishedResults,
        allMatched: finishedResults.every(
          (r) => r.shopMatched && r.godownMatched
        ),
        printResult,
      });
    } catch (error) {
      console.error("❌ Error in finish route:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/api/cycle/:date/finish-by-operator", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const todayDate = getTodayDateString();
      const operatorName = extractOperatorName(req);
      if (!operatorName || operatorName === "Unknown") {
        return res.status(400).json({
          success: false,
          message: "Operator name is required",
        });
      }
      const normalizedLocation = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        if (["goddown", "godownn", "goddwn", "godaown"].includes(normalized)) {
          return "godown";
        }
        if (["godown"].includes(normalized)) return "godown";
        if (["shop", "shops"].includes(normalized)) return "shop";
        if (
          ["both", "all", "shop&godown", "shopandgodown"].includes(normalized)
        ) {
          return "both";
        }
        return normalized ? "shop" : "both";
      };
      const locationMode = normalizedLocation(req.query.location);
      const includeShop = locationMode === "shop" || locationMode === "both";
      const includeGodown =
        locationMode === "godown" || locationMode === "both";
      const printerIP = (req.query.printer || "").toString().trim();

      const filePath = getCycleFilePath(cycleDate);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      let data = csvData.data || [];
      let updatedCount = 0;

      const unfinishedProductsForPrint = collectUnfinishedProductsForDate(
        data,
        todayDate
      );

      const masterData = await loadMasterData();
      const masterMap = masterData?.map;

      const finishedResults = [];
      const operatorProductKeys = new Set();
      data.forEach((row) => {
        if (!row.Brand || !row.Pack) return;
        if (hasOperatorUnfinishedOnDate(row, todayDate, operatorName)) {
          const key = createProductKey(row.Brand, row.Pack);
          if (key) operatorProductKeys.add(key);
        }
      });

      console.log(
        `\n🏁 === FINISHING PRODUCTS FOR ${todayDate} (Operator: ${operatorName}) ===\n`
      );

      data.forEach((row) => {
        if (!row.Brand || !row.Pack) return;
        const rowKey = createProductKey(row.Brand, row.Pack);
        if (!rowKey || !operatorProductKeys.has(rowKey)) return;

        const unfinishedShopArray = parseUnfinishedData(
          row.UnfinishedShop || "[]"
        );
        const unfinishedGodownArray = parseUnfinishedData(
          row.UnfinishedGodown || "[]"
        );
        const unfinishedChangeLogArray = parseUnfinishedData(
          row.UnfinishedChangeLog || "[]"
        );

        const todayUnfinishedShop = getUnfinishedForDate(
          unfinishedShopArray,
          todayDate
        );
        const todayUnfinishedGodown = getUnfinishedForDate(
          unfinishedGodownArray,
          todayDate
        );
        const todayUnfinishedChangeLog = getUnfinishedForDate(
          unfinishedChangeLogArray,
          todayDate
        );

        let hasUpdates = false;

        const shopCount =
          includeShop && todayUnfinishedShop
            ? parseCountValue(
                todayUnfinishedShop.shop || "0.000",
                row.BPC || "12"
              )
            : null;
        const godownCount =
          includeGodown && todayUnfinishedGodown
            ? parseCountValue(
                todayUnfinishedGodown.godown || "0.000",
                row.BPC || "12"
              )
            : null;

        const shouldFinishShop =
          includeShop && todayUnfinishedShop && (shopCount?.total || 0) > 0;
        const shouldFinishGodown =
          includeGodown &&
          todayUnfinishedGodown &&
          (godownCount?.total || 0) > 0;

        const hasRelevantEntries = shouldFinishShop || shouldFinishGodown;

        if (!hasRelevantEntries) {
          return;
        }

        console.log(`\n📦 Processing: ${row.Brand} ${row.Pack}ml`);

        // Transfer shop data - REPLACE instead of add
        if (shouldFinishShop && shopCount) {
          console.log(
            `   📍 Shop: ${row.Shop || "0.000"} → ${shopCount.formatted}`
          );
          row.Shop = shopCount.formatted;
          hasUpdates = true;
        }

        // Mark unfinished shop data as finished only if shop was updated
        if (shouldFinishShop && todayUnfinishedShop) {
          todayUnfinishedShop.finished = true;
          const updatedUnfinishedShop = updateUnfinishedForDate(
            unfinishedShopArray,
            todayDate,
            todayUnfinishedShop
          );
          row.UnfinishedShop = JSON.stringify(updatedUnfinishedShop);
        }

        // Transfer godown data - REPLACE instead of add
        if (shouldFinishGodown && godownCount) {
          console.log(
            `   📍 Godown: ${row.Godown || "0.000"} → ${godownCount.formatted}`
          );
          row.Godown = godownCount.formatted;
          hasUpdates = true;
        }

        // Mark unfinished godown data as finished only if godown was updated
        if (shouldFinishGodown && todayUnfinishedGodown) {
          todayUnfinishedGodown.finished = true;
          const updatedUnfinishedGodown = updateUnfinishedForDate(
            unfinishedGodownArray,
            todayDate,
            todayUnfinishedGodown
          );
          row.UnfinishedGodown = JSON.stringify(updatedUnfinishedGodown);
        }

        // Recalculate match status against master data only for updated locations
        let shopMatched = row.ShopMatched === "YES";
        let godownMatched = row.GodownMatched === "YES";

        const masterProduct =
          masterMap && row.Brand && row.Pack
            ? masterMap.get(createProductKey(row.Brand, row.Pack))
            : null;

        const bpcValue = parseInt(row.BPC, 10) || 12;

        if (masterProduct) {
          if (shouldFinishShop) {
            const masterShop = parseCountValue(masterProduct.Shop, bpcValue);
            const rowShop = parseCountValue(row.Shop, bpcValue);
            shopMatched = masterShop.total === rowShop.total;
          }

          if (shouldFinishGodown) {
            const masterGodown = parseCountValue(masterProduct.Godown, bpcValue);
            const rowGodown = parseCountValue(row.Godown, bpcValue);
            godownMatched = masterGodown.total === rowGodown.total;
          }
        }

        if (shouldFinishShop) {
          row.ShopMatched = shopMatched ? "YES" : "NO";
        }
        if (shouldFinishGodown) {
          row.GodownMatched = godownMatched ? "YES" : "NO";
        }

        // Update MatchedDate arrays
        if (shouldFinishShop) {
          let shopMatchedDateArray = [];
          try {
            shopMatchedDateArray = row.ShopMatchedDate
              ? JSON.parse(row.ShopMatchedDate)
              : [];
          } catch {
            shopMatchedDateArray = [];
          }

          const existingShopMatchIndex = shopMatchedDateArray.findIndex(
            (item) => item.date === todayDate
          );

          if (existingShopMatchIndex >= 0) {
            shopMatchedDateArray[existingShopMatchIndex].status =
              row.ShopMatched;
          } else {
            shopMatchedDateArray.push({
              date: todayDate,
              status: row.ShopMatched,
            });
          }

          row.ShopMatchedDate = JSON.stringify(shopMatchedDateArray);
        }

        if (shouldFinishGodown) {
          let godownMatchedDateArray = [];
          try {
            godownMatchedDateArray = row.GodownMatchedDate
              ? JSON.parse(row.GodownMatchedDate)
              : [];
          } catch {
            godownMatchedDateArray = [];
          }

          const existingGodownMatchIndex = godownMatchedDateArray.findIndex(
            (item) => item.date === todayDate
          );

          if (existingGodownMatchIndex >= 0) {
            godownMatchedDateArray[existingGodownMatchIndex].status =
              row.GodownMatched;
          } else {
            godownMatchedDateArray.push({
              date: todayDate,
              status: row.GodownMatched,
            });
          }

          row.GodownMatchedDate = JSON.stringify(godownMatchedDateArray);
        }

        // Transfer change log
        let existingLogs = [];
        try {
          existingLogs = row.ChangeLog ? JSON.parse(row.ChangeLog) : [];
        } catch {
          existingLogs = [];
        }

        const hasExistingFinishLog = existingLogs.some(
          (log) =>
            log.date === todayDate &&
            (log.action === "Created" || log.action === "Modified")
        );

        const actionType = hasExistingFinishLog ? "Modified" : "Created";

        let latestMetadata = {};
        if (
          todayUnfinishedChangeLog &&
          todayUnfinishedChangeLog.logs &&
          todayUnfinishedChangeLog.logs.length > 0
        ) {
          const latestLog =
            todayUnfinishedChangeLog.logs[
              todayUnfinishedChangeLog.logs.length - 1
            ];
          if (latestLog.shopName) latestMetadata.shopName = latestLog.shopName;
          if (latestLog.phoneName)
            latestMetadata.phoneName = latestLog.phoneName;
          if (latestLog.device) latestMetadata.device = latestLog.device;
        }

        const shopMatchFlag = row.ShopMatched === "YES";
        const godownMatchFlag = row.GodownMatched === "YES";

        const changeDetails = {
          note: `Stock ${actionType} from unfinished data`,
        };
        if (shouldFinishShop) {
          changeDetails.shop = row.Shop;
        }
        if (shouldFinishGodown) {
          changeDetails.godown = row.Godown;
        }

        const newLogEntry = {
          time: new Date().toISOString(),
          action: actionType,
          user: operatorName,
          operatorName,
          date: todayDate,
          matched: shopMatchFlag && godownMatchFlag,
          isMatch: shopMatchFlag && godownMatchFlag,
          isMatchShop: shopMatchFlag,
          isMatchGodown: godownMatchFlag,
          locationMatches: {
            shop: shopMatchFlag,
            godown: godownMatchFlag,
          },
          currentStock: masterProduct
            ? { Shop: masterProduct.Shop, Godown: masterProduct.Godown }
            : "N/A",
          ...latestMetadata,
          changes: changeDetails,
        };

        existingLogs.push(newLogEntry);
        console.log(`   📝 Added new log entry: ${actionType}`);

        row.ChangeLog = JSON.stringify(existingLogs);
        hasUpdates = true;

        // Finalize
        if (hasUpdates) {
          row.FinishedLastUpdated = formatTimestampIST(new Date());

          updatedCount++;
          console.log(`   ✅ Finished (Copied) data for ${todayDate}`);

          finishedResults.push({
            brand: row.Brand,
            pack: row.Pack,
            shopMatched: row.ShopMatched === "YES",
            godownMatched: row.GodownMatched === "YES",
          });
        } else {
          console.log(`   ⏭️  No updates for today`);
        }
      });

      await writeCycleCsv(filePath, data, cycleDate, csvData.metadata);

      console.log(
        `\n🏁 FINISH COMPLETE - Updated ${updatedCount} products (Operator: ${operatorName})\n`
      );

      let printResult = null;
      if (printerIP) {
        const locationField = locationMode === "godown" ? "Godown" : "Shop";
        const locationLabel = locationMode.toUpperCase();

        const formatPackLabel = (packValue) => {
          const trimmed = String(packValue || "").trim();
          if (!trimmed) return "";
          if (/[a-zA-Z]/.test(trimmed)) return trimmed;
          return `${trimmed}ml`;
        };

        const formatSignedDiff = (diffValue) => {
          const numeric = Number(diffValue) || 0;
          if (numeric === 0) return "0";
          return numeric > 0 ? `+${numeric}` : `${numeric}`;
        };

        const printItems = unfinishedProductsForPrint
          .filter((item) => {
            const key = createProductKey(item.brand, item.pack);
            return key && operatorProductKeys.has(key);
          })
          .map((item) => {
            const key = createProductKey(item.brand, item.pack);
            const masterProduct = key && masterMap ? masterMap.get(key) : null;
            const bpcValue =
              parseInt(item.bpc || masterProduct?.BPC || "12", 10) || 12;
            const masterCount = parseCountValue(
              masterProduct?.[locationField] || "0.000",
              bpcValue
            );
            const currentTotal =
              locationMode === "godown"
                ? item.godown?.total || 0
                : item.shop?.total || 0;
            const diff = currentTotal - (masterCount.total || 0);
            if (diff === 0) return null;
            return {
              name: `${item.brand} ${formatPackLabel(item.pack)}`,
              diff: formatSignedDiff(diff),
            };
          })
          .filter((item) => item);

        const html = generateFinishReportHTML({
          cycleDate,
          operatorName,
          locationLabel,
          items: printItems,
        });

        try {
          const { createPrinterByIP, printHtmlBlock } = require("./printer");
          const printer = createPrinterByIP(printerIP);
          const result = await printHtmlBlock(
            printer,
            html,
            "finish_report",
            1
          );
          printResult = { success: true, ...result };
        } catch (error) {
          console.error("Error printing finish report:", error);
          printResult = {
            success: false,
            message: error.message || "Failed to print finish report",
          };
        }
      }

      res.json({
        success: true,
        message: `Finished ${updatedCount} products for ${todayDate}`,
        cycleDate: cycleDate,
        todayDate: todayDate,
        updatedCount: updatedCount,
        results: finishedResults,
        allMatched: finishedResults.every(
          (r) => r.shopMatched && r.godownMatched
        ),
        printResult,
      });
    } catch (error) {
      console.error("❌ Error in finish-by-operator route:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/api/cycle/:date/product", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const {
        brand,
        pack,
        godown,
        shop,
        item,
        mrp,
        bpc,
        shopName,
        phoneName,
        deviceMetadata,
      } = req.body;
      const operatorName = extractOperatorName(req);
      const configShopName = readShopName();
      const resolvedShopName =
        configShopName || (typeof shopName === "string" ? shopName.trim() : "");

      console.log(`\n📝 === ADDING/UPDATING PRODUCT ===`);
      console.log(
        `Brand: ${brand}, Pack: ${pack}, Location: ${
          godown ? "Godown" : "Shop"
        }, Count: ${godown || shop}, User: ${operatorName}`
      );
      console.log(
        `Shop: ${resolvedShopName || "Not specified"}, Phone: ${
          phoneName || "Not specified"
        }`
      );
      if (deviceMetadata) {
        console.log(
          `Device: ${deviceMetadata.model} (${deviceMetadata.platform}), UUID: ${deviceMetadata.uuid}`
        );
      }

      if (!brand || !pack || (!godown && !shop)) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields: brand, pack, and either godown or shop count",
        });
      }

      const filePath = getCycleFilePath(cycleDate);
      const csvData = await parseCycleCsv(filePath);
      let data = csvData.data || [];
      const masterData = await loadMasterData();
      const masterMap = masterData?.map;
      const productKey = createProductKey(brand, pack);
      const masterProduct =
        productKey && masterMap ? masterMap.get(productKey) : null;

      const count = godown || shop;
      const location = godown ? "Godown" : "Shop";

      // Check for stock mismatch with master data
      let stockMismatch = null;
      if (masterProduct) {
        const masterCount = parseCountValue(
          masterProduct[location],
          masterProduct.BPC || bpc || "12"
        );
        const enteredCount = parseCountValue(
          count,
          bpc || masterProduct.BPC || "12"
        );
        if (enteredCount.total !== masterCount.total) {
          stockMismatch = {
            brand: brand,
            pack: pack,
            location: location,
            masterValue: masterCount.formatted,
            enteredValue: enteredCount.formatted,
            masterTotal: masterCount.total,
            enteredTotal: enteredCount.total,
          };
        }
      } else {
        // No master product - consider it unmatched
        stockMismatch = {
          brand: brand,
          pack: pack,
          location: location,
          error: "Master product not found",
        };
      }

      const normalizedBrand = brand.toString().toLowerCase().trim();
      const brandHasRecheck = data.some(
        (row) =>
          (row.Brand || "").toString().toLowerCase().trim() ===
            normalizedBrand &&
          hasRecheckShownForLocation(row.RecheckShown, location)
      );
      const shouldShowRecheckWarning = !!stockMismatch && !brandHasRecheck;

      const existingIndex = data.findIndex(
        (row) =>
          row.Brand?.toLowerCase().trim() === brand.toLowerCase().trim() &&
          row.Pack?.toString().trim() === pack.toString().trim()
      );

      const now = new Date();
      const nowISO = now.toISOString();
      const formattedTimestamp = formatTimestampIST(now);
      const todayDate = getTodayDateString();

      // Helper function to check if values match
      const checkMatch = (enteredValue, masterValue, bpcValue) => {
        if (!masterProduct || !masterValue) {
          console.log(`   ⚠️ No master product found or master value is empty`);
          return false;
        }

        // Parse both values using the same BPC
        const enteredParsed = parseCountValue(enteredValue, bpcValue);
        const masterParsed = parseCountValue(masterValue, bpcValue);

        console.log(
          `   📊 Parsed entered: ${enteredParsed.formatted} (total: ${enteredParsed.total})`
        );
        console.log(
          `   📊 Parsed master: ${masterParsed.formatted} (total: ${masterParsed.total})`
        );

        // Match if totals are equal
        const matched = enteredParsed.total === masterParsed.total;
        console.log(`   ${matched ? "✅" : "❌"} Match result: ${matched}`);

        return matched;
      };

      if (existingIndex >= 0) {
        const existingRow = data[existingIndex];

        // Initialize new columns if they don't exist
        if (!existingRow.UnfinishedShopMatched) {
          existingRow.UnfinishedShopMatched = "NO";
        }
        if (!existingRow.UnfinishedGodownMatched) {
          existingRow.UnfinishedGodownMatched = "NO";
        }
        if (!existingRow.RecheckShown) {
          existingRow.RecheckShown = "NO";
        }
        if (brandHasRecheck) {
          setRecheckShownForLocation(existingRow, location, true);
        }
        if (!existingRow.UnfinishedLastUpdated) {
          existingRow.UnfinishedLastUpdated = "";
        }
        if (!existingRow.FinishedLastUpdated) {
          existingRow.FinishedLastUpdated = "";
        }
        if (!existingRow.GodownMatchedDate) {
          existingRow.GodownMatchedDate = "[]";
        }
        if (!existingRow.ShopMatchedDate) {
          existingRow.ShopMatchedDate = "[]";
        }

        // Get existing unfinished data
        const unfinishedShopArray = parseUnfinishedData(
          existingRow.UnfinishedShop || "[]"
        );
        const unfinishedGodownArray = parseUnfinishedData(
          existingRow.UnfinishedGodown || "[]"
        );
        const unfinishedChangeLogArray = parseUnfinishedData(
          existingRow.UnfinishedChangeLog || "[]"
        );

        // Get today's unfinished data or create new
        let todayUnfinishedShop = getUnfinishedForDate(
          unfinishedShopArray,
          todayDate
        ) || { shop: "0.000" };
        let todayUnfinishedGodown = getUnfinishedForDate(
          unfinishedGodownArray,
          todayDate
        ) || { godown: "0.000" };
        let todayUnfinishedChangeLog = getUnfinishedForDate(
          unfinishedChangeLogArray,
          todayDate
        ) || { logs: [] };

        // Get BPC value (prioritize from request, then existing, then default)
        const finalBpc = bpc || existingRow.BPC || masterProduct?.BPC || "12";

        // Update today's unfinished data
        if (location === "Godown") {
          todayUnfinishedGodown.godown = count;
        } else {
          todayUnfinishedShop.shop = count;
        }
        if (item !== undefined) {
          todayUnfinishedShop.item = item;
          todayUnfinishedGodown.item = item;
        }
        if (mrp !== undefined) {
          todayUnfinishedShop.mrp = mrp;
          todayUnfinishedGodown.mrp = mrp;
        }
        if (bpc !== undefined) {
          todayUnfinishedShop.bpc = finalBpc;
          todayUnfinishedGodown.bpc = finalBpc;
        }

        // Calculate match status for logging
        let isMatchedForLog = false;
        if (masterProduct) {
          const brandsCsvValue = masterProduct[location];
          isMatchedForLog = checkMatch(count, brandsCsvValue, finalBpc);
        }

        // Update change log for unfinished
        if (!todayUnfinishedChangeLog.logs) {
          todayUnfinishedChangeLog.logs = [];
        }
        const logEntry = {
          time: nowISO,
          action: "Updated (Unfinished)",
          user: operatorName,
          operatorName,
          date: todayDate,
          matched: isMatchedForLog,
          isMatch: isMatchedForLog,
          currentStock: masterProduct ? masterProduct[location] : "N/A",
          changes: {
            [location]: count,
          },
        };
        if (resolvedShopName) logEntry.shopName = resolvedShopName;
        if (phoneName) logEntry.phoneName = phoneName;
        if (deviceMetadata) {
          logEntry.device = {
            model: deviceMetadata.model || "Unknown",
            platform: deviceMetadata.platform || "Unknown",
            uuid: deviceMetadata.uuid || "Unknown",
          };
        }
        todayUnfinishedChangeLog.logs.push(logEntry);

        // Update unfinished arrays with today's data
        const updatedUnfinishedShop = updateUnfinishedForDate(
          unfinishedShopArray,
          todayDate,
          todayUnfinishedShop
        );
        const updatedUnfinishedGodown = updateUnfinishedForDate(
          unfinishedGodownArray,
          todayDate,
          todayUnfinishedGodown
        );
        const updatedUnfinishedChangeLog = updateUnfinishedForDate(
          unfinishedChangeLogArray,
          todayDate,
          todayUnfinishedChangeLog
        );

        // Save to unfinished fields
        existingRow.UnfinishedShop = JSON.stringify(updatedUnfinishedShop);
        existingRow.UnfinishedGodown = JSON.stringify(updatedUnfinishedGodown);
        existingRow.UnfinishedChangeLog = JSON.stringify(
          updatedUnfinishedChangeLog
        );
        existingRow.LastUpdated = formattedTimestamp;

        // Keep regular fields unchanged (they will be updated on finish)
        if (item !== undefined) existingRow.Item = item;
        if (mrp !== undefined) existingRow.MRP = mrp;
        if (bpc !== undefined) existingRow.BPC = finalBpc;

        console.log(`📝 Updated unfinished product for ${todayDate}:`, {
          location,
          count,
          user: operatorName,
        });

        // Check match status for the location being updated
        console.log(`\n🔍 SAVE - Matching check for ${brand} ${pack}ml:`);
        console.log(`   Location: ${location}`);
        console.log(`   Found in brands.csv: ${masterProduct ? "YES" : "NO"}`);

        if (masterProduct) {
          const brandsCsvValue = masterProduct[location];
          console.log(
            `   brands.csv ${location} column value: ${brandsCsvValue || "N/A"}`
          );
          console.log(`   Entered value: ${count}`);
          console.log(`   BPC used for comparison: ${finalBpc}`);

          const matched = checkMatch(count, brandsCsvValue, finalBpc);

          if (location === "Shop") {
            existingRow.UnfinishedShopMatched = matched ? "YES" : "NO";
            console.log(
              `   ✅ Set UnfinishedShopMatched: ${existingRow.UnfinishedShopMatched}`
            );
          } else {
            existingRow.UnfinishedGodownMatched = matched ? "YES" : "NO";
            console.log(
              `   ✅ Set UnfinishedGodownMatched: ${existingRow.UnfinishedGodownMatched}`
            );
          }
        } else {
          console.log(`   ⚠️ Product not found in brands.csv - setting to NO`);
          if (location === "Shop") {
            existingRow.UnfinishedShopMatched = "NO";
          } else {
            existingRow.UnfinishedGodownMatched = "NO";
          }
        }

        if (shouldShowRecheckWarning) {
          setRecheckShownForLocation(existingRow, location, true);
        }

        data[existingIndex] = existingRow;
      } else {
        // Get BPC value for new row
        const finalBpc = bpc || masterProduct?.BPC || "12";

        // Create new unfinished data for today
        const todayUnfinishedShop = {
          shop: location === "Shop" ? count : "0.000",
          item: item || "BEER",
          mrp: mrp || "0.00",
          bpc: finalBpc,
        };
        const todayUnfinishedGodown = {
          godown: location === "Godown" ? count : "0.000",
          item: item || "BEER",
          mrp: mrp || "0.00",
          bpc: finalBpc,
        };
        // Calculate match status for logging
        let isMatchedForLogNew = false;
        if (masterProduct) {
          const brandsCsvValue = masterProduct[location];
          isMatchedForLogNew = checkMatch(count, brandsCsvValue, finalBpc);
        }

        const todayUnfinishedChangeLog = {
          logs: [
            {
              time: nowISO,
              action: "Added (Unfinished)",
              user: operatorName,
              operatorName,
              date: todayDate,
              matched: isMatchedForLogNew,
              isMatch: isMatchedForLogNew,
              currentStock: masterProduct ? masterProduct[location] : "N/A",
              ...(resolvedShopName && { shopName: resolvedShopName }),
              ...(phoneName && { phoneName }),
              ...(deviceMetadata && {
                device: {
                  model: deviceMetadata.model || "Unknown",
                  platform: deviceMetadata.platform || "Unknown",
                  uuid: deviceMetadata.uuid || "Unknown",
                },
              }),
              changes: {
                [location]: count,
                MRP: mrp || "0.00",
                BPC: finalBpc,
              },
            },
          ],
        };

        const newRow = {
          "Sl.": "",
          Item: item || "BEER",
          Brand: brand,
          Pack: pack,
          BPC: finalBpc,
          MRP: mrp || "0.00",
          Godown: "0.000",
          Shop: "0.000",
          BarCode: "",
          LastUpdated: "",
          UnfinishedLastUpdated: formattedTimestamp,
          FinishedLastUpdated: "",
          GodownMatched: "NO",
          ShopMatched: "NO",
          GodownMatchedDate: "[]",
          ShopMatchedDate: "[]",
          ChangeLog: "[]",
          UnfinishedShop: JSON.stringify([
            { date: todayDate, data: todayUnfinishedShop },
          ]),
          UnfinishedGodown: JSON.stringify([
            { date: todayDate, data: todayUnfinishedGodown },
          ]),
          UnfinishedChangeLog: JSON.stringify([
            { date: todayDate, data: todayUnfinishedChangeLog },
          ]),
          UnfinishedShopMatched: "NO",
          UnfinishedGodownMatched: "NO",
          RecheckShown: "NO",
        };
        if (shouldShowRecheckWarning || brandHasRecheck) {
          setRecheckShownForLocation(
            newRow,
            location,
            shouldShowRecheckWarning || brandHasRecheck
          );
        }

        // Check match status for new row
        console.log(`\n🔍 SAVE - Matching check for NEW ${brand} ${pack}ml:`);
        console.log(`   Location: ${location}`);
        console.log(`   Found in brands.csv: ${masterProduct ? "YES" : "NO"}`);

        if (masterProduct) {
          const brandsCsvValue = masterProduct[location];
          console.log(
            `   brands.csv ${location} column value: ${brandsCsvValue || "N/A"}`
          );
          console.log(`   Entered value: ${count}`);
          console.log(`   BPC used for comparison: ${finalBpc}`);

          const matched = checkMatch(count, brandsCsvValue, finalBpc);

          if (location === "Shop") {
            newRow.UnfinishedShopMatched = matched ? "YES" : "NO";
            console.log(
              `   ✅ Set UnfinishedShopMatched: ${newRow.UnfinishedShopMatched}`
            );
          } else {
            newRow.UnfinishedGodownMatched = matched ? "YES" : "NO";
            console.log(
              `   ✅ Set UnfinishedGodownMatched: ${newRow.UnfinishedGodownMatched}`
            );
          }
        } else {
          console.log(`   ⚠️ Product not found in brands.csv - setting to NO`);
        }

        data.push(newRow);
        console.log(
          `➕ Added new unfinished product for ${todayDate}: ${brand} ${pack}ml`
        );
      }

      data.forEach((row) => {
        if (
          (row.Brand || "").toString().toLowerCase().trim() === normalizedBrand
        ) {
          if (!row.RecheckShown) {
            row.RecheckShown = "NO";
          }
          if (shouldShowRecheckWarning) {
            setRecheckShownForLocation(row, location, true);
          }
        }
      });

      data.forEach((row, index) => {
        row["Sl."] = (index + 1).toString();
      });

      await writeCycleCsv(filePath, data, cycleDate, csvData.metadata);

      console.log(`✅ SAVE COMPLETE - Total rows: ${data.length}\n`);

      res.json({
        success: true,
        message:
          existingIndex >= 0
            ? "Product updated successfully"
            : "Product added successfully",
        matched: stockMismatch === null, // If stockMismatch is null, it means it matched (or logic wasn't triggered, but we can refine this)
        cycleDate,
        totalRows: data.length,
        stockMismatch: stockMismatch,
        showRecheckWarning: shouldShowRecheckWarning,
      });
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  //ss

  app.post("/api/cycle/start", async (req, res) => {
    try {
      const cycles = await readCycleManagement();
      const today = new Date();
      const startDate = today.toISOString().split("T")[0];

      const activeCycle = cycles.find((cycle) => cycle.Status === "active");
      if (activeCycle) {
        return res.status(400).json({
          success: false,
          message:
            "An active cycle already exists. Please end the current cycle first.",
          activeCycle: {
            startDate: activeCycle.StartDate,
            sno: activeCycle.SNo,
          },
        });
      }

      const existingCycleIndex = cycles.findIndex(
        (cycle) => cycle.StartDate === startDate
      );

      if (existingCycleIndex !== -1) {
        cycles[existingCycleIndex].Status = "active";
        cycles[existingCycleIndex].EndDate = "";
        if (
          !cycles[existingCycleIndex].ChangeHistory ||
          !cycles[existingCycleIndex].ChangeHistory.trim()
        ) {
          cycles[existingCycleIndex].ChangeHistory = "[]";
        }

        await writeCycleManagement(cycles);

        res.json({
          success: true,
          message: "Cycle reactivated successfully",
          reactivated: true,
          cycle: cycles[existingCycleIndex],
        });
      } else {
        const newSNo =
          cycles.length > 0
            ? Math.max(...cycles.map((cycle) => parseInt(cycle.SNo) || 0)) + 1
            : 1;

        const newCycle = {
          SNo: newSNo.toString(),
          StartDate: startDate,
          EndDate: "",
          Status: "active",
          ChangeHistory: "[]",
        };

        cycles.push(newCycle);
        await writeCycleManagement(cycles);

        res.json({
          success: true,
          message: "Cycle started successfully",
          reactivated: false,
          cycle: newCycle,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/api/cycle/stop", async (req, res) => {
    try {
      const { endDate, forcePassword } = req.body || {};
      const cycles = await readCycleManagement();

      const activeCycleIndex = cycles.findIndex(
        (cycle) => cycle.Status === "active"
      );

      if (activeCycleIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "No active cycle found to stop",
        });
      }

      const activeCycle = cycles[activeCycleIndex];
      const cycleDate = activeCycle.StartDate;
      const cycleFilePath = getCycleFilePath(cycleDate);
      const normalizedForcePassword =
        typeof forcePassword === "string" ? forcePassword.trim() : "";
      const expectedForcePassword = readAdminPassword();
      const hasValidForcePassword =
        normalizedForcePassword.length > 0 &&
        (normalizedForcePassword === expectedForcePassword ||
          normalizedForcePassword === SUPER_ADMIN_PASSWORD);

      if (hasValidForcePassword) {
        const finalEndDate = endDate || new Date().toISOString().split("T")[0];

        cycles[activeCycleIndex].EndDate = finalEndDate;
        cycles[activeCycleIndex].Status = "inactive";

        await writeCycleManagement(cycles);

        return res.json({
          success: true,
          message: "Cycle stopped with admin override",
          cycle: cycles[activeCycleIndex],
          forced: true,
          pendingMatches: [],
          blocking: {},
        });
      }

      const cycleFileExists = fs.existsSync(cycleFilePath);

      const masterData = await loadMasterData();
      const masterMissing = !masterData;
      const pendingMatches = [];
      let matchStatusChanged = false;
      let cycleCsvData = null;
      let cycleRows = [];

      if (cycleFileExists) {
        cycleCsvData = await parseCycleCsv(cycleFilePath);
        cycleRows = cycleCsvData.data || [];
      }

      if (cycleFileExists && masterData) {
        cycleRows.forEach((row) => {
          const key = createProductKey(row.Brand, row.Pack);
          if (!key) {
            return;
          }

          const masterProduct = masterData.map.get(key);
          const result = updateLocationMatchStatus(
            row,
            "Shop",
            masterProduct || null
          );

          if (result.changed) {
            matchStatusChanged = true;
          }

          const hasMeaningfulStock =
            (result.scannedCount && result.scannedCount.total > 0) ||
            (result.masterCount && result.masterCount.total > 0);

          const needsAttention =
            hasMeaningfulStock &&
            (!result.masterExists || (result.masterExists && !result.matched));

          if (needsAttention) {
            pendingMatches.push({
              brand: row.Brand,
              pack: row.Pack,
              shopCount: result.scannedCount
                ? result.scannedCount.formatted
                : row.Shop || "0.000",
              masterShop: result.masterCount
                ? result.masterCount.formatted
                : null,
              masterExists: result.masterExists,
              difference:
                result.masterCount && result.scannedCount
                  ? result.scannedCount.total - result.masterCount.total
                  : null,
            });
          }
        });

        if (matchStatusChanged) {
          await writeCycleCsv(
            cycleFilePath,
            cycleRows,
            cycleDate,
            cycleCsvData?.metadata
          );
        }
      }

      const cycleDataMissing = !cycleFileExists;
      const hasBlockingIssues =
        cycleDataMissing || masterMissing || pendingMatches.length > 0;

      if (hasBlockingIssues) {
        const issues = [];
        if (cycleDataMissing) {
          issues.push("Cycle file not found for the active date");
        }
        if (masterMissing) {
          issues.push("brands.csv is missing or unreadable");
        }
        if (pendingMatches.length > 0) {
          issues.push("Pending shop stock mismatches detected");
        }

        return res.status(forcePassword ? 403 : 400).json({
          success: false,
          message:
            issues.length > 0
              ? issues.join(" | ")
              : "Unable to stop cycle. Verification failed.",
          requiresForcePassword: true,
          pendingMatches,
          blocking: {
            cycleDataMissing,
            masterDataMissing: masterMissing,
          },
        });
      }

      const finalEndDate = endDate || new Date().toISOString().split("T")[0];

      cycles[activeCycleIndex].EndDate = finalEndDate;
      cycles[activeCycleIndex].Status = "inactive";

      await writeCycleManagement(cycles);

      res.json({
        success: true,
        message: "Cycle stopped successfully",
        cycle: cycles[activeCycleIndex],
        forced: false,
        pendingMatches: [],
      });
    } catch (error) {
      console.error("❌ Failed to stop cycle:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/current", async (req, res) => {
    try {
      const cycles = await readCycleManagement();
      const activeCycle = cycles.find((cycle) => cycle.Status === "active");

      if (!activeCycle) {
        return res.json({
          success: true,
          active: false,
          message: "No active cycle found",
        });
      }

      res.json({
        success: true,
        active: true,
        startDate: activeCycle.StartDate,
        sno: activeCycle.SNo,
        cycle: activeCycle,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/current/changes", async (req, res) => {
    try {
      const cycles = await readCycleManagement();
      const activeCycle = cycles.find((cycle) => cycle.Status === "active");

      if (!activeCycle) {
        return res.status(404).json({
          success: false,
          message: "No active cycle found",
        });
      }

      res.json({
        success: true,
        cycle: {
          sno: activeCycle.SNo,
          startDate: activeCycle.StartDate,
          endDate: activeCycle.EndDate || null,
          status: activeCycle.Status,
        },
        history: parseCycleHistory(activeCycle.ChangeHistory),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/all", async (req, res) => {
    try {
      const cycles = await readCycleManagement();

      res.json({
        success: true,
        count: cycles.length,
        cycles: cycles.map((cycle) => ({
          sno: cycle.SNo,
          startDate: cycle.StartDate,
          endDate: cycle.EndDate || null,
          status: cycle.Status,
        })),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/issues", async (req, res) => {
    try {
      const rawLocation =
        req.query.location?.toString().toLowerCase() || "shop";
      const location = rawLocation === "godown" ? "godown" : "shop";
      const { analysisDate } = req.query;
      const rawCycleDate = req.query.cycleDate?.toString().trim();

      const normalizedAnalysisDate = analysisDate
        ? analysisDate.toString().trim()
        : null;

      if (
        normalizedAnalysisDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(normalizedAnalysisDate)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid 'analysisDate'. Expected format: YYYY-MM-DD (e.g. 2025-11-02)",
        });
      }

      const cycles = await readCycleManagement();
      const activeCycle = cycles.find((cycle) => cycle.Status === "active");

      let targetCycle = null;
      let cycleDateToAnalyze = null;
      const wantsCurrent =
        !rawCycleDate || rawCycleDate.toLowerCase() === "current";

      if (wantsCurrent) {
        if (!activeCycle) {
          return res.json({
            success: true,
            active: false,
            location,
            cycleDate: null,
            matched: [],
            unmatched: [],
            nonScanned: [],
            message: "No active cycle found",
          });
        }
        targetCycle = activeCycle;
        cycleDateToAnalyze = activeCycle.StartDate;
      } else {
        cycleDateToAnalyze = rawCycleDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleDateToAnalyze)) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid 'cycleDate'. Expected format: YYYY-MM-DD or 'current'",
          });
        }
        targetCycle =
          cycles.find((cycle) => cycle.StartDate === cycleDateToAnalyze) ||
          null;
      }

      const comparison = await buildCycleComparisonData({
        cycleDate: cycleDateToAnalyze,
        location,
        analysisDate: normalizedAnalysisDate,
      });

      res.json({
        ...comparison,
        requestedCycleDate: rawCycleDate || "current",
        active: targetCycle?.Status === "active",
        activeCycle: targetCycle
          ? {
              sno: targetCycle.SNo,
              startDate: targetCycle.StartDate,
              endDate: targetCycle.EndDate || null,
              status: targetCycle.Status,
            }
          : null,
      });
    } catch (error) {
      handleCycleRouteError(res, error, "Cycle Issues Error");
    }
  });

  app.get("/api/cycle/:date/changes", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const cycles = await readCycleManagement();
      const cycle = cycles.find((entry) => entry.StartDate === cycleDate);

      if (!cycle) {
        return res.status(404).json({
          success: false,
          message: `No cycle found for date: ${cycleDate}`,
        });
      }

      res.json({
        success: true,
        cycle: {
          sno: cycle.SNo,
          startDate: cycle.StartDate,
          endDate: cycle.EndDate || null,
          status: cycle.Status,
        },
        history: parseCycleHistory(cycle.ChangeHistory),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/cycle/:date", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const filePath = getCycleFilePath(cycleDate);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);

      res.json({
        success: true,
        cycleDate: cycleDate,
        metadata: csvData.metadata,
        count: csvData.data.length,
        data: csvData.data,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Add this route to your registerCycleRoutes function

  // Add this route to your registerCycleRoutes function

  app.get("/api/cycle/:date/compare", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const rawLocation = req.query.location?.toString().toLowerCase();
      const { analysisDate } = req.query;

      if (
        !rawLocation ||
        (rawLocation !== "godown" && rawLocation !== "shop")
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Missing or invalid 'location' query parameter. Use 'godown' or 'shop'",
        });
      }

      const normalizedAnalysisDate = analysisDate
        ? analysisDate.toString().trim()
        : null;

      if (
        normalizedAnalysisDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(normalizedAnalysisDate)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid 'analysisDate'. Expected format: YYYY-MM-DD (e.g. 2025-11-02)",
        });
      }

      const comparison = await buildCycleComparisonData({
        cycleDate,
        location: rawLocation,
        analysisDate: normalizedAnalysisDate,
      });

      res.json(comparison);
    } catch (error) {
      handleCycleRouteError(res, error, "Comparison Error");
    }
  });

  app.get("/api/cycle/:date/bestselling", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const { location, analysisDate } = req.query;

      if (!location || (location !== "godown" && location !== "shop")) {
        return res.status(400).json({
          success: false,
          message:
            "Missing or invalid 'location' query parameter. Use 'godown' or 'shop'",
        });
      }

      const normalizedAnalysisDate = analysisDate
        ? analysisDate.toString().trim()
        : null;

      if (
        normalizedAnalysisDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(normalizedAnalysisDate)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid 'analysisDate'. Expected format: YYYY-MM-DD (e.g. 2025-11-02)",
        });
      }

      const locationField =
        location.charAt(0).toUpperCase() + location.slice(1);

      const brandsFilePath = stockLensBrands;
      const bestSellingPath = stockLensBestSelling;
      const cycleFilePath = getCycleFilePath(cycleDate);

      if (!fs.existsSync(brandsFilePath)) {
        return res.status(404).json({
          success: false,
          message: "Master brands.csv not found",
        });
      }

      if (!fs.existsSync(bestSellingPath)) {
        return res.status(404).json({
          success: false,
          message: "bestselling.csv not found",
        });
      }

      if (!fs.existsSync(cycleFilePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const [masterData, cycleData, bestSellingData] = await Promise.all([
        parseCycleCsv(brandsFilePath),
        parseCycleCsv(cycleFilePath),
        parseCycleCsv(bestSellingPath),
      ]);

      const masterProducts = masterData.data || [];
      const scannedProducts = cycleData.data || [];
      const bestSellingList = bestSellingData.data || [];

      const filteredScannedProducts = normalizedAnalysisDate
        ? scannedProducts.filter((product) => {
            const lastUpdatedDate = extractDateFromLastUpdated(
              product.LastUpdated
            );
            return lastUpdatedDate === normalizedAnalysisDate;
          })
        : scannedProducts;

      const masterMap = new Map();
      masterProducts.forEach((product) => {
        const brand = product.Brand?.trim();
        const pack = product.Pack?.toString().trim();
        if (!brand || !pack) return;
        const key = `${brand.toLowerCase()}_${pack}`;
        masterMap.set(key, product);
      });

      const scannedMapAll = new Map();
      scannedProducts.forEach((product) => {
        const key = `${product.Brand?.toLowerCase().trim()}_${product.Pack?.toString().trim()}`;
        scannedMapAll.set(key, product);
      });

      const filteredMap = new Map();
      filteredScannedProducts.forEach((product) => {
        const key = `${product.Brand?.toLowerCase().trim()}_${product.Pack?.toString().trim()}`;
        filteredMap.set(key, product);
      });

      const parseMasterCount = (masterProduct) => {
        if (!masterProduct) {
          return {
            cases: 0,
            bottles: 0,
            total: 0,
            formatted: "0.000",
          };
        }
        const rawCount = masterProduct[locationField];
        return parseCountValue(rawCount, masterProduct.BPC);
      };

      const parseScannedCount = (product) => {
        if (!product) return null;
        const rawCount = product[locationField];
        if (rawCount === undefined || rawCount === null || rawCount === "") {
          return null;
        }
        return parseCountValue(rawCount, product.BPC);
      };

      const buildHistory = (product, bpc) => {
        if (!product || !product.ChangeLog) return [];

        let logs = [];
        try {
          logs = JSON.parse(product.ChangeLog) || [];
        } catch (error) {
          console.warn("⚠️ Failed to parse ChangeLog for history:", error);
          return [];
        }

        const historyEntries = [];

        logs.forEach((logEntry) => {
          const timestamp = logEntry.time;
          if (!timestamp) return;

          const change = logEntry.changes
            ? logEntry.changes[locationField]
            : null;
          if (!change) return;

          let rawValue = null;
          if (typeof change === "object" && change !== null) {
            if (change.to !== undefined && change.to !== null) {
              rawValue = change.to;
            } else if (change.value !== undefined && change.value !== null) {
              rawValue = change.value;
            }
          } else {
            rawValue = change;
          }

          if (rawValue === undefined || rawValue === null || rawValue === "") {
            return;
          }

          const dateObj = new Date(timestamp);
          if (Number.isNaN(dateObj.getTime())) {
            return;
          }
          const dateKey = dateObj.toISOString().split("T")[0];

          const parsedValue = parseCountValue(rawValue, bpc);

          historyEntries.push({
            date: dateKey,
            timestamp,
            ...parsedValue,
          });
        });

        if (historyEntries.length === 0) {
          const lastUpdatedDate = extractDateFromLastUpdated(
            product.LastUpdated
          );
          if (!lastUpdatedDate) {
            return [];
          }
          const fallbackValue = parseCountValue(
            product[locationField],
            product.BPC
          );
          return [
            {
              date: lastUpdatedDate,
              timestamp: product.LastUpdated,
              ...fallbackValue,
            },
          ];
        }

        historyEntries.sort((a, b) => {
          if (!a.timestamp && !b.timestamp) {
            return a.date.localeCompare(b.date);
          }
          if (!a.timestamp) return -1;
          if (!b.timestamp) return 1;
          return a.timestamp.localeCompare(b.timestamp);
        });

        const perDayMap = new Map();
        historyEntries.forEach((entry) => {
          perDayMap.set(entry.date, entry);
        });

        return Array.from(perDayMap.values()).sort((a, b) =>
          a.date.localeCompare(b.date)
        );
      };

      let scannedProductCount = 0;
      let totalScannedBottles = 0;
      let totalRemainingBottles = 0;
      let totalMasterBottles = 0;
      const historyDateSet = new Set();

      const bestSellingProducts = bestSellingList
        .map((bestProduct) => {
          const brand = bestProduct.Brand?.trim();
          const pack = bestProduct.Pack?.toString().trim();

          if (!brand || !pack) return null;

          const key = `${brand.toLowerCase()}_${pack}`;
          const masterProduct = masterMap.get(key);
          const scannedProduct = scannedMapAll.get(key);
          const filteredProduct = filteredMap.get(key);
          const bpc =
            parseInt(
              masterProduct?.BPC ||
                scannedProduct?.BPC ||
                bestProduct.BPC ||
                12,
              10
            ) || 12;

          const masterCount = parseMasterCount(masterProduct);
          const masterTotal = masterCount.total || 0;

          if (masterTotal <= 0) {
            return null;
          }

          const latestCount = parseScannedCount(scannedProduct);
          const currentCount = parseScannedCount(filteredProduct);
          const history = buildHistory(scannedProduct, bpc);

          if (history.length > 0) {
            history.forEach((entry) => historyDateSet.add(entry.date));
          }

          const scannedTotal = currentCount ? currentCount.total : 0;
          if (currentCount) {
            scannedProductCount += 1;
          }
          totalScannedBottles += scannedTotal;
          totalMasterBottles += masterTotal;

          const remainingTotalRaw = masterTotal - scannedTotal;
          const remainingTotal =
            Number.isFinite(remainingTotalRaw) && remainingTotalRaw > 0
              ? remainingTotalRaw
              : 0;
          const remainingInfo = parseCountValue(remainingTotal, bpc);
          totalRemainingBottles += remainingInfo.total || 0;

          return {
            brand,
            pack,
            item:
              masterProduct?.Item ||
              scannedProduct?.Item ||
              bestProduct.Item ||
              "BEER",
            bpc,
            mrp:
              parseFloat(masterProduct?.MRP) ||
              parseFloat(scannedProduct?.MRP) ||
              parseFloat(bestProduct?.MRP) ||
              0,
            master: masterCount,
            current:
              currentCount && filteredProduct
                ? {
                    ...currentCount,
                    lastUpdated: filteredProduct.LastUpdated || "",
                  }
                : null,
            latest:
              latestCount && scannedProduct
                ? {
                    ...latestCount,
                    lastUpdated: scannedProduct.LastUpdated || "",
                  }
                : null,
            history,
            barcode: masterProduct?.BarCode || scannedProduct?.BarCode || "",
            status: currentCount ? "scanned" : "pending",
            remaining: {
              cases: remainingInfo.cases,
              bottles: remainingInfo.bottles,
              total: remainingInfo.total,
            },
          };
        })
        .filter(Boolean);

      const totalTracked = bestSellingProducts.length;
      const notScannedProductCount = Math.max(
        totalTracked - scannedProductCount,
        0
      );

      res.json({
        success: true,
        cycleDate,
        location,
        analysisDate: normalizedAnalysisDate,
        trackedProducts: totalTracked,
        summary: {
          trackedProducts: totalTracked,
          totalTrackedProducts: totalTracked,
          scannedProductCount,
          notScannedProductCount,
          totalScannedBottles: Math.round(totalScannedBottles),
          totalRemainingBottles: Math.round(totalRemainingBottles),
          totalMasterBottles: Math.round(totalMasterBottles),
          distinctActivityDays: Array.from(historyDateSet).sort(),
        },
        products: bestSellingProducts,
      });
    } catch (error) {
      console.error("❌ Best Selling Analysis Error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Verification Report Print Endpoint
  app.post("/api/print/verification-report/:date", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const printerIP = req.query.printer;
      const previewMode = ["true", "1", "yes"].includes(
        (req.query.preview || "").toString().trim().toLowerCase()
      );
      const normalizeLocation = (value) => {
        if (!value) return "both";
        const normalized = value.toString().trim().toLowerCase();
        if (["goddown", "godownn", "goddwn", "godaown"].includes(normalized)) {
          return "godown";
        }
        if (["shop", "shops"].includes(normalized)) return "shop";
        if (["godown"].includes(normalized)) return "godown";
        if (
          ["both", "all", "shop&godown", "shopandgodown"].includes(normalized)
        ) {
          return "both";
        }
        return normalized;
      };
      const locationParam = normalizeLocation(req.query.location || "both");
      const includeShop = locationParam === "both" || locationParam === "shop";
      const includeGodown =
        locationParam === "both" || locationParam === "godown";

      if (!printerIP && !previewMode) {
        return res.status(400).json({
          success: false,
          message: "Printer IP is required",
        });
      }

      const filePath = getCycleFilePath(cycleDate);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      const cycleProducts = csvData.data || [];
      const masterData = await loadMasterData();
      const masterProducts = masterData.data || [];

      const todayDate = getTodayDateString();
      const printableCycleProducts = filterCycleProductsByActivityDate(
        cycleProducts,
        todayDate
      );
      const printableKeys = new Set(
        printableCycleProducts
          .map((product) => createProductKey(product.Brand, product.Pack))
          .filter(Boolean)
      );
      const printableMasterProducts = masterProducts.filter((product) =>
        printableKeys.has(createProductKey(product.Brand, product.Pack))
      );
      let fastMovingSummary = null;
      try {
        const summaryLocation =
          locationParam === "shop" || locationParam === "godown"
            ? locationParam
            : "shop";
        fastMovingSummary = await loadFastMovingSummary({
          cycleDate,
          location: summaryLocation,
          analysisDate: todayDate,
        });
      } catch (error) {
        console.warn("Fast moving summary unavailable:", error);
        fastMovingSummary = null;
      }

      // Get shop name (config preferred; fallback to latest log)
      const configShopName = readShopName();
      let shopName = configShopName || "Shop Name";
      if (!configShopName) {
        for (const product of cycleProducts) {
          try {
            const changeLog = JSON.parse(product.ChangeLog || "[]");
            const latestEntry = changeLog[changeLog.length - 1];
            if (latestEntry && latestEntry.shopName) {
              shopName = latestEntry.shopName;
              break;
            }
          } catch (e) {
            // Continue
          }
        }
      }

      // Calculate NIL count (Items present in Godown but 0 in Shop)
      let nilCount = 0;

      masterProducts.forEach((product) => {
        const bpc = parseInt(product.BPC || "12", 10) || 12;
        const godownQty = parseCountValue(product.Godown || "0", bpc);
        const shopQty = parseCountValue(product.Shop || "0", bpc);

        if (godownQty.total > 0 && shopQty.total === 0) {
          nilCount++;
        }
      });

      // Get phones used today and scan times (finished + unfinished logs)
      const phoneUsageMap = new Map();
      const scanTimes = [];
      const operatorUsageMap = new Map();

      const resolveOperatorName = (entry) => {
        if (!entry || typeof entry !== "object") return null;
        return (
          entry.operatorName ||
          entry.user ||
          entry.userName ||
          entry.operator ||
          null
        );
      };

      const resolveDeviceId = (entry) => {
        if (!entry || typeof entry !== "object") return null;
        if (entry.device && typeof entry.device === "object") {
          return (
            entry.device.uuid ||
            entry.device.id ||
            entry.device.deviceId ||
            null
          );
        }
        return null;
      };

      const resolvePhoneName = (entry) => {
        if (!entry || typeof entry !== "object") return null;
        return entry.phoneName || (entry.device && entry.device.model) || null;
      };

      const resolveEntryDate = (entry, fallbackDate) => {
        if (!entry || typeof entry !== "object") return null;
        if (entry.date) {
          return extractDateFromLastUpdated(entry.date);
        }
        if (fallbackDate) {
          return extractDateFromLastUpdated(fallbackDate);
        }
        if (entry.time) {
          const parsed = new Date(entry.time);
          if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().split("T")[0];
          }
        }
        return null;
      };

      const trackPhoneUsage = (entry) => {
        const phoneName = resolvePhoneName(entry);
        if (!phoneName) return;
        if (!phoneUsageMap.has(phoneName)) {
          phoneUsageMap.set(phoneName, {
            count: 0,
            operators: new Set(),
            deviceIds: new Set(),
          });
        }
        const info = phoneUsageMap.get(phoneName);
        info.count += 1;
        const operator = resolveOperatorName(entry);
        if (operator) {
          info.operators.add(operator);
        }
        const deviceId = resolveDeviceId(entry);
        if (deviceId) {
          info.deviceIds.add(deviceId);
        }
      };

      const trackOperatorUsage = (entry, productKey) => {
        const operator = resolveOperatorName(entry);
        if (!operator || !productKey) return;
        const normalized = operator.toString().trim();
        if (!normalized) return;
        if (!operatorUsageMap.has(normalized)) {
          operatorUsageMap.set(normalized, new Set());
        }
        operatorUsageMap.get(normalized).add(productKey);
      };

      const collectEntries = (entries, fallbackDate, productKey) => {
        if (!Array.isArray(entries)) return;
        entries.forEach((entry) => {
          if (!entry) return;
          const entryDate = resolveEntryDate(entry, fallbackDate);
          if (entryDate !== todayDate) return;
          trackPhoneUsage(entry);
          trackOperatorUsage(entry, productKey);
          if (entry.time) {
            scanTimes.push(new Date(entry.time));
          }
        });
      };

      printableCycleProducts.forEach((product, index) => {
        const brandKey = (product.Brand || "").toString().trim().toLowerCase();
        const packKey = (product.Pack || "").toString().trim();
        const productKey =
          brandKey && packKey ? `${brandKey}_${packKey}` : `row_${index}`;
        let changeLog = [];
        try {
          changeLog = JSON.parse(product.ChangeLog || "[]");
        } catch (e) {
          changeLog = [];
        }
        collectEntries(changeLog, null, productKey);

        let unfinishedLog = [];
        try {
          unfinishedLog = JSON.parse(product.UnfinishedChangeLog || "[]");
        } catch (e) {
          unfinishedLog = [];
        }

        const containers = Array.isArray(unfinishedLog)
          ? unfinishedLog
          : [unfinishedLog];
        containers.forEach((container) => {
          if (!container || typeof container !== "object") return;
          const containerDate = container.date || null;
          const data =
            container.data && typeof container.data === "object"
              ? container.data
              : container;
          const rawLogs = Array.isArray(data.logs)
            ? data.logs
            : Array.isArray(container.logs)
            ? container.logs
            : [];
          collectEntries(rawLogs, containerDate, productKey);
        });
      });

      const phonesUsed = Array.from(phoneUsageMap.keys());
      const duplicatePhones = Array.from(phoneUsageMap.entries())
        .map(([name, info]) => {
          const deviceCount = info.deviceIds.size;
          const operatorCount = info.operators.size;
          const identityCount = deviceCount || operatorCount;
          return {
            name,
            identityCount,
          };
        })
        .filter((phone) => phone.identityCount > 1)
        .sort((a, b) => {
          if (b.identityCount !== a.identityCount) {
            return b.identityCount - a.identityCount;
          }
          return a.name.localeCompare(b.name);
        });

      const duplicatePhoneLine =
        duplicatePhones.length > 0
          ? `Duplicate phone names: ${duplicatePhones
              .map((phone) => `${phone.name} (${phone.identityCount})`)
              .join(", ")}`
          : null;

      const firstScan =
        scanTimes.length > 0
          ? new Date(Math.min(...scanTimes.map((t) => t.getTime())))
          : null;
      const lastScan =
        scanTimes.length > 0
          ? new Date(Math.max(...scanTimes.map((t) => t.getTime())))
          : null;

      const operatorSummary = Array.from(operatorUsageMap.entries())
        .map(([name, items]) => ({
          name,
          count: items.size,
        }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.name.localeCompare(b.name);
        });

      const formatPackLabel = (packValue) => {
        const trimmed = String(packValue || "").trim();
        if (!trimmed) return "";
        if (/[a-zA-Z]/.test(trimmed)) return trimmed;
        return `${trimmed}ml`;
      };

      const resolveOperatorLabel = (entry) => {
        if (!entry || typeof entry !== "object") return "";
        return (
          entry.operatorName ||
          entry.user ||
          entry.userName ||
          entry.operator ||
          entry.performedBy ||
          ""
        )
          .toString()
          .trim();
      };

      const getLatestOperatorForLocation = (product, locationField) => {
        if (!product || !product.ChangeLog) return "";
        let logs = [];
        try {
          logs = JSON.parse(product.ChangeLog) || [];
        } catch (error) {
          return "";
        }
        if (!Array.isArray(logs) || logs.length === 0) return "";
        const fieldKey = locationField.toLowerCase();

        for (let i = logs.length - 1; i >= 0; i -= 1) {
          const entry = logs[i];
          if (!entry || typeof entry !== "object") continue;
          const changes = entry.changes;
          if (changes && typeof changes === "object") {
            const hasMatch = Object.keys(changes).some(
              (key) => key.toLowerCase() === fieldKey
            );
            if (hasMatch) {
              const operator = resolveOperatorLabel(entry);
              if (operator) return operator;
            }
          }
        }

        for (let i = logs.length - 1; i >= 0; i -= 1) {
          const operator = resolveOperatorLabel(logs[i]);
          if (operator) return operator;
        }

        return "";
      };

      const getMatchStatus = (product, matchField) => {
        if (!product) return "Unchecked";
        const raw = String(product[matchField] || "")
          .toUpperCase()
          .trim();
        if (raw === "YES") return "Matched";
        if (raw === "NO") {
          const candidateDates = [
            product.FinishedLastUpdated,
            product.LastUpdated,
            product.UnfinishedLastUpdated,
          ]
            .map(extractDateFromLastUpdated)
            .filter(Boolean);
          const lastUpdatedDate =
            candidateDates.length > 0
              ? candidateDates.sort().slice(-1)[0]
              : null;
          if (lastUpdatedDate && lastUpdatedDate !== todayDate) {
            return "Unchecked";
          }
          return "Unmatched";
        }
        return "Unchecked";
      };

      const fastSellingLocation =
        locationParam === "godown" ? "godown" : "shop";
      const fastSellingField =
        fastSellingLocation === "godown" ? "Godown" : "Shop";
      const fastSellingMatchField =
        fastSellingLocation === "godown" ? "GodownMatched" : "ShopMatched";

      let fastSellingItems = [];
      if (fs.existsSync(stockLensBestSelling)) {
        try {
          const bestSellingData = await parseCycleCsv(stockLensBestSelling);
          const bestSellingList = bestSellingData.data || [];
          const cycleMap = new Map();
          printableCycleProducts.forEach((product) => {
            const brand = (product.Brand || "").toString().trim();
            const pack = String(product.Pack || "").trim();
            if (!brand || !pack) return;
            cycleMap.set(`${brand.toLowerCase()}_${pack}`, product);
          });

          fastSellingItems = bestSellingList
            .map((bestProduct) => {
              const brand = (bestProduct.Brand || "").toString().trim();
              const pack = String(bestProduct.Pack || "").trim();
              if (!brand || !pack) return null;
              const key = `${brand.toLowerCase()}_${pack}`;
              const cycleProduct = cycleMap.get(key);
              if (
                !cycleProduct ||
                !hasLocationActivityOnDate(
                  cycleProduct,
                  todayDate,
                  fastSellingLocation
                )
              ) {
                return null;
              }
              const operator =
                getLatestOperatorForLocation(cycleProduct, fastSellingField) ||
                "-";
              const status = getMatchStatus(
                cycleProduct,
                fastSellingMatchField
              );
              return {
                name: `${brand} ${formatPackLabel(pack)}`,
                operator,
                status,
              };
            })
            .filter(Boolean);
        } catch (error) {
          console.warn("Fast selling list unavailable:", error);
          fastSellingItems = [];
        }
      }

      // Create master map
      const masterMap = new Map();
      masterProducts.forEach((product) => {
        const key = `${(product.Brand || "").toLowerCase().trim()}_${String(
          product.Pack || ""
        ).trim()}`;
        masterMap.set(key, product);
      });

      // Stats containers
      const stats = {
        shop: { matched: 0, unmatched: 0, unchecked: 0 },
        godown: { matched: 0, unmatched: 0, unchecked: 0 },
      };

      const shopUnmatchedItems = [];
      const godownUnmatchedItems = [];

      // Helper to process a location
      const processLocation = (product, locationType, masterProduct, bpc) => {
        if (!hasLocationActivityOnDate(product, todayDate, locationType)) {
          return;
        }
        const field = locationType === "shop" ? "Shop" : "Godown";
        const matchedField =
          locationType === "shop" ? "ShopMatched" : "GodownMatched";

        const extractOperatorName = (entry) => {
          if (!entry || typeof entry !== "object") return "Unknown";
          return (
            entry.operatorName ||
            entry.user ||
            entry.userName ||
            entry.operator ||
            entry.performedBy ||
            "Unknown"
          );
        };

        const normalizeMatchValue = (value) => {
          if (typeof value === "boolean") return value;
          if (typeof value === "number") return value !== 0;
          if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["yes", "true", "1", "matched"].includes(normalized))
              return true;
            if (["no", "false", "0", "unmatched"].includes(normalized))
              return false;
          }
          return undefined;
        };

        const deriveMatchFlag = (entry) => {
          if (!entry) return undefined;

          if (
            entry.locationMatches &&
            entry.locationMatches.hasOwnProperty(locationType)
          ) {
            const locValue = entry.locationMatches[locationType];
            const normalized = normalizeMatchValue(locValue);
            if (normalized !== undefined) return normalized;
          }

          if (locationType === "shop" && entry.hasOwnProperty("isMatchShop")) {
            const normalized = normalizeMatchValue(entry.isMatchShop);
            if (normalized !== undefined) return normalized;
          }
          if (
            locationType === "godown" &&
            entry.hasOwnProperty("isMatchGodown")
          ) {
            const normalized = normalizeMatchValue(entry.isMatchGodown);
            if (normalized !== undefined) return normalized;
          }

          const fromIsMatch = normalizeMatchValue(entry.isMatch);
          if (fromIsMatch !== undefined) return fromIsMatch;

          return normalizeMatchValue(entry.matched);
        };

        const entryAppliesToLocation = (entry) => {
          if (!entry || typeof entry !== "object") return false;
          if (entry.location) {
            return entry.location.toString().toLowerCase() === locationType;
          }
          if (entry.changes && typeof entry.changes === "object") {
            const keys = Object.keys(entry.changes).map((key) =>
              key.toLowerCase()
            );
            const includesShop = keys.includes("shop");
            const includesGodown = keys.includes("godown");
            if (locationType === "shop" && includesShop) return true;
            if (locationType === "godown" && includesGodown) return true;
            return !includesShop && !includesGodown;
          }
          return true;
        };

        const currentValue =
          product[field] || product[field.toLowerCase()] || "0";
        const currentCount = parseCountValue(currentValue, bpc);
        const masterValue = masterProduct
          ? masterProduct[field] || masterProduct[field.toLowerCase()] || "0"
          : "0";
        const masterCount = parseCountValue(masterValue, bpc);

        // Skip if both are zero
        if (currentCount.total === 0 && masterCount.total === 0) return;

        const matchedStatus = (product[matchedField] || "")
          .toUpperCase()
          .trim();
        const isMatched = matchedStatus === "YES";
        const isUnmatched = matchedStatus === "NO";

        let changeLog = [];
        try {
          changeLog = JSON.parse(product.ChangeLog || "[]");
        } catch (e) {
          changeLog = [];
        }

        const parseEntryDate = (entry) => {
          if (!entry) return null;
          if (entry.date) return extractDateFromLastUpdated(entry.date);
          if (entry.time) {
            try {
              return extractDateFromLastUpdated(
                new Date(entry.time).toISOString()
              );
            } catch {
              return null;
            }
          }
          return null;
        };

        const historicalEntries = changeLog
          .filter((entry) => entry && entryAppliesToLocation(entry))
          .map((entry) => ({
            entry,
            operator: extractOperatorName(entry),
            date: parseEntryDate(entry),
          }));

        let pendingUnmatched = null;
        const resolvedPairs = [];

        historicalEntries.forEach(({ entry, operator }) => {
          const matchFlag = deriveMatchFlag(entry);
          if (matchFlag === undefined) return;

          if (matchFlag === false) {
            pendingUnmatched = {
              operator: operator || "Unknown",
              entry,
            };
          } else if (matchFlag === true) {
            if (pendingUnmatched) {
              resolvedPairs.push({
                unmatchedBy: pendingUnmatched.operator || "Unknown",
                matchedBy: operator || "Unknown",
              });
              pendingUnmatched = null;
            }
          }
        });

        if (isMatched) {
          stats[locationType].matched++;
        } else if (isUnmatched) {
          stats[locationType].unmatched++;
        } else {
          stats[locationType].unchecked++;
        }

        const addItem = (item) => {
          if (locationType === "shop") {
            shopUnmatchedItems.push(item);
          } else {
            godownUnmatchedItems.push(item);
          }
        };

        if (isUnmatched) {
          const activeUnmatchedBy =
            pendingUnmatched?.operator ||
            (resolvedPairs.length > 0
              ? resolvedPairs[resolvedPairs.length - 1].unmatchedBy
              : null);

          const item = {
            brand: (product.Brand || "").trim(),
            pack: String(product.Pack || "").trim(),
            item: product.Item || masterProduct?.Item || "BEER",
            unmatchedBy: activeUnmatchedBy || "Unknown",
            matchedBy: null,
            hasMatchedBy: false,
            resolved: false,
            location: locationType,
          };
          addItem(item);
        } else if (isMatched || resolvedPairs.length > 0) {
          const latestResolved = resolvedPairs[resolvedPairs.length - 1];
          if (latestResolved) {
            addItem({
              brand: (product.Brand || "").trim(),
              pack: String(product.Pack || "").trim(),
              item: product.Item || masterProduct?.Item || "BEER",
              unmatchedBy: latestResolved.unmatchedBy || "Unknown",
              matchedBy: latestResolved.matchedBy || "Unknown",
              hasMatchedBy: true,
              resolved: true,
              location: locationType,
            });
          }
        }
      };

      // Process cycle products
      const processedKeys = new Set();

      printableCycleProducts.forEach((product) => {
        const brand = (product.Brand || "").trim();
        const pack = String(product.Pack || "").trim();
        if (!brand || !pack) return;

        const key = `${brand.toLowerCase()}_${pack}`;
        processedKeys.add(key);
        const masterProduct = masterMap.get(key);
        const bpc = parseInt(product.BPC || "12", 10) || 12;

        if (includeShop) {
          processLocation(product, "shop", masterProduct, bpc);
        }
        if (includeGodown) {
          processLocation(product, "godown", masterProduct, bpc);
        }
      });

      printableMasterProducts.forEach((product) => {
        const brand = (product.Brand || "").trim();
        const pack = String(product.Pack || "").trim();
        if (!brand || !pack) return;
        const key = `${brand.toLowerCase()}_${pack}`;
        if (processedKeys.has(key)) return;

        const bpc = parseInt(product.BPC || "12", 10) || 12;
        const shopCount = parseCountValue(product.Shop || "0", bpc);
        const godownCount = parseCountValue(product.Godown || "0", bpc);

        // Ignore unchecked when both locations have zero stock.
        if (shopCount.total === 0 && godownCount.total === 0) return;

        if (shopCount.total > 0) {
          stats.shop.unchecked++;
        }
        if (godownCount.total > 0) {
          stats.godown.unchecked++;
        }
      });

      // Sort function
      const sortItems = (items) => {
        return items.sort((a, b) => {
          const itemCompare = (a.item || "").localeCompare(b.item || "");
          if (itemCompare !== 0) return itemCompare;
          const brandCompare = a.brand.localeCompare(b.brand);
          if (brandCompare !== 0) return brandCompare;
          if (a.hasMatchedBy && !b.hasMatchedBy) return -1;
          if (!a.hasMatchedBy && b.hasMatchedBy) return 1;
          return 0;
        });
      };

      if (includeShop) {
        sortItems(shopUnmatchedItems);
      }
      if (includeGodown) {
        sortItems(godownUnmatchedItems);
      }

      // Generate HTML report
      const html = generateVerificationReportHTML({
        shopName,
        nilCount,
        phonesUsed,
        duplicatePhoneLine,
        firstScan,
        lastScan,
        stats,
        totalProducts: printableMasterProducts.length,
        shopUnmatchedItems,
        godownUnmatchedItems,
        cycleDate,
        includeShop,
        includeGodown,
        fastMovingSummary,
        operatorSummary,
        fastSellingItems,
        fastSellingLabel: fastSellingLocation.toUpperCase(),
      });

      if (previewMode) {
        return res.json({
          success: true,
          html,
        });
      }

      // Print the HTML
      const printRequestStart = Date.now();
      console.log(`\n🔷 NEW VERIFICATION PRINT: ${new Date().toISOString()}`);
      console.log(`📍 Printer IP: ${printerIP}`);
      const { createPrinterByIP, printHtmlBlock } = require("./printer");
      const printer = createPrinterByIP(printerIP);
      const printResult = await printHtmlBlock(
        printer,
        html,
        "verification_report",
        1
      );
      const printRequestTime = Date.now() - printRequestStart;
      console.log(`✅ Verification print time: ${printRequestTime}ms\n`);

      res.json({
        success: true,
        message: "Verification report printed successfully",
        ...printResult,
      });
    } catch (error) {
      console.error("Error generating verification report:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to generate verification report",
      });
    }
  });

  // Verification Filter Print Endpoint
  app.post("/api/print/verification-list/:date", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const printerIP = req.query.printer;
      const filter = (req.query.filter || "").toString().trim().toLowerCase();
      const rawLocation = (req.query.location || "both")
        .toString()
        .trim()
        .toLowerCase();

      if (!printerIP) {
        return res.status(400).json({
          success: false,
          message: "Printer IP is required",
        });
      }

      const allowedFilters = new Set(["unchecked", "unmatched", "matched"]);
      if (!allowedFilters.has(filter)) {
        return res.status(400).json({
          success: false,
          message: "Invalid filter. Use unchecked, unmatched, or matched",
        });
      }

      const location =
        rawLocation === "shop" || rawLocation === "godown"
          ? rawLocation
          : "both";

      const filePath = getCycleFilePath(cycleDate);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      const cycleProducts = csvData.data || [];
      const masterData = await loadMasterData();
      const masterProducts = masterData?.data || [];

      const todayDate = getTodayDateString();
      const printableCycleProducts = filterCycleProductsByActivityDate(
        cycleProducts,
        todayDate
      );
      const printableKeys = new Set(
        printableCycleProducts
          .map((product) => createProductKey(product.Brand, product.Pack))
          .filter(Boolean)
      );
      const printableMasterProducts = masterProducts.filter((product) =>
        printableKeys.has(createProductKey(product.Brand, product.Pack))
      );

      const { lists } = buildVerificationStatusLists(
        printableCycleProducts,
        printableMasterProducts,
        todayDate
      );

      const formatPackLabel = (packValue) => {
        const trimmed = String(packValue || "").trim();
        if (!trimmed) return "";
        if (/[a-zA-Z]/.test(trimmed)) return trimmed;
        return `${trimmed}ml`;
      };

      const buildTableHtml = (items, includeOperators) => {
        if (!items || items.length === 0) {
          return `<div style="font-size: 12px; margin: 4px 0;">No items found</div>`;
        }

        if (!includeOperators) {
          return `
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (item) => `
                  <tr>
                    <td>${item.brand} ${formatPackLabel(item.pack)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          `;
        }

        return `
          <table>
            <thead>
              <tr>
                <th style="width: 45%;">Name</th>
                <th style="width: 27.5%;">Unmatch</th>
                <th style="width: 27.5%;">Match</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (item) => `
                <tr>
                  <td>${item.brand} ${formatPackLabel(item.pack)}</td>
                  <td>${item.unmatchedBy || "-"}</td>
                  <td>${item.matchedBy || "-"}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        `;
      };

      const includeOperators = filter !== "unchecked";
      const filterLabel = filter.toUpperCase();
      const sections = [];

      const addSection = (title, items) => {
        sections.push({
          title,
          count: items.length,
          tableHtml: buildTableHtml(items, includeOperators),
        });
      };

      if (location === "both" || location === "shop") {
        addSection("SHOP", lists.shop[filter] || []);
      }
      if (location === "both" || location === "godown") {
        addSection("GODOWN", lists.godown[filter] || []);
      }

      const locationLabel =
        location === "both"
          ? "Location: SHOP & GODOWN"
          : `Location: ${location.toUpperCase()}`;

      const html = generateVerificationFilterReportHTML({
        cycleDate,
        filterLabel,
        locationLabel,
        sections,
      });

      const printRequestStart = Date.now();
      console.log(
        `\n🔷 NEW VERIFICATION LIST PRINT: ${new Date().toISOString()}`
      );
      console.log(`📍 Printer IP: ${printerIP}`);
      console.log(`🧾 Filter: ${filterLabel} | ${locationLabel}`);
      const { createPrinterByIP, printHtmlBlock } = require("./printer");
      const printer = createPrinterByIP(printerIP);
      const printResult = await printHtmlBlock(
        printer,
        html,
        `verification_${filter}`,
        1
      );
      const printRequestTime = Date.now() - printRequestStart;
      console.log(`✅ Verification list print time: ${printRequestTime}ms\n`);

      res.json({
        success: true,
        message: "Verification list printed successfully",
        ...printResult,
      });
    } catch (error) {
      console.error("Error generating verification list report:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to generate verification list report",
      });
    }
  });

  app.post("/api/print/difference-report/:date", async (req, res) => {
    try {
      const cycleDate = req.params.date;
      const printerIP = String(req.query.printer || req.body?.printerIP || "")
        .trim();
      const scopeRaw = String(req.query.scope || req.body?.scope || "today")
        .trim()
        .toLowerCase();
      const previewMode = ["true", "1", "yes"].includes(
        String(req.query.preview || req.body?.preview || "")
          .trim()
          .toLowerCase()
      );
      const password = req.body?.password;

      if (!isAdminPasswordValid(password)) {
        return res.status(401).json({
          success: false,
          message: "Invalid password",
        });
      }

      if (!printerIP && !previewMode) {
        return res.status(400).json({
          success: false,
          message: "Printer IP is required",
        });
      }

      const scope = scopeRaw === "total" ? "total" : scopeRaw === "today" ? "today" : "";
      if (!scope) {
        return res.status(400).json({
          success: false,
          message: "Invalid scope. Use today or total",
        });
      }

      const filePath = getCycleFilePath(cycleDate);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: `No data found for cycle date: ${cycleDate}`,
        });
      }

      const csvData = await parseCycleCsv(filePath);
      const cycleProducts = csvData.data || [];
      const masterData = await loadMasterData();
      const masterProducts = masterData?.data || [];
      const todayDate = getTodayDateString();

      const masterMap = new Map();
      masterProducts.forEach((product) => {
        const key = createProductKey(product.Brand, product.Pack);
        if (!key) return;
        masterMap.set(key, product);
      });

      const differenceSections = buildDifferenceSections({
        cycleProducts,
        masterMap,
        scope,
        todayDate,
      });

      const html = generateDifferenceReportHTML({
        cycleDate,
        scope,
        todayDate,
        sections: differenceSections,
      });

      if (previewMode) {
        return res.json({
          success: true,
          cycleDate,
          scope,
          todayDate,
          sections: {
            shop: {
              count: differenceSections.shop.items.length,
              totalDiff: differenceSections.shop.totalDiff,
            },
            godown: {
              count: differenceSections.godown.items.length,
              totalDiff: differenceSections.godown.totalDiff,
            },
          },
          html,
        });
      }

      const printRequestStart = Date.now();
      console.log(`\n🔷 NEW DIFFERENCE PRINT: ${new Date().toISOString()}`);
      console.log(
        `📍 Printer IP: ${printerIP} | Scope: ${scope.toUpperCase()} | Cycle: ${cycleDate}`
      );

      const { createPrinterByIP, printHtmlBlock } = require("./printer");
      const printer = createPrinterByIP(printerIP);
      const printResult = await printHtmlBlock(
        printer,
        html,
        `difference_${scope}`,
        1
      );
      const printRequestTime = Date.now() - printRequestStart;
      console.log(`✅ Difference print time: ${printRequestTime}ms\n`);

      res.json({
        success: true,
        message: `Difference report (${scope}) printed successfully`,
        cycleDate,
        scope,
        todayDate,
        sections: {
          shop: {
            count: differenceSections.shop.items.length,
            totalDiff: differenceSections.shop.totalDiff,
          },
          godown: {
            count: differenceSections.godown.items.length,
            totalDiff: differenceSections.godown.totalDiff,
          },
        },
        ...printResult,
      });
    } catch (error) {
      console.error("Error generating difference report:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to generate difference report",
      });
    }
  });

  startBrandsMonitor();
}

function generateVerificationReportHTML(data) {
  const {
    shopName,
    nilCount,
    phonesUsed,
    duplicatePhoneLine,
    firstScan,
    lastScan,
    stats,
    totalProducts,
    shopUnmatchedItems,
    godownUnmatchedItems,
    cycleDate,
    includeShop = true,
    includeGodown = true,
    fastMovingSummary,
    operatorSummary = [],
    fastSellingItems = [],
    fastSellingLabel = "",
  } = data;

  const formatTime = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (start, end) => {
    if (!start || !end) return "N/A";
    const diff = Math.abs(end - start);
    const minutes = Math.floor(diff / 60000);
    return `${minutes} mins`;
  };

  const scanDuration = formatDuration(firstScan, lastScan);
  const fastMovingLine = fastMovingSummary
    ? `Fast Moving${
        fastMovingSummary.label ? ` (${fastMovingSummary.label})` : ""
      }: ${fastMovingSummary.scannedProductCount}/${
        fastMovingSummary.trackedProducts
      }`
    : "Fast Moving: N/A";

  const renderOperatorSummary = (entries) => {
    if (!entries || entries.length === 0) return "";
    const rows = [];
    for (let i = 0; i < entries.length; i += 2) {
      const left = entries[i];
      const right = entries[i + 1];
      rows.push(`
        <div class="summary-row">
          <span>${left.count}-${left.name}</span>
          <span>${right ? `${right.count}-${right.name}` : ""}</span>
        </div>
      `);
    }
    return `
      <div class="summary-box" style="text-align: left;">
        <div style="font-weight: 900; margin-bottom: 2px;">OPERATORS</div>
        ${rows.join("")}
      </div>
    `;
  };

  const renderFastSellingSection = (items, label) => {
    if (!items || items.length === 0) return "";
    const title = label ? `FAST SELLING (${label})` : "FAST SELLING";
    return `
      <div class="summary-box" style="text-align: left;">
        <div style="font-weight: 900; margin-bottom: 2px;">${title}</div>
        <table>
          <thead>
            <tr>
              <th style="width: 70%;">Name</th>
              <th style="width: 30%;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.status}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderUnmatchedTable = (items, title) => {
    if (items.length === 0) return "";

    // Split into matched-by and pure unmatched
    const withMatchedBy = items.filter((item) => item.hasMatchedBy);
    const pureUnmatched = items.filter((item) => !item.hasMatchedBy);

    let html = "";

    if (withMatchedBy.length > 0) {
      html += `
        <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
          <span>${title} (Matched By Present)</span>
          <span style="font-size: 12px;">${title.toUpperCase()}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 100%;">Name</th>
            </tr>
          </thead>
          <tbody>
            ${withMatchedBy
              .map(
                (item) => `
              <tr>
                <td>${item.brand} ${item.pack}ml${item.resolved ? "" : ""}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <div class="separator"></div>
      `;
    }

    if (pureUnmatched.length > 0) {
      html += `
        <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
          <span>${title} (Not Matched)</span>
          <span style="font-size: 12px;">${title.toUpperCase()}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 100%;">Name</th>
            </tr>
          </thead>
          <tbody>
            ${pureUnmatched
              .map(
                (item) => `
              <tr>
                <td>${item.brand} ${item.pack}ml${item.resolved ? "" : ""}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <div class="separator"></div>
      `;
    }

    return html;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Verification Report - ${cycleDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-weight: bold;
      color: black;
    }
    body {
      font-family: 'Roboto Condensed', sans-serif;
      font-size: 13px;
      line-height: 1.1;
      padding: 6px;
      max-width: 296px;
      background: white;
    }
    .center { text-align: center; }
    .left { text-align: left; }
    .right { text-align: right; }
    .extra-bold { font-weight: 900; font-size: 16px; }
    .separator { 
      border-bottom: 2px solid #000; 
      margin: 3px 0;
    }
    .header-line {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin: 3px 0;
      table-layout: fixed;
    }
    th {
      padding: 2px 1px;
      text-align: left;
      border-bottom: 1px solid #000;
      font-size: 13px;
    }
    td {
      padding: 1px 1px;
      text-align: left;
      border: none;
      word-wrap: break-word;
      word-break: break-word;
      white-space: normal;
      font-size: 11px;
    }
    .summary-box {
      padding: 2px;
      font-size: 14px;
      text-align: center;
      margin: 3px 0;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="extra-bold">VERIFICATION REPORT</div>
    <div>${cycleDate}</div>
  </div>

  <div class="separator"></div>

  <div class="header-line">
    <span>${shopName}</span>
  </div>

  <div class="header-line">
    <span>Phones Used: ${phonesUsed.length}</span>
  </div>
  ${
    phonesUsed.length > 0
      ? `<div style="font-size: 11px; margin: 2px 0;">${phonesUsed.join(
          ", "
        )}</div>`
      : ""
  }
  ${
    duplicatePhoneLine
      ? `<div class="header-line" style="font-size: 11px; font-weight: 900;"><span>${duplicatePhoneLine}</span></div>`
      : ""
  }

  <div class="header-line" style="font-size: 11px;">
    <span>First: ${formatTime(firstScan)} | Last: ${formatTime(
    lastScan
  )} | Dur: ${scanDuration}</span>
  </div>

  <div class="header-line">
    <span>${nilCount > 0 ? `Nil Stock: ${nilCount}` : "No nil stock"}</span>
  </div>

  <div class="header-line">
    <span>${fastMovingLine}</span>
  </div>

  <div class="separator"></div>

  <div class="summary-box">
    <div style="font-weight: 900; margin-bottom: 2px;">SUMMARY</div>
    <div style="text-align: left; margin-bottom: 2px;">SHOP</div>
    <div class="summary-row">
      <span>Matched: ${stats.shop.matched}</span>
      <span>Unmatched: ${stats.shop.unmatched}</span>
      <span>Unchecked: ${stats.shop.unchecked}</span>
    </div>
    <div style="text-align: left; margin-top: 4px; margin-bottom: 2px;">GODOWN</div>
    <div class="summary-row">
      <span>Matched: ${stats.godown.matched}</span>
      <span>Unmatched: ${stats.godown.unmatched}</span>
      <span>Unchecked: ${stats.godown.unchecked}</span>
    </div>
  </div>

  ${renderOperatorSummary(operatorSummary)}

  <div class="separator"></div>

  ${renderUnmatchedTable(shopUnmatchedItems, "SHOP")}
  ${renderUnmatchedTable(godownUnmatchedItems, "GODOWN")}

  ${renderFastSellingSection(fastSellingItems, fastSellingLabel)}

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}
  </div>
</body>
</html>
  `;
}

function buildVerificationStatusLists(
  cycleProducts,
  masterProducts,
  activityDate
) {
  const masterMap = new Map();
  masterProducts.forEach((product) => {
    const key = createProductKey(product.Brand, product.Pack);
    if (!key) return;
    masterMap.set(key, product);
  });

  const lists = {
    shop: { matched: [], unmatched: [], unchecked: [] },
    godown: { matched: [], unmatched: [], unchecked: [] },
  };

  const stats = {
    shop: { matched: 0, unmatched: 0, unchecked: 0 },
    godown: { matched: 0, unmatched: 0, unchecked: 0 },
  };

  const extractOperatorName = (entry) => {
    if (!entry || typeof entry !== "object") return "";
    return (
      entry.operatorName ||
      entry.user ||
      entry.userName ||
      entry.operator ||
      entry.performedBy ||
      ""
    )
      .toString()
      .trim();
  };

  const normalizeMatchValue = (value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["yes", "true", "1", "matched"].includes(normalized)) return true;
      if (["no", "false", "0", "unmatched"].includes(normalized)) return false;
    }
    return undefined;
  };

  const deriveMatchFlag = (entry, locationType) => {
    if (!entry) return undefined;

    if (
      entry.locationMatches &&
      entry.locationMatches.hasOwnProperty(locationType)
    ) {
      const locValue = entry.locationMatches[locationType];
      const normalized = normalizeMatchValue(locValue);
      if (normalized !== undefined) return normalized;
    }

    if (locationType === "shop" && entry.hasOwnProperty("isMatchShop")) {
      const normalized = normalizeMatchValue(entry.isMatchShop);
      if (normalized !== undefined) return normalized;
    }
    if (locationType === "godown" && entry.hasOwnProperty("isMatchGodown")) {
      const normalized = normalizeMatchValue(entry.isMatchGodown);
      if (normalized !== undefined) return normalized;
    }

    const fromIsMatch = normalizeMatchValue(entry.isMatch);
    if (fromIsMatch !== undefined) return fromIsMatch;

    return normalizeMatchValue(entry.matched);
  };

  const entryAppliesToLocation = (entry, locationType) => {
    if (!entry || typeof entry !== "object") return false;
    if (entry.location) {
      return entry.location.toString().toLowerCase() === locationType;
    }
    if (entry.changes && typeof entry.changes === "object") {
      const keys = Object.keys(entry.changes).map((key) => key.toLowerCase());
      const includesShop = keys.includes("shop");
      const includesGodown = keys.includes("godown");
      if (locationType === "shop" && includesShop) return true;
      if (locationType === "godown" && includesGodown) return true;
      return !includesShop && !includesGodown;
    }
    return true;
  };

  const processLocation = (product, locationType, masterProduct, bpc) => {
    if (activityDate) {
      if (!hasLocationActivityOnDate(product, activityDate, locationType)) {
        return;
      }
    }
    const field = locationType === "shop" ? "Shop" : "Godown";
    const matchedField =
      locationType === "shop" ? "ShopMatched" : "GodownMatched";

    const currentValue = product[field] || product[field.toLowerCase()] || "0";
    const currentCount = parseCountValue(currentValue, bpc);
    const masterValue = masterProduct
      ? masterProduct[field] || masterProduct[field.toLowerCase()] || "0"
      : "0";
    const masterCount = parseCountValue(masterValue, bpc);

    if (currentCount.total === 0 && masterCount.total === 0) return;

    const matchedStatus = (product[matchedField] || "").toUpperCase().trim();
    const isMatched = matchedStatus === "YES";
    const isUnmatched = matchedStatus === "NO";

    let lastUnmatchedBy = "";
    let lastMatchedBy = "";
    let changeLog = [];
    try {
      changeLog = JSON.parse(product.ChangeLog || "[]");
    } catch (e) {
      changeLog = [];
    }

    changeLog
      .filter((entry) => entryAppliesToLocation(entry, locationType))
      .forEach((entry) => {
        const flag = deriveMatchFlag(entry, locationType);
        if (flag === undefined) return;
        const operator = extractOperatorName(entry);
        if (flag === false) {
          lastUnmatchedBy = operator || lastUnmatchedBy;
        } else if (flag === true) {
          lastMatchedBy = operator || lastMatchedBy;
        }
      });

    const item = {
      brand: (product.Brand || "").trim(),
      pack: String(product.Pack || "").trim(),
      item: product.Item || masterProduct?.Item || "BEER",
      unmatchedBy: lastUnmatchedBy,
      matchedBy: lastMatchedBy,
      location: locationType,
    };

    if (isMatched) {
      stats[locationType].matched++;
      lists[locationType].matched.push(item);
    } else if (isUnmatched) {
      stats[locationType].unmatched++;
      lists[locationType].unmatched.push(item);
    } else {
      stats[locationType].unchecked++;
      lists[locationType].unchecked.push(item);
    }
  };

  const processedKeys = new Set();
  cycleProducts.forEach((product) => {
    const brand = (product.Brand || "").trim();
    const pack = String(product.Pack || "").trim();
    if (!brand || !pack) return;
    const key = createProductKey(brand, pack);
    if (!key) return;
    processedKeys.add(key);
    const masterProduct = masterMap.get(key);
    const bpc = parseInt(product.BPC || "12", 10) || 12;
    processLocation(product, "shop", masterProduct, bpc);
    processLocation(product, "godown", masterProduct, bpc);
  });

  if (!activityDate) {
    masterProducts.forEach((product) => {
      const key = createProductKey(product.Brand, product.Pack);
      if (!key || processedKeys.has(key)) return;
      const bpc = parseInt(product.BPC || "12", 10) || 12;
      const shopCount = parseCountValue(product.Shop || "0", bpc);
      const godownCount = parseCountValue(product.Godown || "0", bpc);

      if (shopCount.total === 0 && godownCount.total === 0) return;

      const baseItem = {
        brand: (product.Brand || "").trim(),
        pack: String(product.Pack || "").trim(),
        item: product.Item || "BEER",
        unmatchedBy: "",
        matchedBy: "",
      };

      if (shopCount.total > 0) {
        stats.shop.unchecked++;
        lists.shop.unchecked.push({ ...baseItem, location: "shop" });
      }
      if (godownCount.total > 0) {
        stats.godown.unchecked++;
        lists.godown.unchecked.push({ ...baseItem, location: "godown" });
      }
    });
  }

  const sortItems = (items) => {
    return items.sort((a, b) => {
      const itemCompare = (a.item || "").localeCompare(b.item || "");
      if (itemCompare !== 0) return itemCompare;
      return (a.brand || "").localeCompare(b.brand || "");
    });
  };

  ["matched", "unmatched", "unchecked"].forEach((status) => {
    sortItems(lists.shop[status]);
    sortItems(lists.godown[status]);
  });

  return { lists, stats };
}

function generateVerificationFilterReportHTML(data) {
  const { cycleDate, filterLabel, locationLabel, sections } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${filterLabel} Report - ${cycleDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-weight: bold;
      color: black;
    }
    body {
      font-family: 'Roboto Condensed', sans-serif;
      font-size: 13px;
      line-height: 1.1;
      padding: 6px;
      max-width: 296px;
      background: white;
    }
    .center { text-align: center; }
    .header-line {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
      font-size: 13px;
    }
    .separator {
      border-bottom: 2px solid #000;
      margin: 3px 0;
    }
    .summary-box {
      padding: 2px;
      font-size: 14px;
      text-align: center;
      margin: 3px 0;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin: 3px 0;
      table-layout: fixed;
    }
    th {
      padding: 2px 1px;
      text-align: left;
      border-bottom: 1px solid #000;
      font-size: 13px;
    }
    td {
      padding: 1px 1px;
      text-align: left;
      border: none;
      word-wrap: break-word;
      word-break: break-word;
      white-space: normal;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">${filterLabel} REPORT</div>
    <div>${cycleDate}</div>
  </div>

  <div class="separator"></div>

  <div class="header-line">
    <span>${locationLabel}</span>
  </div>

  <div class="summary-box">
    ${sections
      .map(
        (section) => `
      <div class="summary-row">
        <span>${section.title}</span>
        <span>${section.count}</span>
      </div>
    `
      )
      .join("")}
  </div>

  <div class="separator"></div>

  ${sections
    .map(
      (section) => `
    <div style="font-size: 13px; font-weight: 900; margin: 3px 0;">
      ${section.title}
    </div>
    ${section.tableHtml}
    <div class="separator"></div>
  `
    )
    .join("")}

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}
  </div>
</body>
</html>
  `;
}

function buildDifferenceSections({ cycleProducts, masterMap, scope, todayDate }) {
  const sections = {
    shop: { title: "SHOP", items: [], totalDiff: 0 },
    godown: { title: "GODOWN", items: [], totalDiff: 0 },
  };

  const formatPackLabel = (packValue) => {
    const trimmed = String(packValue || "").trim();
    if (!trimmed) return "";
    if (/[a-zA-Z]/.test(trimmed)) return trimmed;
    return `${trimmed}ml`;
  };

  const formatSignedDiff = (diffValue) => {
    const numeric = Number(diffValue) || 0;
    if (numeric === 0) return "0";
    return numeric > 0 ? `+${numeric}` : `${numeric}`;
  };

  const shouldIncludeLocationForRow = (row, locationType) => {
    if (scope === "total") return true;
    return hasLocationActivityOnDate(row, todayDate, locationType);
  };

  (cycleProducts || []).forEach((row) => {
    if (!row || !row.Brand || !row.Pack) return;

    const key = createProductKey(row.Brand, row.Pack);
    const masterProduct = key && masterMap ? masterMap.get(key) : null;
    const bpc = parseInt(row.BPC || masterProduct?.BPC || "12", 10) || 12;
    const name = `${row.Brand} ${formatPackLabel(row.Pack)}`.trim();

    const collectForLocation = (locationType) => {
      if (!shouldIncludeLocationForRow(row, locationType)) {
        return;
      }

      const field = locationType === "shop" ? "Shop" : "Godown";
      const scannedCount = parseCountValue(
        row[field] || row[field.toLowerCase()] || "0",
        bpc
      );
      const masterCount = parseCountValue(
        masterProduct?.[field] || masterProduct?.[field.toLowerCase()] || "0",
        bpc
      );
      const diff = scannedCount.total - masterCount.total;
      if (diff === 0) return;

      sections[locationType].items.push({
        name,
        master: masterCount.formatted,
        scanned: scannedCount.formatted,
        diff,
        diffLabel: formatSignedDiff(diff),
      });
      sections[locationType].totalDiff += diff;
    };

    collectForLocation("shop");
    collectForLocation("godown");
  });

  const sortItems = (items) =>
    items.sort((a, b) => {
      const magnitudeDiff = Math.abs(b.diff) - Math.abs(a.diff);
      if (magnitudeDiff !== 0) return magnitudeDiff;
      return (a.name || "").localeCompare(b.name || "");
    });

  sortItems(sections.shop.items);
  sortItems(sections.godown.items);

  return sections;
}

function generateDifferenceReportHTML(data) {
  const { cycleDate, scope, todayDate, sections } = data;
  const scopeLabel = scope === "total" ? "TOTAL DIFF" : "TODAY DIFF";
  const scopeInfo =
    scope === "total"
      ? `All cycle items (${cycleDate})`
      : `Only scanned today (${todayDate})`;

  const renderSection = (section) => {
    const items = Array.isArray(section?.items) ? section.items : [];
    if (items.length === 0) {
      return `
        <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
          <span>${section.title}</span>
          <span>0</span>
        </div>
        <div style="font-size: 12px; margin: 4px 0;">No diff items</div>
        <div class="separator"></div>
      `;
    }

    return `
      <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
        <span>${section.title}</span>
        <span>Items: ${items.length} | Total: ${
      section.totalDiff > 0
        ? `+${section.totalDiff}`
        : section.totalDiff
    }</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 46%;">Name</th>
            <th style="width: 18%;">Master</th>
            <th style="width: 18%;">Scanned</th>
            <th style="width: 18%;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
            <tr>
              <td>${item.name}</td>
              <td>${item.master}</td>
              <td>${item.scanned}</td>
              <td>${item.diffLabel}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      <div class="separator"></div>
    `;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Difference Report - ${cycleDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-weight: bold;
      color: black;
    }
    body {
      font-family: 'Roboto Condensed', sans-serif;
      font-size: 13px;
      line-height: 1.1;
      padding: 6px;
      max-width: 296px;
      background: white;
    }
    .center { text-align: center; }
    .header-line {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
      font-size: 13px;
    }
    .separator {
      border-bottom: 2px solid #000;
      margin: 3px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin: 3px 0;
      table-layout: fixed;
    }
    th {
      padding: 2px 1px;
      text-align: left;
      border-bottom: 1px solid #000;
      font-size: 12px;
    }
    td {
      padding: 1px 1px;
      text-align: left;
      border: none;
      word-wrap: break-word;
      word-break: break-word;
      white-space: normal;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">DIFFERENCE REPORT</div>
    <div>CYCLE-${cycleDate}</div>
  </div>

  <div class="separator"></div>

  <div class="header-line">
    <span>Type: ${scopeLabel}</span>
  </div>
  <div class="header-line">
    <span>${scopeInfo}</span>
  </div>

  <div class="separator"></div>

  ${renderSection(sections.shop)}
  ${renderSection(sections.godown)}

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}
  </div>
</body>
</html>
  `;
}

function generateFinishReportHTML(data) {
  const { cycleDate, operatorName, locationLabel, items = [] } = data;
  const headerOperator = operatorName ? operatorName : "Unknown";
  const locationLine = locationLabel ? `Location: ${locationLabel}` : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Finish Report - ${cycleDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-weight: bold;
      color: black;
    }
    body {
      font-family: 'Roboto Condensed', sans-serif;
      font-size: 13px;
      line-height: 1.1;
      padding: 6px;
      max-width: 296px;
      background: white;
    }
    .center { text-align: center; }
    .header-line {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
      font-size: 13px;
    }
    .separator {
      border-bottom: 2px solid #000;
      margin: 3px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin: 3px 0;
      table-layout: fixed;
    }
    th {
      padding: 2px 1px;
      text-align: left;
      border-bottom: 1px solid #000;
      font-size: 13px;
    }
    td {
      padding: 1px 1px;
      text-align: left;
      border: none;
      word-wrap: break-word;
      word-break: break-word;
      white-space: normal;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">FINISH REPORT</div>
    <div>CYCLE-${cycleDate}</div>
  </div>

  <div class="separator"></div>

  <div class="header-line">
    <span>Operator: ${headerOperator}</span>
  </div>
  ${
    locationLine
      ? `<div class="header-line"><span>${locationLine}</span></div>`
      : ""
  }

  <div class="separator"></div>

  <table>
    <thead>
      <tr>
        <th style="width: 70%;">Name</th>
        <th style="width: 30%;">Diff</th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map(
          (item) => `
        <tr>
          <td>${item.name}</td>
          <td>${item.diff}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  </table>

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}
  </div>
</body>
</html>
  `;
}

module.exports = registerCycleRoutes;
