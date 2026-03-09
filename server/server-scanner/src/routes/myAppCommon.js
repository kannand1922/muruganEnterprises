const express = require("express");
const fs = require("fs");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { scannerDataPaths } = require("../../../../shared/config/paths");
const { verifySettingsPassword } = require("../services/settingsPassword");
const {
  getLegacyPrintersPayload,
} = require("../services/desktopCompat");
const { allocateCode, releaseCode } = require("../../../pool/codePool");

const router = express.Router();

let productsCache = {
  mtimeMs: 0,
  rows: [],
};
let brandsCache = {
  mtimeMs: 0,
  rows: [],
};

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

async function loadLegacyProducts() {
  const filePath = scannerDataPaths.productsCsv;
  const stats = await fs.promises.stat(filePath);

  if (productsCache.mtimeMs === stats.mtimeMs) {
    return productsCache.rows;
  }

  const raw = await fs.promises.readFile(filePath, "utf8");
  const parsedRows = await parseCsvText(raw);
  const rows = parsedRows
    .map((row) => ({
      PRODUCT: String(row.PRODUCT || "").trim(),
      "ITEM CODE": String(row["ITEM CODE"] || "").trim(),
      PRICE: String(row.PRICE || "").trim(),
    }))
    .filter((row) => row.PRODUCT || row["ITEM CODE"] || row.PRICE);

  productsCache = {
    mtimeMs: stats.mtimeMs,
    rows,
  };

  return rows;
}

async function loadMyAppBrands() {
  const filePath = scannerDataPaths.brandsCsv;
  const stats = await fs.promises.stat(filePath);

  if (brandsCache.mtimeMs === stats.mtimeMs) {
    return brandsCache.rows;
  }

  const raw = await fs.promises.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  const tableLines = lines.slice(3).join("\n");
  const parsedRows = await parseCsvText(tableLines);
  const rows = parsedRows.filter((row) =>
    Object.values(row || {}).some((value) => String(value || "").trim() !== "")
  );

  brandsCache = {
    mtimeMs: stats.mtimeMs,
    rows,
  };

  return rows;
}

router.get("/products", async (req, res) => {
  try {
    const data = await loadLegacyProducts();
    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Unable to read products (${error.message})`,
    });
  }
});

router.get("/brands", async (req, res) => {
  try {
    const data = await loadMyAppBrands();
    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Unable to read brands (${error.message})`,
    });
  }
});

router.get("/allprinters", async (req, res) => {
  const payload = await getLegacyPrintersPayload();
  return res.json(payload);
});

router.post("/admin/verify", async (req, res) => {
  const password = String(req.body?.password || "");
  const result = verifySettingsPassword(password);

  if (!result.verified) {
    return res.status(401).json({
      success: false,
      message: "Invalid settings password",
    });
  }

  return res.json({
    success: true,
    data: {
      verified: true,
      source: result.source,
    },
  });
});

router.post("/code/allocate", async (req, res) => {
  const appId = String(req.body?.app || "").trim().toLowerCase();
  const reason = String(req.body?.reason || "").trim();

  if (!appId) {
    return res.status(400).json({
      success: false,
      message: "app is required",
    });
  }

  try {
    const result = await allocateCode(appId, { reason });
    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Unable to allocate code",
    });
  }
});

router.post("/code/release", async (req, res) => {
  const appId = String(req.body?.app || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const reason = String(req.body?.reason || "released").trim();

  if (!appId) {
    return res.status(400).json({
      success: false,
      message: "app is required",
    });
  }

  try {
    const result = await releaseCode(appId, code, reason);
    return res.json({
      success: Boolean(result.released),
      ...result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Unable to release code",
    });
  }
});

module.exports = router;
