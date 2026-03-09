const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { stockLensPaths } = require("../../../../shared/config/paths");

let cache = {
  mtimeMs: 0,
  rows: [],
  allRows: [],
};

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickByAliases(row, aliases) {
  const normalized = Object.entries(row).reduce((acc, [key, value]) => {
    acc[normalizeKey(key)] = value;
    return acc;
  }, {});

  for (const alias of aliases) {
    const value = normalized[normalizeKey(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : null;
}

function isGodownLike(value) {
  const normalized = normalizeKey(value);
  return (
    normalized.includes("godown") ||
    normalized.includes("goddown") ||
    normalized.includes("godwn") ||
    normalized.includes("warehouse")
  );
}

function parseStockStringToBottles(stock, bpc) {
  const raw = String(stock || "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [packsPart = "0", bottlesPart = "0"] = unsigned.split(".");
  const packs = Math.max(0, Number.parseInt(packsPart, 10) || 0);
  const bottles = Math.max(0, Number.parseInt(bottlesPart, 10) || 0);
  const total = packs * Math.max(1, bpc || 1) + bottles;
  return negative ? -total : total;
}

function getLocationStockMap(row) {
  const knownHeaders = new Set(
    [
      "Sl",
      "Sl.",
      "Sno",
      "S.No",
      "S No",
      "Item",
      "Item Name",
      "Name",
      "Brand",
      "Brand Name",
      "Pack",
      "Pack Value",
      "PackValue",
      "Code",
      "ItemCode",
      "Item Code",
      "BPC",
      "Bottle Per Case",
      "MRP",
      "Mrp",
      "Barcode",
      "Bar Code",
      "Godown",
      "Godown Stock",
      "Master Godown",
      "Shop",
      "Shop Stock",
      "Master Shop",
    ].map((header) => normalizeKey(header))
  );

  const stockMap = {};
  for (const [key, value] of Object.entries(row || {})) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || knownHeaders.has(normalizedKey)) continue;
    stockMap[normalizedKey] = String(value ?? "").trim();
  }
  return stockMap;
}

function parseCsvText(csvText) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(csvText)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function mapMasterRow(row) {
  const itemCode = pickByAliases(row, ["Code", "ItemCode", "Item Code"]);
  const itemName = pickByAliases(row, ["Item Name", "Name", "Item"]);
  const brandName = pickByAliases(row, ["Brand Name", "Brand"]);
  const packValue = pickByAliases(row, ["Pack", "Pack Value", "PackValue"]);
  const bpc = toNumberOrNull(pickByAliases(row, ["BPC", "Bottle Per Case"]));
  const mrp = toNumberOrNull(pickByAliases(row, ["MRP", "Mrp"]));
  const barcode = pickByAliases(row, ["Barcode", "Bar Code"]);
  const godownStock = pickByAliases(row, ["Godown", "Godown Stock", "Master Godown"]);
  const shopStock = pickByAliases(row, ["Shop", "Shop Stock", "Master Shop"]);
  const locationStocks = getLocationStockMap(row);

  return {
    itemCode,
    itemName,
    brandName,
    packValue,
    bpc,
    mrp,
    barcode,
    godownStock,
    shopStock,
    locationStocks,
  };
}

function hasPositiveShopStock(masterRow) {
  const safeBpc = Math.max(1, Number(masterRow?.bpc) || 12);
  const stocks = masterRow?.locationStocks || {};
  const nonGodownKeys = Object.keys(stocks).filter((locationKey) => !isGodownLike(locationKey));

  // If CSV has location-specific non-godown columns, trust those for shop availability.
  // Otherwise, fallback to legacy `shop` column.
  if (nonGodownKeys.length > 0) {
    for (const locationKey of nonGodownKeys) {
      const bottles = parseStockStringToBottles(stocks[locationKey], safeBpc);
      if (bottles > 0) return true;
    }
    return false;
  }

  const directShop = parseStockStringToBottles(masterRow?.shopStock, safeBpc);
  if (directShop > 0) return true;

  for (const [locationKey, rawValue] of Object.entries(stocks)) {
    if (isGodownLike(locationKey)) continue;
    const bottles = parseStockStringToBottles(rawValue, safeBpc);
    if (bottles > 0) return true;
  }

  return false;
}

async function loadMasterProducts(options = {}) {
  const { includeAll = false } = options;
  const filePath = stockLensPaths.brandsCsv;
  const stat = await fs.promises.stat(filePath);

  if (cache.mtimeMs === stat.mtimeMs) {
    return includeAll ? cache.allRows : cache.rows;
  }

  const raw = await fs.promises.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  const tableLines = lines.slice(3).join("\n");
  const parsedRows = await parseCsvText(tableLines);
  const mappedAll = parsedRows
    .map(mapMasterRow)
    .filter((row) => row.itemCode);
  const mapped = mappedAll.filter((row) => hasPositiveShopStock(row));

  cache = {
    mtimeMs: stat.mtimeMs,
    rows: mapped,
    allRows: mappedAll,
  };

  return includeAll ? mappedAll : mapped;
}

async function searchMasterProducts(query = "", limit = 50, options = {}) {
  const rows = await loadMasterProducts(options);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 10000);

  if (!normalizedQuery) {
    return rows.slice(0, safeLimit);
  }

  return rows
    .filter((row) => {
      return (
        row.itemCode.toLowerCase().includes(normalizedQuery) ||
        row.itemName.toLowerCase().includes(normalizedQuery) ||
        row.brandName.toLowerCase().includes(normalizedQuery) ||
        row.packValue.toLowerCase().includes(normalizedQuery)
      );
    })
    .slice(0, safeLimit);
}

async function getMasterProductByCode(itemCode) {
  const rows = await loadMasterProducts();
  const code = String(itemCode || "").trim().toLowerCase();
  return rows.find((row) => row.itemCode.toLowerCase() === code) || null;
}

module.exports = {
  loadMasterProducts,
  searchMasterProducts,
  getMasterProductByCode,
  masterFilePath: path.resolve(stockLensPaths.brandsCsv),
};
