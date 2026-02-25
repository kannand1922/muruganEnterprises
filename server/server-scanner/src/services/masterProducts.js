const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { stockLensPaths } = require("../../../../shared/config/paths");

let cache = {
  mtimeMs: 0,
  rows: [],
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

async function loadMasterProducts() {
  const filePath = stockLensPaths.brandsCsv;
  const stat = await fs.promises.stat(filePath);

  if (cache.rows.length > 0 && cache.mtimeMs === stat.mtimeMs) {
    return cache.rows;
  }

  const raw = await fs.promises.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  const tableLines = lines.slice(3).join("\n");
  const parsedRows = await parseCsvText(tableLines);
  const mapped = parsedRows.map(mapMasterRow).filter((row) => row.itemCode);

  cache = {
    mtimeMs: stat.mtimeMs,
    rows: mapped,
  };

  return mapped;
}

async function searchMasterProducts(query = "", limit = 50) {
  const rows = await loadMasterProducts();
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
