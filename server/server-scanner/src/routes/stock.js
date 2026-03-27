const express = require("express");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { prisma } = require("../prisma");
const { loadMasterProducts } = require("../services/masterProducts");
const {
  getDiffImageBasePath,
  getDiffImageFileNameExtension,
  getDiffImageMimeTypeExtension,
} = require("../services/diffImagePath");
const { printerServerPort } = require("../../../../shared/config/ports");

const router = express.Router();
const PRINT_SERVICE_BASE_URL = String(
  process.env.PRINTER_SERVICE_URL || `http://localhost:${printerServerPort}`
)
  .trim()
  .replace(/\/+$/, "");
const PUBLIC_ROOT_DIR = path.resolve(__dirname, "../../../public");

function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function getUtcDayRange(activityDate) {
  const fallback = new Date().toISOString().slice(0, 10);
  const dayKey = String(activityDate || fallback).trim();
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
  const dayEnd = new Date(`${dayKey}T23:59:59.999Z`);
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
    return null;
  }
  return { dayKey, dayStart, dayEnd };
}

function getUtcCycleRange(cycle, endDateOverride) {
  const startDate = parseDate(cycle?.startDate);
  const endDate = parseDate(endDateOverride || cycle?.endDate || new Date());
  if (!startDate || !endDate) return null;
  const startKey = startDate.toISOString().slice(0, 10);
  const endKey = endDate.toISOString().slice(0, 10);
  const dayStart = new Date(`${startKey}T00:00:00.000Z`);
  const dayEnd = new Date(`${endKey}T23:59:59.999Z`);
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
    return null;
  }
  const snoLabel = cycle?.sno ? `CYCLE-${cycle.sno}` : `CYCLE-${startKey}`;
  const dayKey = `${snoLabel}-${startKey}-to-${endKey}`;
  return { dayKey, dayStart, dayEnd, startKey, endKey };
}

function normalizeLocationKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isGodownLike(value) {
  const normalized = normalizeLocationKey(value);
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

function getStrictLocationHeaderKey(location) {
  return normalizeLocationKey(location?.locationName);
}

function hasMatchingLocationStockColumn(product, location) {
  const locationKey = getStrictLocationHeaderKey(location);
  if (!locationKey) return false;
  if (locationKey === "shop") return true;
  if (locationKey === "godown") return true;
  const stocks = product?.locationStocks || {};
  return Object.prototype.hasOwnProperty.call(stocks, locationKey);
}

function getMasterStockBottles(product, location) {
  const safeBpc = Number(product?.bpc) || 12;
  const locationKey = getStrictLocationHeaderKey(location);
  if (locationKey === "shop") {
    return parseStockStringToBottles(product?.shopStock, safeBpc);
  }
  if (locationKey === "godown") {
    return parseStockStringToBottles(product?.godownStock, safeBpc);
  }
  const stocks = product?.locationStocks || {};
  const value = locationKey ? String(stocks[locationKey] ?? "").trim() : "";

  return parseStockStringToBottles(value, safeBpc);
}

function hasPositiveStockForLocation(product, location) {
  if (!hasMatchingLocationStockColumn(product, location)) return false;
  return getMasterStockBottles(product, location) > 0;
}

function getLocationLabel(location) {
  return String(location?.locationName || location?.locationCode || "LOCATION").trim().toUpperCase();
}

function formatPackLabel(packValue) {
  const trimmed = String(packValue || "").trim();
  if (!trimmed) return "";
  if (/[a-zA-Z]/.test(trimmed)) return trimmed;
  return `${trimmed}ml`;
}

function buildDisplayName(brandName, packValue, itemName, fallbackCode) {
  const brand = String(brandName || itemName || fallbackCode || "").trim();
  const pack = formatPackLabel(packValue);
  return `${brand}${pack ? ` ${pack}` : ""}`.trim();
}

function formatTimeIst(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLocalDateKeyIst() {
  try {
    const value = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return value || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function buildDiffProofPath({ basePath, dateKey, batchId, cycleLabel, extension }) {
  const safeBase = String(basePath || "").trim().replace(/\/+$/, "") || "/image/diff";
  const safeDate = String(dateKey || "").trim() || getLocalDateKeyIst();
  const safeCycle = String(cycleLabel || "").trim() || "cycle";
  const safeExt = String(extension || "").trim();
  return `${safeBase}/${safeDate}/diff_${batchId}_cycle_${safeCycle}${safeExt}`;
}

function parseProofImagePayload(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return { base64Data: "", mimeType: "" };
  }

  const dataUrlMatch = rawValue.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return {
      mimeType: String(dataUrlMatch[1] || "").trim().toLowerCase(),
      base64Data: String(dataUrlMatch[2] || "")
        .trim()
        .replace(/\s+/g, ""),
    };
  }

  return {
    base64Data: rawValue.replace(/\s+/g, ""),
    mimeType: "",
  };
}

function resolvePublicAssetPath(publicAssetPath) {
  const relativePath = String(publicAssetPath || "").trim().replace(/^\/+/, "");
  if (!relativePath) {
    throw new Error("Proof image path is required");
  }

  const resolvedPath = path.resolve(PUBLIC_ROOT_DIR, relativePath);
  if (resolvedPath !== PUBLIC_ROOT_DIR && !resolvedPath.startsWith(`${PUBLIC_ROOT_DIR}${path.sep}`)) {
    throw new Error("Invalid proof image path");
  }
  return resolvedPath;
}

async function saveProofImageFile(proofImagePath, base64Data) {
  const outputPath = resolvePublicAssetPath(proofImagePath);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, Buffer.from(base64Data, "base64"));
}

function formatDurationMins(startValue, endValue) {
  if (!startValue || !endValue) return "N/A";
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "N/A";
  return `${Math.floor(Math.abs(end - start) / 60000)} mins`;
}

function formatBottleCountAsStock(totalBottles, bpc, includeSign = false) {
  const safeBpc = Math.max(1, Number(bpc) || 1);
  const numeric = Number(totalBottles) || 0;
  const sign = numeric < 0 ? "-" : includeSign && numeric > 0 ? "+" : "";
  const absolute = Math.abs(Math.trunc(numeric));
  const packs = Math.floor(absolute / safeBpc);
  const bottles = absolute % safeBpc;
  return `${sign}${packs}.${String(bottles).padStart(3, "0")}`;
}

function sortNames(rows) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function chunkOperators(entries) {
  const rows = [];
  for (let i = 0; i < entries.length; i += 2) {
    rows.push([entries[i], entries[i + 1] || null]);
  }
  return rows;
}

function normalizeItemCode(value) {
  return String(value || "").trim().toLowerCase();
}

function generateVerificationReportHTML(data) {
  const {
    dayKey,
    shopName,
    phonesUsed,
    firstScanAt,
    lastScanAt,
    nilCount,
    nilSummaryRows,
    fastMovingSummary,
    locationSummaries,
    diffSections = [],
    operatorSummary,
    generatedAt,
  } = data;

  const operatorRows = chunkOperators(operatorSummary);

  const summaryHtml = locationSummaries
    .map(
      (section) => `
    <div style="text-align: left; margin-top: 4px; margin-bottom: 2px;">${section.label}</div>
    <div class="summary-row">
      <span>Matched: ${section.matched}</span>
      <span>Unmatched: ${section.unmatched}</span>
      <span>Unchecked: ${section.unchecked}</span>
    </div>
  `
    )
    .join("");

  const operatorHtml =
    operatorRows.length === 0
      ? ""
      : `
    <div class="summary-box" style="text-align: left;">
      <div style="font-weight: 900; margin-bottom: 2px;">OPERATORS</div>
      ${operatorRows
        .map(
          ([left, right]) => `
        <div class="summary-row">
          <span>${left.name} (${left.count})</span>
          <span>${right ? `${right.name} (${right.count})` : ""}</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  const unmatchedSectionsHtml = locationSummaries
    .filter((section) => section.unmatchedRows.length > 0)
    .map(
      (section) => `
      <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
        <span>${section.label} (Not Matched)</span>
        <span style="font-size: 12px;">${section.label}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 100%;">Name</th>
          </tr>
        </thead>
        <tbody>
          ${section.unmatchedRows
            .map(
              (item) => `
            <tr><td>${item.name}</td></tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      <div class="separator"></div>
    `
    )
    .join("");

  const diffSectionsHtml =
    diffSections.length === 0 || diffSections.every((section) => section.rows.length === 0)
      ? `
      <div style="font-size: 12px; margin: 4px 0;">No diff items</div>
      <div class="separator"></div>
    `
      : diffSections
          .filter((section) => section.rows.length > 0)
          .map(
            (section) => `
      <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
        <span>${section.label} (Diff)</span>
        <span style="font-size: 12px;">${section.rows.length}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 82%;">Name</th>
            <th style="width: 18%;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${section.rows
            .map(
              (item) => `
            <tr>
              <td>${item.name}</td>
              <td>${item.diffLabel}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      <div class="separator"></div>
    `
          )
          .join("");

  const fastMovingLine = `Fast Moving (${fastMovingSummary.label}): ${fastMovingSummary.scannedProductCount}/${fastMovingSummary.trackedProducts}`;
  const nilStockLine =
    Array.isArray(nilSummaryRows) && nilSummaryRows.length > 0
      ? `Nil Stock: ${nilSummaryRows
          .map((row) => `${row.label}-${row.count}`)
          .join(" | ")}`
      : nilCount > 0
        ? `Nil Stock: ${nilCount}`
        : "No nil stock";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Verification Report - ${dayKey}</title>
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
    <div>${dayKey}</div>
  </div>

  <div class="separator"></div>

  <div class="header-line">
    <span>${shopName || "Shop Name"}</span>
  </div>

  <div class="header-line">
    <span>Phones Used: ${phonesUsed.length}</span>
  </div>
  ${phonesUsed.length > 0 ? `<div style="font-size: 11px; margin: 2px 0;">${phonesUsed.join(", ")}</div>` : ""}

  <div class="header-line" style="font-size: 11px;">
    <span>First: ${formatTimeIst(firstScanAt)} | Last: ${formatTimeIst(lastScanAt)} | Dur: ${formatDurationMins(firstScanAt, lastScanAt)}</span>
  </div>

  <div class="header-line">
    <span>${nilStockLine}</span>
  </div>

  <div class="header-line">
    <span>${fastMovingLine}</span>
  </div>

  <div class="separator"></div>

  <div class="summary-box">
    <div style="font-weight: 900; margin-bottom: 2px;">SUMMARY</div>
    ${summaryHtml}
  </div>

  ${operatorHtml}

  <div class="separator"></div>

  ${unmatchedSectionsHtml}

  <div class="center" style="font-weight: 900; margin: 3px 0;">DIFF ITEMS</div>
  ${diffSectionsHtml}

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${generatedAt}
  </div>
</body>
</html>
  `;
}

function generateVerificationFilterReportHTML(data) {
  const { dayKey, filterLabel, sections, generatedAt } = data;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${filterLabel} Report - ${dayKey}</title>
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
    .separator { border-bottom: 2px solid #000; margin: 3px 0; }
    .summary-row { display: flex; justify-content: space-between; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 3px 0; table-layout: fixed; }
    th { padding: 2px 1px; text-align: left; border-bottom: 1px solid #000; font-size: 13px; }
    td { padding: 1px 1px; text-align: left; border: none; word-wrap: break-word; word-break: break-word; white-space: normal; font-size: 11px; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">${filterLabel} REPORT</div>
    <div>${dayKey}</div>
  </div>
  <div class="separator"></div>
  ${sections
    .map(
      (section) => `
    <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
      <span>${section.label}</span>
      <span>${section.rows.length}</span>
    </div>
    <table>
      <thead><tr><th>Name</th></tr></thead>
      <tbody>
        ${
          section.rows.length > 0
            ? section.rows.map((row) => `<tr><td>${row.name}</td></tr>`).join("")
            : `<tr><td>No items found</td></tr>`
        }
      </tbody>
    </table>
    <div class="separator"></div>
  `
    )
    .join("")}
  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${generatedAt}
  </div>
</body>
</html>
  `;
}

function generateDiffListReportHTML(data) {
  const { dayKey, sections, generatedAt } = data;
  const sectionsHtml =
    Array.isArray(sections) && sections.length > 0
      ? sections
          .map(
            (section) => `
    <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
      <span>${section.label}</span>
      <span>${section.rows.length}</span>
    </div>
    <table>
      <thead><tr><th style="width: 82%;">Name</th><th style="width: 18%;">Diff</th></tr></thead>
      <tbody>
        ${
          section.rows.length > 0
            ? section.rows
                .map((row) => `<tr><td>${row.name}</td><td>${row.diffLabel}</td></tr>`)
                .join("")
            : `<tr><td colspan="2">No items found</td></tr>`
        }
      </tbody>
    </table>
    <div class="separator"></div>
  `
          )
          .join("")
      : `<div style="font-size: 12px; margin: 4px 0;">No diff items</div><div class="separator"></div>`;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>DIFF Report - ${dayKey}</title>
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
    .separator { border-bottom: 2px solid #000; margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 3px 0; table-layout: fixed; }
    th { padding: 2px 1px; text-align: left; border-bottom: 1px solid #000; font-size: 13px; }
    td { padding: 1px 1px; text-align: left; border: none; word-wrap: break-word; word-break: break-word; white-space: normal; font-size: 11px; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">DIFF REPORT</div>
    <div>${dayKey}</div>
  </div>
  <div class="separator"></div>
  ${sectionsHtml}
  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${generatedAt}
  </div>
</body>
</html>
  `;
}

async function sendHtmlToPrinter(printerRow, htmlContent, jobLabel) {
  const rawIp = String(printerRow?.ipAddress || "").trim();
  if (!rawIp || net.isIP(rawIp) === 0) {
    throw new Error(`Invalid printer IP configured: "${rawIp || "empty"}"`);
  }

  const primaryBase = PRINT_SERVICE_BASE_URL;
  const fallbackBase = `http://localhost:${printerServerPort}`;
  const endpoints = [`${primaryBase}/api/print/html`];
  if (primaryBase !== fallbackBase) {
    endpoints.push(`${fallbackBase}/api/print/html`);
  }

  const body = JSON.stringify({
    printerIP: printerRow.ipAddress,
    port: printerRow.port || 9100,
    htmlContent,
    jobLabel,
    copies: 1,
  });

  let lastFetchError = null;
  for (const endpoint of endpoints) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (error) {
      lastFetchError = error;
      continue;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || !payload?.success) {
      const message = payload?.message || `Printer service error (${response.status})`;
      throw new Error(message);
    }

    return payload;
  }

  const message =
    lastFetchError instanceof Error && lastFetchError.message
      ? lastFetchError.message
      : "fetch failed";
  throw new Error(`Printer service unreachable (${endpoints.join(" -> ")}): ${message}`);
}

async function buildVerificationDataset({ cycleId, dayRange }) {
  const cycle =
    cycleId != null
      ? await prisma.cycle.findUnique({ where: { id: cycleId } })
      : await prisma.cycle.findFirst({
          where: { status: "active" },
          orderBy: [{ startDate: "desc" }],
        });
  if (!cycle) {
    throw new Error("No active/current cycle found");
  }

  const [
    locations,
    shopInfo,
    workers,
    phones,
    bestSellingRows,
    finishedRows,
    scanEvents,
    masterRows,
    allMasterRows,
    diffItems,
  ] = await Promise.all([
    prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.shopInfo.findUnique({ where: { id: 1 } }),
    prisma.worker.findMany({ orderBy: { name: "asc" } }),
    prisma.phone.findMany({ orderBy: [{ id: "asc" }] }),
    prisma.bestSellingProduct.findMany({ orderBy: { id: "asc" } }),
    prisma.cycleFinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        activityDate: { gte: dayRange.dayStart, lte: dayRange.dayEnd },
      },
    }),
    prisma.cycleProductEvent.findMany({
      where: {
        cycleId: cycle.id,
        activityDate: { gte: dayRange.dayStart, lte: dayRange.dayEnd },
        eventScope: "unfinished",
        eventAction: "upsert",
      },
      select: {
        createdAt: true,
        itemCode: true,
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    loadMasterProducts({ includeAll: true }),
    loadMasterProducts({ includeAll: true }),
    prisma.diffItem.findMany({
      where: {
        cycleId: cycle.id,
        deletedAt: null,
        diffBatch: {
          is: {
            deletedAt: null,
            createdAt: { gte: dayRange.dayStart, lte: dayRange.dayEnd },
          },
        },
      },
      select: {
        shopLocationId: true,
        itemCode: true,
        itemName: true,
        brandName: true,
        packValue: true,
        diffBottles: true,
      },
      orderBy: [{ shopLocationId: "asc" }, { id: "asc" }],
    }),
  ]);

  const workerNameById = new Map(
    workers.map((row) => [row.id, String(row.name || "").trim() || "Unknown"])
  );

  const masterByCode = new Map(
    masterRows.map((row) => [normalizeItemCode(row.itemCode), row])
  );

  const latestByKey = new Map();
  finishedRows.forEach((row) => {
    const codeKey = normalizeItemCode(row.itemCode);
    if (!codeKey || !masterByCode.has(codeKey)) return;
    const key = `${row.shopLocationId}|${codeKey}`;
    const timeMs = new Date(
      row.finishedAt || row.updatedAt || row.createdAt || row.activityDate
    ).getTime();
    const existing = latestByKey.get(key);
    if (!existing || timeMs >= existing.timeMs) {
      latestByKey.set(key, { row, timeMs });
    }
  });
  const latestRows = Array.from(latestByKey.values()).map((entry) => entry.row);

  const rowsByLocationCode = new Map();
  latestRows.forEach((row) => {
    const key = `${row.shopLocationId}|${normalizeItemCode(row.itemCode)}`;
    rowsByLocationCode.set(key, row);
  });

  const phoneSet = new Set();
  const phoneNameById = new Map(
    phones.map((row) => [row.id, String(row.name || "").trim()]).filter((row) => row[1])
  );
  const finishedScanTimes = [];
  latestRows.forEach((row) => {
    if (row.phoneId && phoneNameById.has(row.phoneId)) {
      phoneSet.add(phoneNameById.get(row.phoneId));
    } else if (row.phoneName) {
      // Backward compatibility for older rows before phoneId rollout.
      phoneSet.add(String(row.phoneName).trim());
    }
    const timeValue = row.finishedAt || row.updatedAt || row.activityDate;
    if (timeValue) finishedScanTimes.push(new Date(timeValue).toISOString());
  });

  const scanTimesFromEvents = scanEvents
    .map((row) => {
      const codeKey = normalizeItemCode(row.itemCode);
      if (!codeKey || !masterByCode.has(codeKey)) return null;
      const date = new Date(row.createdAt);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    })
    .filter(Boolean);

  const scanTimes = scanTimesFromEvents.length > 0 ? scanTimesFromEvents : finishedScanTimes;

  const operatorItemMap = new Map();
  latestRows.forEach((row) => {
    const name =
      workerNameById.get(row.lastUpdatedByWorkerId || row.finishedByWorkerId) || "Unknown";
    const key = `${row.shopLocationId}|${String(row.itemCode || "").trim().toLowerCase()}`;
    if (!operatorItemMap.has(name)) {
      operatorItemMap.set(name, new Set());
    }
    operatorItemMap.get(name).add(key);
  });

  const operatorSummary = Array.from(operatorItemMap.entries())
    .map(([name, items]) => ({ name, count: items.size }))
    .filter((row) => row.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

  const locationSummaries = locations.map((location) => {
    const trackedCodes = new Set();
    const matchedRows = [];
    const unmatchedRows = [];
    const uncheckedRows = [];

    masterRows.forEach((master) => {
      const codeKey = normalizeItemCode(master.itemCode);
      if (!codeKey) return;
      const targetBottles = getMasterStockBottles(master, location);
      if (targetBottles <= 0) return;
      trackedCodes.add(codeKey);

      const key = `${location.id}|${codeKey}`;
      const row = rowsByLocationCode.get(key) || null;
      const name = buildDisplayName(
        row?.brandName || master.brandName,
        row?.packValue || master.packValue,
        row?.itemName || master.itemName,
        row?.itemCode || master.itemCode
      );

      if (!row) {
        uncheckedRows.push({ name, itemCode: master.itemCode });
      } else if (row.isMatched) {
        matchedRows.push({ name, itemCode: row.itemCode });
      } else {
        unmatchedRows.push({ name, itemCode: row.itemCode });
      }
    });

    latestRows.forEach((row) => {
      if (row.shopLocationId !== location.id) return;
      const codeKey = normalizeItemCode(row.itemCode);
      if (!codeKey || trackedCodes.has(codeKey)) return;
      const master = masterByCode.get(codeKey) || null;
      const name = buildDisplayName(
        row.brandName || master?.brandName,
        row.packValue || master?.packValue,
        row.itemName || master?.itemName,
        row.itemCode
      );
      if (row.isMatched) {
        matchedRows.push({ name, itemCode: row.itemCode });
      } else {
        unmatchedRows.push({ name, itemCode: row.itemCode });
      }
    });

    return {
      locationId: location.id,
      label: getLocationLabel(location),
      matched: matchedRows.length,
      unmatched: unmatchedRows.length,
      unchecked: uncheckedRows.length,
      matchedRows: sortNames(matchedRows),
      unmatchedRows: sortNames(unmatchedRows),
      uncheckedRows: sortNames(uncheckedRows),
    };
  });

  const nilLocationId = parseOptionalPositiveInt(shopInfo?.nilLocation);
  let nilCount = 0;
  const nilSummaryRows = [];
  if (nilLocationId) {
    const sourceLocation = locations.find((row) => row.id === nilLocationId) || null;
    if (sourceLocation) {
      const targets = locations.filter((row) => row.id !== nilLocationId);
      for (const target of targets) {
        let targetNilCount = 0;
        for (const master of allMasterRows) {
          const sourceBottles = getMasterStockBottles(master, sourceLocation);
          const targetBottles = getMasterStockBottles(master, target);
          if (sourceBottles > 0 && targetBottles <= 0) {
            nilCount += 1;
            targetNilCount += 1;
          }
        }
        nilSummaryRows.push({
          locationId: target.id,
          label: getLocationLabel(target),
          count: targetNilCount,
        });
      }
    }
  }

  const bestSellingCodes = new Set(
    bestSellingRows
      .map((row) => String(row.itemCode || "").trim().toLowerCase())
      .filter((code) => code && masterByCode.has(code))
  );
  const fastLocation =
    locations.find((row) =>
      String(row.locationType || row.locationName || "").toLowerCase().includes("shop")
    ) ||
    locations[0] ||
    null;
  let fastScanned = 0;
  if (fastLocation) {
    bestSellingCodes.forEach((code) => {
      const key = `${fastLocation.id}|${code}`;
      if (rowsByLocationCode.has(key)) {
        fastScanned += 1;
      }
    });
  }

  const locationById = new Map(locations.map((row) => [row.id, row]));
  const diffGrouped = new Map();

  diffItems.forEach((item) => {
    const diffValue = Number(item.diffBottles) || 0;
    if (diffValue === 0) return;
    const location = locationById.get(item.shopLocationId) || null;
    const locationLabel = getLocationLabel(location);
    const groupKey = String(item.shopLocationId || "0");
    if (!diffGrouped.has(groupKey)) {
      diffGrouped.set(groupKey, {
        locationId: item.shopLocationId,
        label: locationLabel,
        rows: [],
      });
    }

    const master = masterByCode.get(normalizeItemCode(item.itemCode)) || null;
    const displayName = buildDisplayName(
      item.brandName || master?.brandName,
      item.packValue || master?.packValue,
      item.itemName || master?.itemName,
      item.itemCode
    );

    diffGrouped.get(groupKey).rows.push({
      name: displayName,
      diffLabel: toSignedDiffLabel(diffValue),
      diffValue,
    });
  });

  const diffSections = Array.from(diffGrouped.values())
    .sort((a, b) => {
      const sortA = locationById.get(a.locationId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const sortB = locationById.get(b.locationId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (sortA !== sortB) return sortA - sortB;
      return String(a.label).localeCompare(String(b.label));
    })
    .map((section) => ({
      ...section,
      rows: section.rows.sort((a, b) => {
        const diffSort = Math.abs(Number(b.diffValue) || 0) - Math.abs(Number(a.diffValue) || 0);
        if (diffSort !== 0) return diffSort;
        return String(a.name).localeCompare(String(b.name));
      }),
    }));

  return {
    cycle,
    dayKey: dayRange.dayKey,
    shopName: String(shopInfo?.shopName || "").trim() || "Shop Name",
    phonesUsed: Array.from(phoneSet)
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    firstScanAt: scanTimes.length ? new Date(Math.min(...scanTimes.map((v) => new Date(v).getTime()))).toISOString() : null,
    lastScanAt: scanTimes.length ? new Date(Math.max(...scanTimes.map((v) => new Date(v).getTime()))).toISOString() : null,
    nilCount,
    nilSummaryRows,
    fastMovingSummary: {
      label: fastLocation ? getLocationLabel(fastLocation) : "SHOP",
      trackedProducts: bestSellingCodes.size,
      scannedProductCount: fastScanned,
    },
    locationSummaries,
    diffSections,
    operatorSummary,
    generatedAt: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    }),
  };
}

function getVerificationSections(dataset, filter) {
  const rowKey =
    filter === "matched"
      ? "matchedRows"
      : filter === "unmatched"
        ? "unmatchedRows"
        : "uncheckedRows";
  return dataset.locationSummaries.map((section) => ({
    label: section.label,
    rows: section[rowKey] || [],
  }));
}

async function printFullCycleVerification({ cycleId, endDate } = {}) {
  const resolvedCycle =
    cycleId != null
      ? await prisma.cycle.findUnique({ where: { id: Number(cycleId) } })
      : await prisma.cycle.findFirst({
          where: { status: "active" },
          orderBy: [{ startDate: "desc" }],
        });

  if (!resolvedCycle) {
    return {
      success: false,
      skipped: true,
      message: "Cycle not found. Print skipped.",
    };
  }

  const cycleRange = getUtcCycleRange(resolvedCycle, endDate);
  if (!cycleRange) {
    return {
      success: false,
      skipped: true,
      message: "Invalid cycle date range. Print skipped.",
    };
  }

  const printerRow = await prisma.printer.findFirst({
    where: { defaultPrinter: true },
    orderBy: [{ id: "asc" }],
  });

  if (!printerRow) {
    return {
      success: false,
      skipped: true,
      message: "No default printer selected. Print skipped.",
    };
  }

  try {
    const dataset = await buildVerificationDataset({
      cycleId: resolvedCycle.id,
      dayRange: cycleRange,
    });

    const reportHtml = generateVerificationReportHTML(dataset);
    const reportResult = await sendHtmlToPrinter(
      printerRow,
      reportHtml,
      `verification_report_${dataset.dayKey}`
    );

    const matchedSections = getVerificationSections(dataset, "matched");
    const matchedHtml = generateVerificationFilterReportHTML({
      dayKey: dataset.dayKey,
      filterLabel: "MATCHED",
      sections: matchedSections,
      generatedAt: dataset.generatedAt,
    });
    const matchedResult = await sendHtmlToPrinter(
      printerRow,
      matchedHtml,
      `verification_matched_${dataset.dayKey}`
    );

    const unmatchedSections = getVerificationSections(dataset, "unmatched");
    const unmatchedHtml = generateVerificationFilterReportHTML({
      dayKey: dataset.dayKey,
      filterLabel: "UNMATCHED",
      sections: unmatchedSections,
      generatedAt: dataset.generatedAt,
    });
    const unmatchedResult = await sendHtmlToPrinter(
      printerRow,
      unmatchedHtml,
      `verification_unmatched_${dataset.dayKey}`
    );

    const uncheckedSections = getVerificationSections(dataset, "unchecked");
    const uncheckedHtml = generateVerificationFilterReportHTML({
      dayKey: dataset.dayKey,
      filterLabel: "UNCHECKED",
      sections: uncheckedSections,
      generatedAt: dataset.generatedAt,
    });
    const uncheckedResult = await sendHtmlToPrinter(
      printerRow,
      uncheckedHtml,
      `verification_unchecked_${dataset.dayKey}`
    );

    const diffSections = Array.isArray(dataset.diffSections) ? dataset.diffSections : [];
    const diffHtml = generateDiffListReportHTML({
      dayKey: dataset.dayKey,
      sections: diffSections,
      generatedAt: dataset.generatedAt,
    });
    const diffResult = await sendHtmlToPrinter(
      printerRow,
      diffHtml,
      `verification_diff_${dataset.dayKey}`
    );

    return {
      success: true,
      skipped: false,
      message: "Full-cycle verification report + lists printed (including diff).",
      cycleId: resolvedCycle.id,
      dayKey: dataset.dayKey,
      printer: {
        id: printerRow.id,
        name: printerRow.name,
        ipAddress: printerRow.ipAddress,
        port: printerRow.port,
      },
      results: {
        report: reportResult,
        matched: matchedResult,
        unmatched: unmatchedResult,
        unchecked: uncheckedResult,
        diff: diffResult,
      },
    };
  } catch (error) {
    return {
      success: false,
      skipped: false,
      message: error instanceof Error ? error.message : "Failed to print full-cycle verification",
    };
  }
}

function getCycleDateLabel(cycle) {
  const date = new Date(cycle?.startDate || "");
  if (Number.isNaN(date.getTime())) {
    return String(cycle?.id || "");
  }
  return date.toISOString().slice(0, 10);
}

function getDifferenceLocationType(location) {
  const typeValue = String(location?.locationType || "");
  const nameValue = String(location?.locationName || "");
  const codeValue = String(location?.locationCode || "");
  return isGodownLike(typeValue) || isGodownLike(nameValue) || isGodownLike(codeValue)
    ? "godown"
    : "shop";
}

function toSignedDiffLabel(diffValue) {
  const numeric = Number(diffValue) || 0;
  if (numeric === 0) return "0";
  return numeric > 0 ? `+${numeric}` : `${numeric}`;
}

function sortDiffRowsByLocation(rows) {
  return [...rows].sort((a, b) => {
    const sortA = Number.isFinite(Number(a?.locationSortOrder))
      ? Number(a.locationSortOrder)
      : Number.MAX_SAFE_INTEGER;
    const sortB = Number.isFinite(Number(b?.locationSortOrder))
      ? Number(b.locationSortOrder)
      : Number.MAX_SAFE_INTEGER;
    if (sortA !== sortB) return sortA - sortB;

    const labelDiff = String(a?.locationLabel || "").localeCompare(String(b?.locationLabel || ""));
    if (labelDiff !== 0) return labelDiff;

    const magnitudeDiff = Math.abs(Number(b?.diff) || 0) - Math.abs(Number(a?.diff) || 0);
    if (magnitudeDiff !== 0) return magnitudeDiff;

    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

function buildLocationDiffSections(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const locationId = parseOptionalPositiveInt(row?.locationId) || 0;
    const groupKey = String(locationId);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        locationId,
        label: String(row?.locationLabel || "LOCATION").trim() || "LOCATION",
        sortOrder: Number.isFinite(Number(row?.locationSortOrder))
          ? Number(row.locationSortOrder)
          : Number.MAX_SAFE_INTEGER,
        rows: [],
        totalDiff: 0,
      });
    }

    const section = grouped.get(groupKey);
    section.rows.push(row);
    section.totalDiff += Number(row?.diff) || 0;
  });

  return Array.from(grouped.values())
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.label).localeCompare(String(b.label));
    })
    .map((section) => ({
      ...section,
      rows: sortDiffRowsByLocation(section.rows),
    }));
}

function toPrintJobToken(value) {
  const token = String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || "unknown";
}

function isDateWithinRange(value, dayRange) {
  if (!value || !dayRange) return false;
  const timeMs = new Date(value).getTime();
  if (!Number.isFinite(timeMs)) return false;
  return timeMs >= dayRange.dayStart.getTime() && timeMs <= dayRange.dayEnd.getTime();
}

function getUtcDayRangeFromValue(value) {
  const parsed = parseDate(value, null);
  if (!parsed) return null;
  return getUtcDayRange(parsed.toISOString().slice(0, 10));
}

function upsertTouchedOperator(map, rawName, itemKey) {
  const displayName = String(rawName || "Unknown").trim() || "Unknown";
  const key = displayName.toLowerCase();
  if (!map.has(key)) {
    map.set(key, {
      name: displayName,
      keys: new Set(),
    });
  }
  map.get(key).keys.add(itemKey);
}

function getRowUpdateTimeMs(row) {
  const value = row.updatedAt || row.finishedAt || row.createdAt || row.activityDate;
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function syncOperatorDailyMismatchSummaryTx(tx, { cycleId, operatorId, dayRange }) {
  const normalizedCycleId = parseOptionalPositiveInt(cycleId);
  const normalizedOperatorId = parseOptionalPositiveInt(operatorId);
  if (!normalizedCycleId || !normalizedOperatorId || !dayRange) return null;

  const rows = await tx.cycleFinishedStock.findMany({
    where: {
      cycleId: normalizedCycleId,
      activityDate: {
        gte: dayRange.dayStart,
        lte: dayRange.dayEnd,
      },
      diffBottles: { not: 0 },
      OR: [
        { lastUpdatedByWorkerId: normalizedOperatorId },
        { finishedByWorkerId: normalizedOperatorId },
      ],
    },
    select: {
      shopLocationId: true,
      itemCode: true,
      diffBottles: true,
      isMatched: true,
      activityDate: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const latestByKey = new Map();
  for (const row of rows) {
    const key = `${row.shopLocationId}|${String(row.itemCode || "").trim().toLowerCase()}`;
    if (!key) continue;
    const timeMs = getRowUpdateTimeMs(row);
    const existing = latestByKey.get(key);
    if (!existing || timeMs >= existing.timeMs) {
      latestByKey.set(key, { row, timeMs });
    }
  }

  const mismatchCount = Array.from(latestByKey.values()).reduce((count, entry) => {
    const diffValue = Number(entry.row.diffBottles || 0);
    const hasMismatch = diffValue !== 0 || !entry.row.isMatched;
    return hasMismatch ? count + 1 : count;
  }, 0);

  await tx.operatorDailyMismatchSummary.upsert({
    where: {
      cycleId_operatorId_activityDate: {
        cycleId: normalizedCycleId,
        operatorId: normalizedOperatorId,
        activityDate: dayRange.dayStart,
      },
    },
    create: {
      cycleId: normalizedCycleId,
      operatorId: normalizedOperatorId,
      activityDate: dayRange.dayStart,
      mismatchCount,
    },
    update: {
      mismatchCount,
    },
  });

  return {
    cycleId: normalizedCycleId,
    operatorId: normalizedOperatorId,
    activityDate: dayRange.dayKey,
    mismatchCount,
  };
}

async function syncDailyMismatchSummariesForRowsTx(tx, { cycleId, rows, preferredOperatorId }) {
  const normalizedCycleId = parseOptionalPositiveInt(cycleId);
  if (!normalizedCycleId) return [];
  const inputRows = Array.isArray(rows) ? rows : [];
  if (inputRows.length === 0) return [];

  const targets = new Map();
  for (const row of inputRows) {
    const dayRange = getUtcDayRangeFromValue(row.activityDate);
    if (!dayRange) continue;

    const operatorIds = new Set();
    const preferred = parseOptionalPositiveInt(preferredOperatorId);
    const updatedBy = parseOptionalPositiveInt(row.lastUpdatedByWorkerId);
    const finishedBy = parseOptionalPositiveInt(row.finishedByWorkerId);
    if (preferred) operatorIds.add(preferred);
    if (updatedBy) operatorIds.add(updatedBy);
    if (finishedBy) operatorIds.add(finishedBy);

    for (const operatorId of operatorIds) {
      const key = `${operatorId}|${dayRange.dayKey}`;
      if (!targets.has(key)) {
        targets.set(key, { operatorId, dayRange });
      }
    }
  }

  const summaries = [];
  for (const target of targets.values()) {
    const summary = await syncOperatorDailyMismatchSummaryTx(tx, {
      cycleId: normalizedCycleId,
      operatorId: target.operatorId,
      dayRange: target.dayRange,
    });
    if (summary) summaries.push(summary);
  }
  return summaries;
}

async function buildDifferenceDataset({ cycleId, dayRange, scope }) {
  const cycle =
    cycleId != null
      ? await prisma.cycle.findUnique({ where: { id: cycleId } })
      : await prisma.cycle.findFirst({
          where: { status: "active" },
          orderBy: [{ startDate: "desc" }],
        });
  if (!cycle) {
    throw new Error("No active/current cycle found");
  }

  const [locations, workers, masterRows, finishedRows] =
    await Promise.all([
      prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      prisma.worker.findMany({ orderBy: [{ name: "asc" }] }),
      loadMasterProducts({ includeAll: true }),
      prisma.cycleFinishedStock.findMany({
        where: { cycleId: cycle.id },
      }),
    ]);

  const locationById = new Map(locations.map((row) => [row.id, row]));
  const masterByCode = new Map(
    masterRows.map((row) => [String(row.itemCode || "").trim().toLowerCase(), row])
  );
  const workerNameById = new Map(
    workers.map((row) => [row.id, String(row.name || "").trim() || "Unknown"])
  );

  const operatorTouchedTotal = new Map();
  const operatorTouchedToday = new Map();

  const stateByKey = new Map();
  const upsertState = (itemKey, next) => {
    const existing = stateByKey.get(itemKey);
    if (!existing || next.updatedAtMs >= existing.updatedAtMs) {
      stateByKey.set(itemKey, next);
    } else if (existing && next.hasTodayActivity) {
      existing.hasTodayActivity = true;
    }
  };

  for (const row of finishedRows) {
    const codeKey = normalizeItemCode(row.itemCode);
    if (!codeKey || !row.shopLocationId) continue;
    if (!masterByCode.has(codeKey)) continue;

    const itemKey = `${row.shopLocationId}|${codeKey}`;
    const location = locationById.get(row.shopLocationId) || null;
    const sectionType = getDifferenceLocationType(location);
    const locationLabel = getLocationLabel(location);
    const locationSortOrder = location?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const master = masterByCode.get(codeKey) || null;
    const scanned = Number(row.quantityBottles || 0);
    const currentStockBottles = Number(row.currentStockBottles || 0);
    const diffBottles = Number(row.diffBottles || 0);
    const updatedAtRaw = row.finishedAt || row.updatedAt || row.createdAt || row.activityDate;
    const updatedAtMs = new Date(updatedAtRaw || 0).getTime();
    const hasTodayActivity =
      isDateWithinRange(row.activityDate, dayRange) ||
      isDateWithinRange(row.finishedAt, dayRange) ||
      isDateWithinRange(row.updatedAt, dayRange);

    const operatorName =
      workerNameById.get(row.lastUpdatedByWorkerId || row.finishedByWorkerId) || "Unknown";
    upsertTouchedOperator(operatorTouchedTotal, operatorName, itemKey);
    if (hasTodayActivity) {
      upsertTouchedOperator(operatorTouchedToday, operatorName, itemKey);
    }

    upsertState(itemKey, {
      key: itemKey,
      itemCode: row.itemCode,
      shopLocationId: row.shopLocationId,
      sectionType,
      locationLabel,
      locationSortOrder,
      name: buildDisplayName(
        row.brandName || master?.brandName,
        row.packValue || master?.packValue,
        row.itemName || master?.itemName,
        row.itemCode || master?.itemCode
      ),
      currentStock: Math.trunc(currentStockBottles),
      scanned: Math.trunc(scanned),
      diff: Math.trunc(diffBottles),
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
      hasTodayActivity,
      workerId:
        row.lastUpdatedByWorkerId ||
        row.finishedByWorkerId || null,
    });
  }

  const sections = {
    shop: { title: "SHOP", items: [], totalDiff: 0 },
    godown: { title: "GODOWN", items: [], totalDiff: 0 },
  };

  for (const snapshot of stateByKey.values()) {
    if (scope === "today" && !snapshot.hasTodayActivity) {
      continue;
    }
    if (!snapshot.diff) {
      continue;
    }

    const sectionType = snapshot.sectionType === "godown" ? "godown" : "shop";
    sections[sectionType].items.push({
      locationId: snapshot.shopLocationId,
      locationLabel: snapshot.locationLabel,
      locationSortOrder: snapshot.locationSortOrder,
      name: snapshot.name,
      master: snapshot.currentStock,
      scanned: snapshot.scanned,
      diff: snapshot.diff,
      diffLabel: toSignedDiffLabel(snapshot.diff),
    });
    sections[sectionType].totalDiff += snapshot.diff;
  }
  sections.shop.items = sortDiffRowsByLocation(sections.shop.items);
  sections.godown.items = sortDiffRowsByLocation(sections.godown.items);
  const locationSections = buildLocationDiffSections([
    ...sections.shop.items,
    ...sections.godown.items,
  ]);

  const operatorTouchedSource = scope === "today" ? operatorTouchedToday : operatorTouchedTotal;
  if (operatorTouchedSource.size === 0) {
    for (const snapshot of stateByKey.values()) {
      if (scope === "today" && !snapshot.hasTodayActivity) continue;
      const fallbackName = workerNameById.get(snapshot.workerId) || "Unknown";
      upsertTouchedOperator(operatorTouchedSource, fallbackName, snapshot.key);
    }
  }

  const operators = Array.from(operatorTouchedSource.values())
    .map((entry) => {
      const bucket = {
        name: entry.name,
        touchedCount: 0,
        diffItemCount: 0,
        shopDiff: 0,
        godownDiff: 0,
        totalDiff: 0,
        items: [],
      };

      for (const itemKey of entry.keys) {
        const snapshot = stateByKey.get(itemKey);
        if (!snapshot) continue;
        if (scope === "today" && !snapshot.hasTodayActivity) continue;

        bucket.touchedCount += 1;
        if (!snapshot.diff) continue;

        bucket.diffItemCount += 1;
        bucket.totalDiff += snapshot.diff;
        if (snapshot.sectionType === "godown") {
          bucket.godownDiff += snapshot.diff;
        } else {
          bucket.shopDiff += snapshot.diff;
        }

        bucket.items.push({
          locationId: snapshot.shopLocationId,
          name: snapshot.name,
          location: snapshot.locationLabel,
          locationLabel: snapshot.locationLabel,
          locationSortOrder: snapshot.locationSortOrder,
          master: snapshot.currentStock,
          scanned: snapshot.scanned,
          diff: snapshot.diff,
          diffLabel: toSignedDiffLabel(snapshot.diff),
        });
      }

      return bucket;
    })
    .filter((row) => row.touchedCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  operators.forEach((operator) => {
    operator.items = sortDiffRowsByLocation(operator.items);
    operator.locationSections = buildLocationDiffSections(operator.items);
  });

  const summary = operators.reduce(
    (acc, operator) => {
      acc.operatorCount += 1;
      acc.touchedCount += operator.touchedCount;
      acc.diffItemCount += operator.diffItemCount;
      acc.shopDiff += operator.shopDiff;
      acc.godownDiff += operator.godownDiff;
      acc.totalDiff += operator.totalDiff;
      return acc;
    },
    {
      operatorCount: 0,
      touchedCount: 0,
      diffItemCount: 0,
      shopDiff: 0,
      godownDiff: 0,
      totalDiff: 0,
    }
  );

  return {
    cycle,
    cycleDate: getCycleDateLabel(cycle),
    todayDate: dayRange.dayKey,
    scope,
    sections,
    locationSections,
    operatorDiffData: {
      operators,
      summary,
    },
  };
}

function generateDifferenceReportHTML(data) {
  const { cycleDate, scope, todayDate, sections, locationSections = [] } = data;
  const scopeLabel = scope === "total" ? "TOTAL DIFF" : "TODAY DIFF";
  const scopeInfo =
    scope === "total"
      ? `All cycle items (${cycleDate})`
      : `Only today's diff items (${todayDate})`;

  const renderSection = (section) => {
    const items = Array.isArray(section?.rows) ? section.rows : [];
    if (items.length === 0) {
      return `
        <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
          <span>${section.label}</span>
          <span>0</span>
        </div>
        <div style="font-size: 12px; margin: 4px 0;">No diff items</div>
        <div class="separator"></div>
      `;
    }

    return `
      <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
        <span>${section.label}</span>
        <span>Items: ${items.length} | Total: ${
      section.totalDiff > 0 ? `+${section.totalDiff}` : section.totalDiff
    }</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 72%;">Name</th>
            <th style="width: 28%;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
            <tr>
              <td>${item.name}</td>
              <td>${item.diffLabel ?? (item.diff > 0 ? `+${item.diff}` : item.diff ?? 0)}</td>
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

  ${
    locationSections.length > 0
      ? locationSections.map((section) => renderSection(section)).join("")
      : [sections.shop, sections.godown].map((section) => ({
          label: section.title,
          rows: section.items,
          totalDiff: section.totalDiff,
        }))
        .map((section) => renderSection(section))
        .join("")
  }

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}
  </div>
</body>
</html>
  `;
}

function generateOperatorDifferenceIndividualHTML(data) {
  const { cycleDate, todayDate, scope = "today", operator } = data;
  const locationSections = Array.isArray(operator?.locationSections) ? operator.locationSections : [];
  const scopeLabel = scope === "total" ? "Whole Cycle" : "Today";
  const oneLineSummary = `Summary: Products ${operator?.touchedCount || 0} | Diff Items ${
    operator?.diffItemCount || 0
  } | Shop ${operator?.shopDiff > 0 ? `+${operator.shopDiff}` : operator?.shopDiff || 0} | Godown ${
    operator?.godownDiff > 0 ? `+${operator.godownDiff}` : operator?.godownDiff || 0
  }`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Person Diff - ${operator?.name || "Unknown"}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold; color: black; }
    body { font-family: 'Roboto Condensed', sans-serif; font-size: 13px; line-height: 1.1; padding: 6px; max-width: 296px; background: white; }
    .center { text-align: center; }
    .separator { border-bottom: 2px solid #000; margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 3px 0; table-layout: fixed; }
    th { padding: 2px 1px; text-align: left; border-bottom: 1px solid #000; font-size: 11px; }
    td { padding: 1px 1px; text-align: left; border: none; word-wrap: break-word; word-break: break-word; white-space: normal; font-size: 10px; }
    .line { margin: 2px 0; font-size: 12px; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">PERSON DIFF</div>
    <div>${cycleDate}</div>
  </div>
  <div class="separator"></div>
  <div class="line">Name: ${operator?.name || "Unknown"}</div>
  <div class="line">Scope: ${scopeLabel}</div>
  <div class="line">Date: ${todayDate}</div>
  <div class="line">${oneLineSummary}</div>
  <div class="separator"></div>
  ${
    locationSections.length === 0
      ? `<div class="line">No diff items for this person.</div>`
      : locationSections
          .map(
            (section) => `
      <div class="line" style="font-size: 13px;">${section.label} | Items ${section.rows.length} | Total ${
              section.totalDiff > 0 ? `+${section.totalDiff}` : section.totalDiff
            }</div>
      <table>
        <thead>
          <tr>
            <th style="width: 78%;">Name</th>
            <th style="width: 22%;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${section.rows
            .map(
              (item) => `
            <tr>
              <td>${item.name}</td>
              <td>${item.diffLabel}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      <div class="separator"></div>
        `
          )
          .join("")
  }
  <div class="center" style="font-size: 11px;">
    Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
  </div>
</body>
</html>
  `;
}

function generateOperatorDifferenceCommonHTML(data) {
  const { cycleDate, todayDate, scope = "today", operators = [], summary = {} } = data;
  const scopeLabel = scope === "total" ? "Whole Cycle" : "Today";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Common Person Diff - ${cycleDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold; color: black; }
    body { font-family: 'Roboto Condensed', sans-serif; font-size: 13px; line-height: 1.1; padding: 6px; max-width: 296px; background: white; }
    .center { text-align: center; }
    .separator { border-bottom: 2px solid #000; margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 3px 0; table-layout: fixed; }
    th { padding: 2px 1px; text-align: left; border-bottom: 1px solid #000; font-size: 11px; }
    td { padding: 1px 1px; text-align: left; border: none; word-wrap: break-word; word-break: break-word; white-space: normal; font-size: 10px; }
    .line { margin: 2px 0; font-size: 12px; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">COMMON PERSON DIFF</div>
    <div>${cycleDate}</div>
  </div>
  <div class="separator"></div>
  <div class="line">Scope: ${scopeLabel}</div>
  <div class="line">Date: ${todayDate}</div>
  <div class="line">
    Common Summary: People ${summary.operatorCount || 0} | Products ${summary.touchedCount || 0} | Diff Items ${
    summary.diffItemCount || 0
  } | Shop ${summary.shopDiff > 0 ? `+${summary.shopDiff}` : summary.shopDiff || 0} | Godown ${
    summary.godownDiff > 0 ? `+${summary.godownDiff}` : summary.godownDiff || 0
  }
  </div>
  <div class="separator"></div>
  ${
    operators.length === 0
      ? `<div class="line">No operator data found.</div>`
      : `
    <table>
      <thead>
        <tr>
          <th style="width: 40%;">Name</th>
          <th style="width: 15%;">Prod</th>
          <th style="width: 15%;">Items</th>
          <th style="width: 15%;">Shop</th>
          <th style="width: 15%;">Godown</th>
        </tr>
      </thead>
      <tbody>
        ${operators
          .map(
            (operator) => `
          <tr>
            <td>${operator.name}</td>
            <td>${operator.touchedCount}</td>
            <td>${operator.diffItemCount}</td>
            <td>${operator.shopDiff > 0 ? `+${operator.shopDiff}` : operator.shopDiff}</td>
            <td>${operator.godownDiff > 0 ? `+${operator.godownDiff}` : operator.godownDiff}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `
  }
  <div class="separator"></div>
  <div class="center" style="font-size: 11px;">
    Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
  </div>
</body>
</html>
  `;
}

function generateFinishReportHTML(data) {
  const { cycleDate, operatorName, todayMismatchCount = 0, todayMismatchDate = "", generatedAt, sections = [] } = data;
  const operatorLabel = String(operatorName || "Unknown").trim() || "Unknown";

  const sectionHtml = sections
    .map((section) => {
      const rows = Array.isArray(section.rows) ? section.rows : [];
      const count = rows.length;
      return `
      <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
        <span>${section.label}</span>
        <span>${count}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 82%;">Name</th>
            <th style="width: 18%;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length > 0
              ? rows
                  .map(
                    (item) => `
            <tr>
              <td>${item.name}</td>
              <td>${item.diffLabel}</td>
            </tr>
          `
                  )
                  .join("")
              : `<tr><td colspan="2">No items moved</td></tr>`
          }
        </tbody>
      </table>
      <div class="separator"></div>
    `;
    })
    .join("");

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
    <span>Operator: ${operatorLabel} (${todayMismatchCount})</span>
  </div>
  <div class="header-line">
    <span>Today Mismatch Total: ${todayMismatchCount}${todayMismatchDate ? ` (${todayMismatchDate})` : ""}</span>
  </div>

  <div class="separator"></div>

  ${sectionHtml || `<div class="header-line"><span>No items moved</span></div><div class="separator"></div>`}

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${generatedAt}
  </div>
</body>
</html>
  `;
}

function generateDiffBatchReportHTML(data) {
  const {
    batchId,
    cycleDate,
    locationLabel,
    createdAt,
    createdByName,
    proofImagePath,
    totalItems,
    totalDiff,
    sections = [],
  } = data;

  const sectionsHtml = sections
    .map((section) => {
      const rows = Array.isArray(section.rows) ? section.rows : [];
      return `
      <div style="font-size: 13px; font-weight: 900; margin: 3px 0; display: flex; justify-content: space-between;">
        <span>${section.label}</span>
        <span>${rows.length}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 82%;">Item</th>
            <th style="width: 18%;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length > 0
              ? rows
                  .map(
                    (item) => `
            <tr>
              <td>${item.name}</td>
              <td>${item.diffLabel}</td>
            </tr>
          `
                  )
                  .join("")
              : `<tr><td colspan="2">No items</td></tr>`
          }
        </tbody>
      </table>
      <div class="separator"></div>
    `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Diff Batch Report - ${batchId}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold; color: black; }
    body { font-family: 'Roboto Condensed', sans-serif; font-size: 13px; line-height: 1.1; padding: 6px; max-width: 296px; background: white; }
    .center { text-align: center; }
    .header-line { display: flex; justify-content: space-between; margin: 3px 0; font-size: 13px; }
    .separator { border-bottom: 2px solid #000; margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 3px 0; table-layout: fixed; }
    th { padding: 2px 1px; text-align: left; border-bottom: 1px solid #000; font-size: 13px; }
    td { padding: 1px 1px; text-align: left; border: none; word-wrap: break-word; word-break: break-word; white-space: normal; font-size: 11px; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">DIFF BATCH REPORT</div>
    <div>Batch #${batchId}</div>
  </div>
  <div class="separator"></div>
  <div class="header-line"><span>Cycle</span><span>${cycleDate}</span></div>
  <div class="header-line"><span>Location</span><span>${locationLabel}</span></div>
  <div class="header-line"><span>Created</span><span>${createdAt}</span></div>
  <div class="header-line"><span>By</span><span>${createdByName}</span></div>
  <div class="header-line"><span>Total Items</span><span>${totalItems}</span></div>
  <div class="header-line"><span>Total Diff</span><span>${totalDiff}</span></div>
  ${
    proofImagePath
      ? `<div class="header-line"><span>Proof</span><span>${proofImagePath}</span></div>`
      : ""
  }
  <div class="separator"></div>
  ${sectionsHtml}
  <div class="center" style="font-size: 11px;">Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
</body>
</html>
  `;
}

async function buildFinishReportDataset({
  cycleId,
  operatorId,
  movedUnfinishedRows,
}) {
  const movedRows = Array.isArray(movedUnfinishedRows) ? movedUnfinishedRows : [];
  const todayRange = getUtcDayRange(new Date().toISOString().slice(0, 10));
  const [cycle, operator, locations, mismatchSummary] = await Promise.all([
    prisma.cycle.findUnique({ where: { id: cycleId } }),
    operatorId ? prisma.worker.findUnique({ where: { id: operatorId } }) : null,
    prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    operatorId && todayRange
      ? prisma.operatorDailyMismatchSummary.findUnique({
          where: {
            cycleId_operatorId_activityDate: {
              cycleId: Number(cycleId),
              operatorId: Number(operatorId),
              activityDate: todayRange.dayStart,
            },
          },
        })
      : null,
  ]);

  const locationById = new Map(locations.map((row) => [row.id, row]));
  const grouped = new Map();

  for (const row of movedRows) {
    const diffValue = Number(row.diffBottles) || 0;
    if (diffValue === 0) {
      continue;
    }

    const location = locationById.get(row.shopLocationId) || null;
    const locationLabel = getLocationLabel(location);
    const groupKey = String(row.shopLocationId || "0");

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        locationId: row.shopLocationId,
        label: locationLabel,
        rows: [],
      });
    }

    const displayName = buildDisplayName(
      row.brandName,
      row.packValue,
      row.itemName,
      row.itemCode
    );
    grouped.get(groupKey).rows.push({
      name: displayName,
      diffLabel: toSignedDiffLabel(diffValue),
      diffValue,
    });
  }

  const sections = Array.from(grouped.values())
    .sort((a, b) => {
      const sortA = locationById.get(a.locationId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const sortB = locationById.get(b.locationId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (sortA !== sortB) return sortA - sortB;
      return String(a.label).localeCompare(String(b.label));
    })
    .map((section) => ({
      ...section,
      rows: section.rows.sort((a, b) => {
        const diffSort = Math.abs(Number(b.diffValue) || 0) - Math.abs(Number(a.diffValue) || 0);
        if (diffSort !== 0) return diffSort;
        return String(a.name).localeCompare(String(b.name));
      }),
    }));

  return {
    cycleDate: getCycleDateLabel(cycle || { id: cycleId, startDate: new Date().toISOString() }),
    operatorName: String(operator?.name || "").trim() || "Unknown",
    todayMismatchDate: todayRange?.dayKey || "",
    todayMismatchCount: Number(mismatchSummary?.mismatchCount || 0),
    generatedAt: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    }),
    sections,
  };
}

async function buildDiffBatchReportDataset(batchId) {
  const batch = await prisma.diffBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    include: {
      items: { where: { deletedAt: null } },
      cycle: true,
      shopLocation: true,
      createdBy: true,
    },
  });

  if (!batch) {
    throw new Error("Diff batch not found");
  }

  const locationLabel = getLocationLabel(batch.shopLocation);
  const cycleDate = getCycleDateLabel(batch.cycle || { id: batch.cycleId, startDate: new Date().toISOString() });
  const createdAt = new Date(batch.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const createdByName = String(batch.createdBy?.name || "Unknown").trim() || "Unknown";

  const totalItems = batch.items.length;
  const totalDiff = batch.items.reduce((sum, row) => sum + (Number(row.diffBottles) || 0), 0);

  const grouped = new Map();
  for (const item of batch.items) {
    const brandLabel = String(item.brandName || "Unknown").trim() || "Unknown";
    const packLabel = formatPackLabel(item.packValue);
    const itemLabel = String(item.itemName || item.itemCode || "").trim() || item.itemCode || "-";
    const name = `${itemLabel}${packLabel ? ` ${packLabel}` : ""}`.trim();
    const diffLabel = toSignedDiffLabel(item.diffBottles);
    if (!grouped.has(brandLabel)) {
      grouped.set(brandLabel, []);
    }
    grouped.get(brandLabel).push({ name, diffLabel });
  }

  const sections = Array.from(grouped.entries())
    .map(([label, rows]) => ({
      label,
      rows: rows.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  return {
    batchId: batch.id,
    cycleDate,
    locationLabel,
    createdAt,
    createdByName,
    proofImagePath: batch.proofImagePath || "",
    totalItems,
    totalDiff: toSignedDiffLabel(totalDiff),
    sections,
  };
}

async function moveUnfinishedToFinished(tx, unfinished, finishedByWorkerId, eventAction = "finish") {
  const normalizedFinishedByWorkerId = parseOptionalPositiveInt(finishedByWorkerId);

  const finished = await tx.cycleFinishedStock.upsert({
    where: {
      cycleId_itemCode_shopLocationId_activityDate: {
        cycleId: unfinished.cycleId,
        itemCode: unfinished.itemCode,
        shopLocationId: unfinished.shopLocationId,
        activityDate: unfinished.activityDate,
      },
    },
    create: {
      cycleId: unfinished.cycleId,
      itemCode: unfinished.itemCode,
      itemName: unfinished.itemName,
      brandName: unfinished.brandName,
      packValue: unfinished.packValue,
      bpc: unfinished.bpc,
      mrp: unfinished.mrp,
      barcode: unfinished.barcode,
      phoneId: unfinished.phoneId,
      phoneName: null,
      shopLocationId: unfinished.shopLocationId,
      activityDate: unfinished.activityDate,
      quantityBottles: unfinished.quantityBottles,
      currentStockBottles: unfinished.currentStockBottles,
      diffBottles: unfinished.diffBottles,
      isMatched: unfinished.isMatched,
      matchedAt: unfinished.isMatched ? new Date() : null,
      lastUpdatedByWorkerId: unfinished.lastUpdatedByWorkerId,
      finishedByWorkerId: normalizedFinishedByWorkerId,
      sourceUnfinishedId: unfinished.id,
    },
    update: {
      quantityBottles: unfinished.quantityBottles,
      currentStockBottles: unfinished.currentStockBottles,
      diffBottles: unfinished.diffBottles,
      isMatched: unfinished.isMatched,
      matchedAt: unfinished.isMatched ? new Date() : null,
      phoneId: unfinished.phoneId,
      phoneName: null,
      lastUpdatedByWorkerId: unfinished.lastUpdatedByWorkerId,
      finishedByWorkerId: normalizedFinishedByWorkerId,
      sourceUnfinishedId: unfinished.id,
    },
  });

  await tx.cycleProductEvent.create({
    data: {
      cycleId: unfinished.cycleId,
      itemCode: unfinished.itemCode,
      itemName: unfinished.itemName,
      brandName: unfinished.brandName,
      packValue: unfinished.packValue,
      shopLocationId: unfinished.shopLocationId,
      cycleFinishedId: finished.id,
      cycleUnfinishedId: unfinished.id,
      activityDate: unfinished.activityDate,
      eventScope: "finished",
      eventAction,
      matched: unfinished.isMatched,
      stockBottlesAfter: unfinished.quantityBottles,
      currentStockBottles: unfinished.currentStockBottles,
      diffBottles: unfinished.diffBottles,
      workerId: normalizedFinishedByWorkerId || unfinished.lastUpdatedByWorkerId,
      phoneId: unfinished.phoneId,
      phoneName: null,
      changesJson: JSON.stringify({ action: "move_unfinished_to_finished" }),
    },
  });

  await tx.cycleUnfinishedStock.delete({ where: { id: unfinished.id } });
  return { finished, unfinishedId: unfinished.id };
}

router.get("/unfinished", async (req, res) => {
  const cycleId = Number(req.query.cycleId);
  const shopLocationId = Number(req.query.shopLocationId);
  if (!cycleId) {
    return res.status(400).json({ success: false, message: "cycleId is required" });
  }
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const [location, rows, masterRows] = await Promise.all([
    prisma.shopLocation.findUnique({ where: { id: shopLocationId } }),
    prisma.cycleUnfinishedStock.findMany({
      where: { cycleId, shopLocationId },
      orderBy: [{ activityDate: "desc" }, { id: "desc" }],
    }),
    loadMasterProducts({ includeAll: true }),
  ]);
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }
  const eligibleMasterRows = masterRows.filter((row) => hasPositiveStockForLocation(row, location));
  const masterCodeSet = new Set(
    eligibleMasterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean)
  );
  const filteredRows = rows.filter((row) => masterCodeSet.has(normalizeItemCode(row.itemCode)));
  return res.json({ success: true, count: filteredRows.length, rows: filteredRows });
});

router.get("/unfinished/by-operator", async (req, res) => {
  const cycleId = Number(req.query.cycleId);
  const operatorId = Number(req.query.operatorId);
  const shopLocationId = Number(req.query.shopLocationId);
  if (!cycleId || !operatorId || !shopLocationId) {
    return res.status(400).json({
      success: false,
      message: "cycleId, operatorId and shopLocationId are required",
    });
  }

  const [location, rows, masterRows] = await Promise.all([
    prisma.shopLocation.findUnique({ where: { id: shopLocationId } }),
    prisma.cycleUnfinishedStock.findMany({
      where: {
        cycleId,
        lastUpdatedByWorkerId: operatorId,
        shopLocationId,
      },
      orderBy: [{ activityDate: "desc" }, { id: "desc" }],
    }),
    loadMasterProducts({ includeAll: true }),
  ]);
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }
  const eligibleMasterRows = masterRows.filter((row) => hasPositiveStockForLocation(row, location));
  const masterCodeSet = new Set(
    eligibleMasterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean)
  );
  const filteredRows = rows.filter((row) => masterCodeSet.has(normalizeItemCode(row.itemCode)));

  return res.json({ success: true, count: filteredRows.length, rows: filteredRows });
});

router.get("/finished", async (req, res) => {
  const cycleId = Number(req.query.cycleId);
  const shopLocationId = Number(req.query.shopLocationId);
  if (!cycleId) {
    return res.status(400).json({ success: false, message: "cycleId is required" });
  }
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const [location, rows, masterRows] = await Promise.all([
    prisma.shopLocation.findUnique({ where: { id: shopLocationId } }),
    prisma.cycleFinishedStock.findMany({
      where: { cycleId, shopLocationId },
      orderBy: [{ activityDate: "desc" }, { id: "desc" }],
    }),
    loadMasterProducts({ includeAll: true }),
  ]);
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }
  const eligibleMasterRows = masterRows.filter((row) => hasPositiveStockForLocation(row, location));
  const masterCodeSet = new Set(
    eligibleMasterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean)
  );
  const filteredRows = rows.filter((row) => masterCodeSet.has(normalizeItemCode(row.itemCode)));
  return res.json({ success: true, count: filteredRows.length, rows: filteredRows });
});

router.get("/finished/progress", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  const requestedCycleId = parseOptionalPositiveInt(req.query.cycleId);

  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const cycle =
    requestedCycleId != null
      ? await prisma.cycle.findUnique({ where: { id: requestedCycleId } })
      : await prisma.cycle.findFirst({
          where: { status: "active" },
          orderBy: [{ startDate: "desc" }],
        });
  if (!cycle) {
    return res.status(404).json({ success: false, message: "No active/current cycle found" });
  }

  const location = await prisma.shopLocation.findUnique({ where: { id: shopLocationId } });
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  const [finishedRows, masterRows] = await Promise.all([
    prisma.cycleFinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId,
      },
      select: {
        itemCode: true,
      },
    }),
    loadMasterProducts({ includeAll: true }),
  ]);
  const eligibleMasterRows = masterRows.filter((row) => hasPositiveStockForLocation(row, location));

  const scannedCodeSet = new Set(
    finishedRows
      .map((row) => normalizeItemCode(row.itemCode))
      .filter(Boolean)
  );

  const totalCodeSet = new Set();
  for (const master of eligibleMasterRows) {
    const code = normalizeItemCode(master.itemCode);
    if (!code || totalCodeSet.has(code)) continue;
    totalCodeSet.add(code);
  }

  const scannedCount = Array.from(scannedCodeSet).filter((code) => totalCodeSet.has(code)).length;
  const totalProducts = totalCodeSet.size;
  const remainingCount = Math.max(totalProducts - scannedCount, 0);

  return res.json({
    success: true,
    cycleId: cycle.id,
    cycleDate: getCycleDateLabel(cycle),
    shopLocationId,
    locationLabel: getLocationLabel(location),
    scannedCount,
    totalProducts,
    remainingCount,
    progressLabel: `${scannedCount}/${totalProducts}`,
  });
});

router.get("/verify/mismatched-finished", async (req, res) => {
  const operatorId = parseOptionalPositiveInt(req.query.operatorId);
  const cycleId = parseOptionalPositiveInt(req.query.cycleId);
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);

  const cycle =
    cycleId != null
      ? await prisma.cycle.findUnique({ where: { id: cycleId } })
      : await prisma.cycle.findFirst({
          where: { status: "active" },
          orderBy: [{ startDate: "desc" }],
        });
  if (!cycle) {
    return res.status(404).json({ success: false, message: "No active/current cycle found" });
  }

  const [locations, masterRows, finishedRows] = await Promise.all([
    prisma.shopLocation.findMany({
      ...(shopLocationId ? { where: { id: shopLocationId } } : {}),
    }),
    loadMasterProducts({ includeAll: true }),
    prisma.cycleFinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        isMatched: false,
        ...(shopLocationId ? { shopLocationId } : {}),
        ...(operatorId
          ? { OR: [{ lastUpdatedByWorkerId: operatorId }, { finishedByWorkerId: operatorId }] }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const locationById = new Map(locations.map((row) => [row.id, row]));

  // Keep latest mismatched row per item per location for this operator in this cycle.
  const dedupMap = new Map();
  for (const row of finishedRows) {
    const codeKey = normalizeItemCode(row.itemCode);
    const location = locationById.get(row.shopLocationId) || null;
    const master =
      masterRows.find(
        (candidate) =>
          normalizeItemCode(candidate.itemCode) === codeKey &&
          hasMatchingLocationStockColumn(candidate, location)
      ) || null;
    if (!codeKey || !master) continue;
    const key = `${row.shopLocationId}|${codeKey}`;
    if (!dedupMap.has(key)) {
      dedupMap.set(key, row);
    }
  }

  const rows = Array.from(dedupMap.values())
    .map((row) => {
      const location = locationById.get(row.shopLocationId) || null;
      const master =
        masterRows.find(
          (candidate) =>
            normalizeItemCode(candidate.itemCode) === normalizeItemCode(row.itemCode) &&
            hasMatchingLocationStockColumn(candidate, location)
        ) || null;
      const safeBpc = Number(row.bpc || master?.bpc) || 12;
      const enteredBottles = Number(row.quantityBottles || 0);
      const currentStockBottles = Number(row.currentStockBottles || 0);
      const diffBottles = Number(row.diffBottles || 0);

      return {
        id: row.id,
        cycleId: row.cycleId,
        itemCode: row.itemCode,
        itemName: row.itemName || master?.itemName || "",
        brandName: row.brandName || master?.brandName || "",
        packValue: row.packValue || master?.packValue || "",
        bpc: safeBpc,
        mrp: row.mrp ?? master?.mrp ?? null,
        shopLocationId: row.shopLocationId,
        shopLocationName: location?.locationName || "",
        activityDate: row.activityDate,
        updatedAt: row.updatedAt,
        enteredBottles,
        enteredFormatted: formatBottleCountAsStock(enteredBottles, safeBpc),
        currentStockBottles,
        currentStockFormatted: formatBottleCountAsStock(currentStockBottles, safeBpc),
        diffBottles,
        diffFormatted: formatBottleCountAsStock(diffBottles, safeBpc, true),
      };
    })
    .sort((a, b) => {
      const byTime = new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      if (byTime !== 0) return byTime;
      return String(a.brandName || "").localeCompare(String(b.brandName || ""));
    });

  return res.json({
    success: true,
    cycleId: cycle.id,
    cycleStatus: cycle.status,
    operatorId: operatorId || null,
    shopLocationId: shopLocationId || null,
    count: rows.length,
    rows,
  });
});

router.get("/verify/unchecked-finished", async (req, res) => {
  const cycleId = parseOptionalPositiveInt(req.query.cycleId);
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);

  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const cycle =
    cycleId != null
      ? await prisma.cycle.findUnique({ where: { id: cycleId } })
      : await prisma.cycle.findFirst({
          where: { status: "active" },
          orderBy: [{ startDate: "desc" }],
        });
  if (!cycle) {
    return res.status(404).json({ success: false, message: "No active/current cycle found" });
  }

  const [location, masterRows, finishedRows, unfinishedRows] = await Promise.all([
    prisma.shopLocation.findUnique({ where: { id: shopLocationId } }),
    loadMasterProducts({ includeAll: true }),
    prisma.cycleFinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId,
      },
      select: {
        itemCode: true,
      },
    }),
    prisma.cycleUnfinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId,
      },
      select: {
        itemCode: true,
      },
    }),
  ]);

  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }
  const eligibleMasterRows = masterRows.filter((row) => hasMatchingLocationStockColumn(row, location));

  const scannedCodeSet = new Set(
    finishedRows
      .map((row) => normalizeItemCode(row.itemCode))
      .filter(Boolean)
  );
  const unfinishedCodeSet = new Set(
    unfinishedRows
      .map((row) => normalizeItemCode(row.itemCode))
      .filter(Boolean)
  );

  const rows = [];
  const addedCodeSet = new Set();
  for (const master of eligibleMasterRows) {
    const codeKey = normalizeItemCode(master.itemCode);
    if (
      !codeKey ||
      addedCodeSet.has(codeKey) ||
      scannedCodeSet.has(codeKey) ||
      unfinishedCodeSet.has(codeKey)
    ) {
      continue;
    }
    addedCodeSet.add(codeKey);
    rows.push({
      itemCode: master.itemCode || "",
      itemName: master.itemName || "",
      brandName: master.brandName || "",
      packValue: master.packValue || "",
      bpc: Number(master.bpc) || null,
      mrp: master.mrp ?? null,
      barcode: master.barcode || "",
      cycleId: cycle.id,
      cycleStatus: cycle.status,
      shopLocationId,
      shopLocationName: getLocationLabel(location),
    });
  }

  return res.json({
    success: true,
    cycleId: cycle.id,
    cycleStatus: cycle.status,
    shopLocationId,
    shopLocationName: getLocationLabel(location),
    count: rows.length,
    rows,
  });
});

router.get("/diff-batches", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  const cycleId = parseOptionalPositiveInt(req.query.cycleId);
  const includeDeleted = ["true", "1", "yes"].includes(
    String(req.query?.includeDeleted || "").trim().toLowerCase()
  );

  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const where = {
    shopLocationId,
    ...(cycleId ? { cycleId } : {}),
  };

  const rows = await prisma.diffBatch.findMany({
    where: {
      ...where,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      items: {
        ...(includeDeleted ? {} : { where: { deletedAt: null } }),
        orderBy: [{ diffBottles: "desc" }, { itemCode: "asc" }, { id: "asc" }],
      },
      cycle: {
        select: { id: true, sno: true, startDate: true, endDate: true, status: true },
      },
      shopLocation: {
        select: { id: true, locationName: true, locationCode: true, locationColor: true },
      },
    },
  });

  return res.json({ success: true, count: rows.length, rows });
});

router.post("/diff-batches", async (req, res) => {
  const cycleId = parseOptionalPositiveInt(req.body?.cycleId);
  const shopLocationId = parseOptionalPositiveInt(req.body?.shopLocationId);
  const createdByWorkerId = parseOptionalPositiveInt(req.body?.createdByWorkerId);
  const sourceScopeRaw = String(req.body?.sourceScope || "").trim().toLowerCase();
  const proofImagePathInput = String(req.body?.proofImagePath || "").trim();
  const proofImageName = String(req.body?.proofImageName || "").trim();
  const proofImagePayload = parseProofImagePayload(req.body?.proofImageData);
  const proofImageData = proofImagePayload.base64Data;
  const proofImageMimeType = String(req.body?.proofImageMimeType || proofImagePayload.mimeType || "")
    .trim()
    .toLowerCase();

  if (!cycleId) {
    return res.status(400).json({ success: false, message: "cycleId is required" });
  }
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }
  const requestedScope = sourceScopeRaw || "finished";
  if (requestedScope !== "unfinished" && requestedScope !== "finished") {
    return res.status(400).json({ success: false, message: "sourceScope must be unfinished or finished" });
  }
  // Diff flow is based on finished rows; force finished scope to match current business logic.
  const sourceScope = "finished";

  const rawIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
  const itemIds = rawIds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.trunc(value));

  if (itemIds.length === 0) {
    return res.status(400).json({ success: false, message: "itemIds are required" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [cycle, location] = await Promise.all([
        tx.cycle.findUnique({ where: { id: cycleId } }),
        tx.shopLocation.findUnique({ where: { id: shopLocationId } }),
      ]);

      if (!cycle) {
        throw new Error("Cycle not found");
      }
      if (!location) {
        throw new Error("Shop location not found");
      }

      const batch = await tx.diffBatch.create({
        data: {
          cycleId,
          shopLocationId,
          createdByWorkerId: createdByWorkerId || null,
          proofImageName: proofImageName || null,
        },
      });

      const rows = await tx.cycleFinishedStock.findMany({
        where: {
          id: { in: itemIds },
          cycleId,
          shopLocationId,
        },
      });

      const unmatchedRows = rows.filter(
        (row) => Number(row.diffBottles || 0) !== 0 || !row.isMatched
      );

      if (unmatchedRows.length === 0) {
        throw new Error("No unmatched finished rows to move");
      }

      const diffItemsData = unmatchedRows.map((row) => ({
        diffBatchId: batch.id,
        sourceScope,
        sourceUnfinishedId: row.sourceUnfinishedId || null,
        sourceFinishedId: row.id,
        cycleId: row.cycleId,
        itemCode: row.itemCode,
        itemName: row.itemName,
        brandName: row.brandName,
        packValue: row.packValue,
        bpc: row.bpc,
        mrp: row.mrp,
        barcode: row.barcode,
        phoneId: row.phoneId,
        phoneName: row.phoneName,
        shopLocationId: row.shopLocationId,
        activityDate: row.activityDate,
        quantityBottles: row.quantityBottles,
        currentStockBottles: row.currentStockBottles,
        diffBottles: row.diffBottles,
        isMatched: row.isMatched,
        matchedAt: row.matchedAt || null,
        lastUpdatedByWorkerId: row.lastUpdatedByWorkerId,
        finishedAt: row.finishedAt || null,
        finishedByWorkerId: row.finishedByWorkerId || null,
      }));

      await tx.diffItem.createMany({ data: diffItemsData });

      const basePath = getDiffImageBasePath();
      const dateKey = getLocalDateKeyIst();
      const cycleLabel = cycle.sno || cycle.id;
      const extension =
        getDiffImageFileNameExtension(proofImageName) ||
        getDiffImageFileNameExtension(proofImagePathInput) ||
        getDiffImageMimeTypeExtension(proofImageMimeType) ||
        (proofImageData ? ".jpg" : "");
      const shouldGenerateProofPath = Boolean(proofImageData || proofImagePathInput);
      const generatedPath = shouldGenerateProofPath
        ? buildDiffProofPath({
            basePath,
            dateKey,
            batchId: batch.id,
            cycleLabel,
            extension,
          })
        : "";
      const proofImagePath = proofImagePathInput || generatedPath;

      if (proofImageData && proofImagePath) {
        await saveProofImageFile(proofImagePath, proofImageData);
      }

      const updatedBatch = await tx.diffBatch.update({
        where: { id: batch.id },
        data: {
          itemCount: unmatchedRows.length,
          proofImagePath: proofImagePath || null,
          proofImageName: proofImageName || (proofImagePath ? path.basename(proofImagePath) : null),
        },
      });

      const movedIds = unmatchedRows.map((row) => row.id);
      await tx.cycleFinishedStock.deleteMany({ where: { id: { in: movedIds } } });

      return { batch: updatedBatch, movedCount: unmatchedRows.length, movedIds };
    });

    const previewMode = ["true", "1", "yes"].includes(
      String(req.body?.preview || "").trim().toLowerCase()
    );
    let resolvedPrinterId = parseOptionalPositiveInt(req.body?.printerId);
    if (!previewMode && !resolvedPrinterId) {
      const defaultPrinter = await prisma.printer.findFirst({
        where: { defaultPrinter: true },
        orderBy: [{ id: "asc" }],
      });
      resolvedPrinterId = defaultPrinter?.id || null;
    }

    const reportDataset = await buildDiffBatchReportDataset(result.batch.id);
    const reportHtml = generateDiffBatchReportHTML(reportDataset);

    let print = {
      requested: Boolean(resolvedPrinterId) && !previewMode,
      attempted: false,
      success: false,
      skipped: false,
      message: "",
      error: null,
      printer: null,
      printResult: null,
    };

    if (previewMode) {
      print = {
        ...print,
        skipped: true,
        message: "Preview mode enabled. Print skipped.",
      };
    } else if (result.movedCount === 0) {
      print = {
        ...print,
        skipped: true,
        message: "No rows moved. Print skipped.",
      };
    } else if (!resolvedPrinterId) {
      print = {
        ...print,
        skipped: true,
        message: "No default printer selected. Print skipped.",
      };
    } else {
      const printerRow = await prisma.printer.findUnique({ where: { id: resolvedPrinterId } });
      if (!printerRow) {
        print = {
          ...print,
          attempted: true,
          success: false,
          error: "Printer not found",
          message: "Printer not found",
        };
      } else {
        try {
          const printResult = await sendHtmlToPrinter(
            printerRow,
            reportHtml,
            `diff_batch_${result.batch.id}`
          );
          print = {
            ...print,
            attempted: true,
            success: true,
            message: "Diff batch report printed successfully",
            printer: {
              id: printerRow.id,
              name: printerRow.name,
              ipAddress: printerRow.ipAddress,
              port: printerRow.port,
            },
            printResult,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to print diff batch report";
          print = {
            ...print,
            attempted: true,
            success: false,
            message,
            error: message,
            printer: {
              id: printerRow.id,
              name: printerRow.name,
              ipAddress: printerRow.ipAddress,
              port: printerRow.port,
            },
          };
        }
      }
    }

    return res.json({
      success: true,
      movedCount: result.movedCount,
      movedIds: result.movedIds,
      batch: result.batch,
      report: reportDataset,
      reportHtml,
      print,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to create diff batch",
    });
  }
});

router.delete("/diff-batches/:id", async (req, res) => {
  const batchId = parseOptionalPositiveInt(req.params.id);
  if (!batchId) {
    return res.status(400).json({ success: false, message: "Invalid batch id" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.diffBatch.findFirst({
        where: { id: batchId, deletedAt: null },
        include: { items: { where: { deletedAt: null } } },
      });

      if (!batch) {
        throw new Error("Diff batch not found");
      }

      let restoredUnfinished = 0;
      let restoredFinished = 0;

      for (const item of batch.items) {
        const whereKey = {
          cycleId_itemCode_shopLocationId_activityDate: {
            cycleId: item.cycleId,
            itemCode: item.itemCode,
            shopLocationId: item.shopLocationId,
            activityDate: item.activityDate,
          },
        };

        if (item.sourceScope === "unfinished") {
          await tx.cycleUnfinishedStock.upsert({
            where: whereKey,
            create: {
              cycleId: item.cycleId,
              itemCode: item.itemCode,
              itemName: item.itemName,
              brandName: item.brandName,
              packValue: item.packValue,
              bpc: item.bpc,
              mrp: item.mrp,
              barcode: item.barcode,
              phoneId: item.phoneId,
              phoneName: item.phoneName,
              shopLocationId: item.shopLocationId,
              activityDate: item.activityDate,
              quantityBottles: item.quantityBottles,
              currentStockBottles: item.currentStockBottles,
              diffBottles: item.diffBottles,
              isMatched: item.isMatched,
              recheckShown: false,
              lastUpdatedByWorkerId: item.lastUpdatedByWorkerId,
              stateUpdatedAt: new Date(),
            },
            update: {
              itemName: item.itemName,
              brandName: item.brandName,
              packValue: item.packValue,
              bpc: item.bpc,
              mrp: item.mrp,
              barcode: item.barcode,
              phoneId: item.phoneId,
              phoneName: item.phoneName,
              quantityBottles: item.quantityBottles,
              currentStockBottles: item.currentStockBottles,
              diffBottles: item.diffBottles,
              isMatched: item.isMatched,
              lastUpdatedByWorkerId: item.lastUpdatedByWorkerId,
              stateUpdatedAt: new Date(),
            },
          });
          restoredUnfinished += 1;
        } else {
          await tx.cycleFinishedStock.upsert({
            where: whereKey,
            create: {
              cycleId: item.cycleId,
              itemCode: item.itemCode,
              itemName: item.itemName,
              brandName: item.brandName,
              packValue: item.packValue,
              bpc: item.bpc,
              mrp: item.mrp,
              barcode: item.barcode,
              phoneId: item.phoneId,
              phoneName: item.phoneName,
              shopLocationId: item.shopLocationId,
              activityDate: item.activityDate,
              quantityBottles: item.quantityBottles,
              currentStockBottles: item.currentStockBottles,
              diffBottles: item.diffBottles,
              isMatched: item.isMatched,
              matchedAt: item.matchedAt,
              lastUpdatedByWorkerId: item.lastUpdatedByWorkerId,
              finishedAt: item.finishedAt || new Date(),
              finishedByWorkerId: item.finishedByWorkerId,
              sourceUnfinishedId: item.sourceUnfinishedId,
            },
            update: {
              itemName: item.itemName,
              brandName: item.brandName,
              packValue: item.packValue,
              bpc: item.bpc,
              mrp: item.mrp,
              barcode: item.barcode,
              phoneId: item.phoneId,
              phoneName: item.phoneName,
              quantityBottles: item.quantityBottles,
              currentStockBottles: item.currentStockBottles,
              diffBottles: item.diffBottles,
              isMatched: item.isMatched,
              matchedAt: item.matchedAt,
              lastUpdatedByWorkerId: item.lastUpdatedByWorkerId,
              finishedAt: item.finishedAt || new Date(),
              finishedByWorkerId: item.finishedByWorkerId,
              sourceUnfinishedId: item.sourceUnfinishedId,
            },
          });
          restoredFinished += 1;
        }
      }

      const deletedAt = new Date();
      await tx.diffItem.updateMany({
        where: { diffBatchId: batchId, deletedAt: null },
        data: { deletedAt },
      });
      await tx.diffBatch.update({ where: { id: batchId }, data: { deletedAt } });

      return {
        restoredUnfinished,
        restoredFinished,
        restoredCount: batch.items.length,
      };
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to delete diff batch",
    });
  }
});

router.get("/fast-moving-summary", async (req, res) => {
  const shopLocationId = Number(req.query.shopLocationId);
  const cycleIdRaw = req.query.cycleId;
  const cycleId = parseOptionalPositiveInt(cycleIdRaw);
  const activityDate = String(req.query.activityDate || "").trim();

  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const baseDate = activityDate ? new Date(activityDate) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return res.status(400).json({ success: false, message: "Invalid activityDate" });
  }

  const checkedDate = activityDate || baseDate.toISOString().slice(0, 10);
  const dayStart = new Date(`${checkedDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${checkedDate}T23:59:59.999Z`);

  const [bestSellingRows, finishedRows, masterRows] = await Promise.all([
    prisma.bestSellingProduct.findMany({ orderBy: [{ id: "asc" }] }),
    prisma.cycleFinishedStock.findMany({
      where: {
        shopLocationId,
        ...(cycleId ? { cycleId } : {}),
        updatedAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        itemCode: true,
        itemName: true,
        brandName: true,
        packValue: true,
        finishedAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
    loadMasterProducts(),
  ]);

  const masterByCode = new Map(
    masterRows.map((row) => [String(row.itemCode || "").trim().toLowerCase(), row])
  );
  const eligibleBestSellingRows = bestSellingRows.filter((row) => {
    const code = String(row.itemCode || "").trim().toLowerCase();
    return code && masterByCode.has(code);
  });
  const latestFinishedByCode = new Map();

  for (const row of finishedRows) {
    const code = String(row.itemCode || "").trim().toLowerCase();
    if (!code || latestFinishedByCode.has(code)) continue;
    latestFinishedByCode.set(code, row);
  }

  const scannedRows = [];
  const uncheckedRows = [];
  let lastScannedAt = null;

  for (const best of eligibleBestSellingRows) {
    const itemCode = String(best.itemCode || "").trim();
    const key = itemCode.toLowerCase();
    const finished = latestFinishedByCode.get(key) || null;
    const scannedAt = finished?.updatedAt
      ? new Date(finished.updatedAt).toISOString()
      : null;

    if (scannedAt) {
      if (!lastScannedAt || new Date(scannedAt).getTime() > new Date(lastScannedAt).getTime()) {
        lastScannedAt = scannedAt;
      }
    }

    const master = masterByCode.get(key) || null;
    const itemPayload = {
      itemCode,
      itemName:
        best.itemName ||
        finished?.itemName ||
        master?.itemName ||
        itemCode,
      brandName:
        best.brandName ||
        finished?.brandName ||
        master?.brandName ||
        "",
      packValue:
        best.packValue ||
        finished?.packValue ||
        master?.packValue ||
        "",
      scannedAt,
    };

    if (scannedAt) {
      scannedRows.push(itemPayload);
    } else {
      uncheckedRows.push(itemPayload);
    }
  }

  const lastBestSellingModifiedAt =
    eligibleBestSellingRows.length > 0
      ? new Date(
          Math.max(
            ...eligibleBestSellingRows.map((row) => new Date(row.createdAt).getTime())
          )
        ).toISOString()
      : null;

  return res.json({
    success: true,
    checkedDate,
    cycleId: cycleId || null,
    shopLocationId,
    totalCount: eligibleBestSellingRows.length,
    scannedCount: scannedRows.length,
    uncheckedCount: uncheckedRows.length,
    lastBestSellingModifiedAt,
    lastScannedAt,
    scannedRows,
    uncheckedRows,
  });
});

router.post("/unfinished/reset", async (req, res) => {
  const rawCycleId = req.body?.cycleId;
  const rawShopLocationId = req.body?.shopLocationId;
  const where = {};

  if (rawCycleId !== undefined && rawCycleId !== null && rawCycleId !== "") {
    const cycleId = Number(rawCycleId);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid cycleId" });
    }
    where.cycleId = Math.trunc(cycleId);
  }
  if (rawShopLocationId !== undefined && rawShopLocationId !== null && rawShopLocationId !== "") {
    const shopLocationId = Number(rawShopLocationId);
    if (!Number.isFinite(shopLocationId) || shopLocationId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid shopLocationId" });
    }
    where.shopLocationId = Math.trunc(shopLocationId);
  }

  const result = await prisma.cycleUnfinishedStock.deleteMany({ where });
  return res.json({
    success: true,
    deletedCount: result.count,
    scope: where.cycleId ? `cycle:${where.cycleId}` : "all",
  });
});

router.post("/unfinished/upsert", async (req, res) => {
  const {
    cycleId,
    itemCode,
    shopLocationId,
    activityDate,
    quantityBottles,
    currentStockBottles,
    itemName,
    brandName,
    packValue,
    bpc,
    mrp,
    barcode,
    phoneId,
    lastUpdatedByWorkerId,
    recheckShown,
  } = req.body || {};

  if (!cycleId || !itemCode || !shopLocationId) {
    return res.status(400).json({
      success: false,
      message: "cycleId, itemCode, shopLocationId are required",
    });
  }

  const cycle = await prisma.cycle.findUnique({ where: { id: Number(cycleId) } });
  if (!cycle) {
    return res.status(404).json({ success: false, message: "Cycle not found" });
  }
  if (cycle.status !== "active") {
    return res.status(400).json({ success: false, message: "Cycle is not active" });
  }

  const masterRows = await loadMasterProducts({ includeAll: true });
  const masterCodeSet = new Set(masterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean));
  if (!masterCodeSet.has(normalizeItemCode(itemCode))) {
    return res.status(400).json({
      success: false,
      message: "Item is not eligible (zero in all shop locations in current master CSV)",
    });
  }

  const qty = Number(quantityBottles || 0);
  const requestedCurrent = Number(currentStockBottles || 0);
  if (!Number.isFinite(qty) || !Number.isFinite(requestedCurrent)) {
    return res.status(400).json({ success: false, message: "Invalid quantity/current values" });
  }

  const date = parseDate(activityDate, new Date());
  if (!date) {
    return res.status(400).json({ success: false, message: "Invalid activityDate" });
  }
  const normalizedPhoneId = parseOptionalPositiveInt(phoneId);
  if (phoneId !== undefined && phoneId !== null && phoneId !== "" && !normalizedPhoneId) {
    return res.status(400).json({ success: false, message: "Invalid phoneId" });
  }
  if (normalizedPhoneId) {
    const phoneRow = await prisma.phone.findUnique({ where: { id: normalizedPhoneId } });
    if (!phoneRow) {
      return res.status(404).json({ success: false, message: "Phone not found" });
    }
  }

  const location = await prisma.shopLocation.findUnique({ where: { id: Number(shopLocationId) } });
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  const normalizedItemCode = normalizeItemCode(itemCode);
  const masterProduct =
    masterRows.find((row) => normalizeItemCode(row.itemCode) === normalizedItemCode) || null;
  const current =
    masterProduct && hasMatchingLocationStockColumn(masterProduct, location)
      ? getMasterStockBottles(masterProduct, location)
      : requestedCurrent;
  const diff = qty - current;
  const matched = diff === 0;

  const row = await prisma.cycleUnfinishedStock.upsert({
    where: {
      cycleId_itemCode_shopLocationId_activityDate: {
        cycleId: Number(cycleId),
        itemCode: String(itemCode),
        shopLocationId: Number(shopLocationId),
        activityDate: date,
      },
    },
    create: {
      cycleId: Number(cycleId),
      itemCode: String(itemCode),
      shopLocationId: Number(shopLocationId),
      activityDate: date,
      quantityBottles: Math.trunc(qty),
      currentStockBottles: Math.trunc(current),
      diffBottles: Math.trunc(diff),
      isMatched: matched,
      itemName: itemName || null,
      brandName: brandName || null,
      packValue: packValue || null,
      bpc: bpc !== undefined && bpc !== null ? Number(bpc) : null,
      mrp: mrp !== undefined && mrp !== null ? Number(mrp) : null,
      barcode: barcode || null,
      phoneId: normalizedPhoneId || null,
      phoneName: null,
      lastUpdatedByWorkerId:
        lastUpdatedByWorkerId !== undefined && lastUpdatedByWorkerId !== null
          ? Number(lastUpdatedByWorkerId)
          : null,
      recheckShown: Boolean(recheckShown),
      stateUpdatedAt: new Date(),
    },
    update: {
      quantityBottles: Math.trunc(qty),
      currentStockBottles: Math.trunc(current),
      diffBottles: Math.trunc(diff),
      isMatched: matched,
      itemName: itemName || null,
      brandName: brandName || null,
      packValue: packValue || null,
      bpc: bpc !== undefined && bpc !== null ? Number(bpc) : null,
      mrp: mrp !== undefined && mrp !== null ? Number(mrp) : null,
      barcode: barcode || null,
      phoneId: normalizedPhoneId || null,
      phoneName: null,
      lastUpdatedByWorkerId:
        lastUpdatedByWorkerId !== undefined && lastUpdatedByWorkerId !== null
          ? Number(lastUpdatedByWorkerId)
          : null,
      recheckShown: Boolean(recheckShown),
      stateUpdatedAt: new Date(),
    },
  });

  await prisma.cycleProductEvent.create({
    data: {
      cycleId: Number(cycleId),
      itemCode: String(itemCode),
      itemName: itemName || null,
      brandName: brandName || null,
      packValue: packValue || null,
      shopLocationId: Number(shopLocationId),
      cycleUnfinishedId: row.id,
      activityDate: date,
      eventScope: "unfinished",
      eventAction: "upsert",
      matched,
      stockBottlesAfter: Math.trunc(qty),
      currentStockBottles: Math.trunc(current),
      diffBottles: Math.trunc(diff),
      workerId:
        lastUpdatedByWorkerId !== undefined && lastUpdatedByWorkerId !== null
          ? Number(lastUpdatedByWorkerId)
          : null,
      phoneId: normalizedPhoneId || null,
      phoneName: null,
      changesJson: JSON.stringify({ quantityBottles: Math.trunc(qty) }),
    },
  });

  return res.json({ success: true, row });
});

router.post("/unfinished/finish", async (req, res) => {
  const { cycleId, itemCode, shopLocationId, activityDate, finishedByWorkerId } =
    req.body || {};

  if (!cycleId || !itemCode || !shopLocationId) {
    return res.status(400).json({
      success: false,
      message: "cycleId, itemCode, shopLocationId are required",
    });
  }

  const date = parseDate(activityDate, new Date());
  if (!date) {
    return res.status(400).json({ success: false, message: "Invalid activityDate" });
  }

  const masterRows = await loadMasterProducts({ includeAll: true });
  const masterCodeSet = new Set(masterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean));
  if (!masterCodeSet.has(normalizeItemCode(itemCode))) {
    return res.status(404).json({ success: false, message: "Unfinished row not found" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const unfinished = await tx.cycleUnfinishedStock.findUnique({
      where: {
        cycleId_itemCode_shopLocationId_activityDate: {
          cycleId: Number(cycleId),
          itemCode: String(itemCode),
          shopLocationId: Number(shopLocationId),
          activityDate: date,
        },
      },
    });

    if (!unfinished) {
      return null;
    }
    const moveResult = await moveUnfinishedToFinished(tx, unfinished, finishedByWorkerId, "finish");
    await syncDailyMismatchSummariesForRowsTx(tx, {
      cycleId: Number(cycleId),
      rows: [unfinished],
      preferredOperatorId: parseOptionalPositiveInt(finishedByWorkerId),
    });
    return moveResult;
  });

  if (!result) {
    return res.status(404).json({ success: false, message: "Unfinished row not found" });
  }

  return res.json({ success: true, ...result });
});

router.post("/unfinished/finish-by-operator", async (req, res) => {
  const { cycleId, operatorId, shopLocationId, finishedByWorkerId, printerId, preview } =
    req.body || {};
  const normalizedCycleId = parseOptionalPositiveInt(cycleId);
  const normalizedOperatorId = parseOptionalPositiveInt(operatorId);
  const normalizedShopLocationId = parseOptionalPositiveInt(shopLocationId);
  const normalizedPrinterId = parseOptionalPositiveInt(printerId);
  const normalizedFinishedByWorkerId =
    parseOptionalPositiveInt(finishedByWorkerId) || normalizedOperatorId;
  const previewMode = ["true", "1", "yes"].includes(
    String(preview || "").trim().toLowerCase()
  );
  let resolvedPrinterId = normalizedPrinterId;

  if (!normalizedCycleId || !normalizedOperatorId) {
    return res.status(400).json({
      success: false,
      message: "cycleId and operatorId are required",
    });
  }

  const cycle = await prisma.cycle.findUnique({ where: { id: normalizedCycleId } });
  if (!cycle) {
    return res.status(404).json({ success: false, message: "Cycle not found" });
  }

  const masterRows = await loadMasterProducts({ includeAll: true });
  const masterCodeSet = new Set(masterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean));

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.cycleUnfinishedStock.findMany({
      where: {
        cycleId: normalizedCycleId,
        lastUpdatedByWorkerId: normalizedOperatorId,
        ...(normalizedShopLocationId ? { shopLocationId: normalizedShopLocationId } : {}),
      },
      orderBy: [{ id: "asc" }],
    });
    const eligibleRows = rows.filter((row) => masterCodeSet.has(normalizeItemCode(row.itemCode)));

    if (eligibleRows.length === 0) {
      return { moved: [], movedUnfinishedRows: [] };
    }

    const moved = [];
    const movedUnfinishedRows = [];
    for (const row of eligibleRows) {
      const moveResult = await moveUnfinishedToFinished(
        tx,
        row,
        normalizedFinishedByWorkerId,
        "finish_bulk"
      );
      moved.push(moveResult);
      movedUnfinishedRows.push(row);
    }
    const mismatchSummaries = await syncDailyMismatchSummariesForRowsTx(tx, {
      cycleId: normalizedCycleId,
      rows: movedUnfinishedRows,
      preferredOperatorId: normalizedOperatorId || normalizedFinishedByWorkerId,
    });
    return { moved, movedUnfinishedRows, mismatchSummaries };
  });

  const finishReportDataset = await buildFinishReportDataset({
    cycleId: normalizedCycleId,
    operatorId: normalizedOperatorId,
    movedUnfinishedRows: result.movedUnfinishedRows,
  });
  const finishReportHtml = generateFinishReportHTML(finishReportDataset);

  if (!previewMode && !resolvedPrinterId) {
    const defaultPrinter = await prisma.printer.findFirst({
      where: { defaultPrinter: true },
      orderBy: [{ id: "asc" }],
    });
    resolvedPrinterId = defaultPrinter?.id || null;
  }

  let print = {
    requested: Boolean(resolvedPrinterId) && !previewMode,
    attempted: false,
    success: false,
    skipped: false,
    message: "",
    error: null,
    printer: null,
    printResult: null,
  };

  if (previewMode) {
    print = {
      ...print,
      skipped: true,
      message: "Preview mode enabled. Print skipped.",
    };
  } else if (result.moved.length === 0) {
    print = {
      ...print,
      skipped: true,
      message: "No unfinished rows moved. Print skipped.",
    };
  } else if (!resolvedPrinterId) {
    print = {
      ...print,
      skipped: true,
      message: "No default printer selected. Print skipped.",
    };
  } else {
    const printerRow = await prisma.printer.findUnique({ where: { id: resolvedPrinterId } });
    if (!printerRow) {
      print = {
        ...print,
        attempted: true,
        success: false,
        error: "Printer not found",
        message: "Printer not found",
      };
    } else {
      try {
        const printResult = await sendHtmlToPrinter(
          printerRow,
          finishReportHtml,
          `finish_diff_${finishReportDataset.cycleDate}_${normalizedOperatorId}`
        );
        print = {
          ...print,
          attempted: true,
          success: true,
          message: "Finish diff report printed successfully",
          printer: {
            id: printerRow.id,
            name: printerRow.name,
            ipAddress: printerRow.ipAddress,
            port: printerRow.port,
          },
          printResult,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to print finish report";
        print = {
          ...print,
          attempted: true,
          success: false,
          message,
          error: message,
          printer: {
            id: printerRow.id,
            name: printerRow.name,
            ipAddress: printerRow.ipAddress,
            port: printerRow.port,
          },
        };
      }
    }
  }

  return res.json({
    success: true,
    cycleId: normalizedCycleId,
    operatorId: normalizedOperatorId,
    shopLocationId: normalizedShopLocationId || null,
    finishedByWorkerId: normalizedFinishedByWorkerId,
    finishedCount: result.moved.length,
    unfinishedIds: result.moved.map((row) => row.unfinishedId),
    finishReport: {
      cycleDate: finishReportDataset.cycleDate,
      operatorName: finishReportDataset.operatorName,
      todayMismatchCount: finishReportDataset.todayMismatchCount,
      todayMismatchDate: finishReportDataset.todayMismatchDate,
      sectionCount: finishReportDataset.sections.length,
      sections: finishReportDataset.sections.map((section) => ({
        label: section.label,
        count: section.rows.length,
      })),
    },
    mismatchSummaryUpdates: result.mismatchSummaries || [],
    finishReportHtml,
    print,
  });
});

router.post("/unfinished/finish-today", async (req, res) => {
  const {
    cycleId,
    shopLocationId,
    operatorId,
    finishedByWorkerId,
    activityDate,
  } = req.body || {};

  const normalizedCycleId = parseOptionalPositiveInt(cycleId);
  const normalizedShopLocationId = parseOptionalPositiveInt(shopLocationId);
  const normalizedOperatorId = parseOptionalPositiveInt(operatorId);
  const normalizedFinishedByWorkerId =
    parseOptionalPositiveInt(finishedByWorkerId) || normalizedOperatorId;
  const dayRange = getUtcDayRange(activityDate);

  if (!dayRange) {
    return res.status(400).json({ success: false, message: "Invalid activityDate" });
  }

  const resolvedCycle =
    normalizedCycleId
      ? await prisma.cycle.findUnique({ where: { id: normalizedCycleId } })
      : await prisma.cycle.findFirst({ where: { status: "active" } });

  if (!resolvedCycle) {
    return res.status(404).json({ success: false, message: "No active/current cycle found" });
  }

  const masterRows = await loadMasterProducts({ includeAll: true });
  const masterCodeSet = new Set(masterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean));

  const where = {
    cycleId: resolvedCycle.id,
    activityDate: {
      gte: dayRange.dayStart,
      lte: dayRange.dayEnd,
    },
    ...(normalizedShopLocationId ? { shopLocationId: normalizedShopLocationId } : {}),
    ...(normalizedOperatorId ? { lastUpdatedByWorkerId: normalizedOperatorId } : {}),
  };

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.cycleUnfinishedStock.findMany({
      where,
      orderBy: [{ id: "asc" }],
    });
    const eligibleRows = rows.filter((row) => masterCodeSet.has(normalizeItemCode(row.itemCode)));

    if (eligibleRows.length === 0) {
      return { moved: [] };
    }

    const moved = [];
    for (const row of eligibleRows) {
      const moveResult = await moveUnfinishedToFinished(
        tx,
        row,
        normalizedFinishedByWorkerId,
        "finish_today_bulk"
      );
      moved.push(moveResult);
    }

    const mismatchSummaries = await syncDailyMismatchSummariesForRowsTx(tx, {
      cycleId: resolvedCycle.id,
      rows: eligibleRows,
      preferredOperatorId: normalizedOperatorId || normalizedFinishedByWorkerId,
    });

    return { moved, mismatchSummaries };
  });

  return res.json({
    success: true,
    cycleId: resolvedCycle.id,
    cycleStatus: resolvedCycle.status,
    activityDate: dayRange.dayKey,
    shopLocationId: normalizedShopLocationId || null,
    operatorId: normalizedOperatorId || null,
    finishedByWorkerId: normalizedFinishedByWorkerId || null,
    finishedCount: result.moved.length,
    unfinishedIds: result.moved.map((row) => row.unfinishedId),
    mismatchSummaryUpdates: result.mismatchSummaries || [],
  });
});

router.post("/print/verification-report", async (req, res) => {
  try {
    const cycleId = parseOptionalPositiveInt(req.body?.cycleId);
    const printerId = parseOptionalPositiveInt(req.body?.printerId);
    const dayRange = getUtcDayRange(req.body?.activityDate);
    const preview = ["true", "1", "yes"].includes(
      String(req.body?.preview || "").trim().toLowerCase()
    );

    if (!dayRange) {
      return res.status(400).json({ success: false, message: "Invalid activityDate" });
    }

    const dataset = await buildVerificationDataset({ cycleId, dayRange });
    const html = generateVerificationReportHTML(dataset);

    if (preview) {
      return res.json({
        success: true,
        cycleId: dataset.cycle.id,
        activityDate: dataset.dayKey,
        html,
      });
    }

    if (!printerId) {
      return res.status(400).json({ success: false, message: "printerId is required" });
    }

    const printerRow = await prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerRow) {
      return res.status(404).json({ success: false, message: "Printer not found" });
    }

    const printResult = await sendHtmlToPrinter(
      printerRow,
      html,
      `verification_report_${dataset.dayKey}`
    );

    return res.json({
      success: true,
      message: "Verification report printed successfully",
      cycleId: dataset.cycle.id,
      activityDate: dataset.dayKey,
      printer: {
        id: printerRow.id,
        name: printerRow.name,
        ipAddress: printerRow.ipAddress,
        port: printerRow.port,
      },
      printResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to print verification report";
    const status = message.includes("No active/current cycle found") ? 404 : 500;
    return res.status(status).json({ success: false, message });
  }
});

router.post("/print/verification-list", async (req, res) => {
  try {
    const filter = String(req.body?.filter || "")
      .trim()
      .toLowerCase();
    if (!["matched", "unmatched", "unchecked"].includes(filter)) {
      return res.status(400).json({
        success: false,
        message: "Invalid filter. Use matched, unmatched or unchecked",
      });
    }

    const cycleId = parseOptionalPositiveInt(req.body?.cycleId);
    const printerId = parseOptionalPositiveInt(req.body?.printerId);
    const dayRange = getUtcDayRange(req.body?.activityDate);
    const preview = ["true", "1", "yes"].includes(
      String(req.body?.preview || "").trim().toLowerCase()
    );
    const filteredItems = Array.isArray(req.body?.filteredItems)
      ? req.body.filteredItems
          .map((row) => ({
            shopLocationId: parseOptionalPositiveInt(row?.shopLocationId),
            itemCode: String(row?.itemCode || "").trim(),
            displayName: String(row?.displayName || "").trim(),
          }))
          .filter((row) => row.shopLocationId && row.itemCode && row.displayName)
      : [];
    const customFilterLabel = String(req.body?.filterLabel || "")
      .trim()
      .toUpperCase();
    if (!dayRange) {
      return res.status(400).json({ success: false, message: "Invalid activityDate" });
    }

    const dataset = await buildVerificationDataset({ cycleId, dayRange });
    let sections;

    if (filteredItems.length > 0) {
      const rowsByLocation = new Map();
      filteredItems.forEach((row) => {
        const key = `${row.shopLocationId}|${normalizeItemCode(row.itemCode)}`;
        if (!rowsByLocation.has(row.shopLocationId)) {
          rowsByLocation.set(row.shopLocationId, new Map());
        }
        rowsByLocation.get(row.shopLocationId).set(key, {
          name: row.displayName,
          itemCode: row.itemCode,
        });
      });

      sections = dataset.locationSummaries
        .map((section) => ({
          label: section.label,
          rows: sortNames(Array.from((rowsByLocation.get(section.locationId) || new Map()).values())),
        }))
        .filter((section) => section.rows.length > 0);
    } else {
      const rowKey =
        filter === "matched"
          ? "matchedRows"
          : filter === "unmatched"
            ? "unmatchedRows"
            : "uncheckedRows";
      sections = dataset.locationSummaries.map((section) => ({
        label: section.label,
        rows: section[rowKey] || [],
      }));
    }

    const html = generateVerificationFilterReportHTML({
      dayKey: dataset.dayKey,
      filterLabel: customFilterLabel || filter.toUpperCase(),
      sections,
      generatedAt: dataset.generatedAt,
    });

    if (preview) {
      return res.json({
        success: true,
        cycleId: dataset.cycle.id,
        activityDate: dataset.dayKey,
        filter,
        html,
      });
    }

    if (!printerId) {
      return res.status(400).json({ success: false, message: "printerId is required" });
    }

    const printerRow = await prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerRow) {
      return res.status(404).json({ success: false, message: "Printer not found" });
    }

    const printResult = await sendHtmlToPrinter(
      printerRow,
      html,
      `verification_${filter}_${dataset.dayKey}`
    );

    return res.json({
      success: true,
      message: `${filter.toUpperCase()} report printed successfully`,
      cycleId: dataset.cycle.id,
      activityDate: dataset.dayKey,
      filter,
      printer: {
        id: printerRow.id,
        name: printerRow.name,
        ipAddress: printerRow.ipAddress,
        port: printerRow.port,
      },
      printResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to print verification list";
    const status = message.includes("No active/current cycle found") ? 404 : 500;
    return res.status(status).json({ success: false, message });
  }
});

router.post("/print/difference-report", async (req, res) => {
  try {
    const scopeRaw = String(req.body?.scope || "today").trim().toLowerCase();
    const scope = scopeRaw === "total" ? "total" : scopeRaw === "today" ? "today" : "";
    if (!scope) {
      return res.status(400).json({
        success: false,
        message: "Invalid scope. Use today or total",
      });
    }

    const cycleId = parseOptionalPositiveInt(req.body?.cycleId);
    const printerId = parseOptionalPositiveInt(req.body?.printerId);
    const dayRange = getUtcDayRange(req.body?.activityDate);
    const preview = ["true", "1", "yes"].includes(
      String(req.body?.preview || "").trim().toLowerCase()
    );
    if (!dayRange) {
      return res.status(400).json({ success: false, message: "Invalid activityDate" });
    }

    const dataset = await buildDifferenceDataset({ cycleId, dayRange, scope });
    const html = generateDifferenceReportHTML({
      cycleDate: dataset.cycleDate,
      scope,
      todayDate: dataset.todayDate,
      sections: dataset.sections,
      locationSections: dataset.locationSections,
    });

    if (preview) {
      return res.json({
        success: true,
        cycleId: dataset.cycle.id,
        cycleDate: dataset.cycleDate,
        scope,
        todayDate: dataset.todayDate,
        sections: {
          shop: {
            count: dataset.sections.shop.items.length,
            totalDiff: dataset.sections.shop.totalDiff,
          },
          godown: {
            count: dataset.sections.godown.items.length,
            totalDiff: dataset.sections.godown.totalDiff,
          },
        },
        locationSections: dataset.locationSections.map((section) => ({
          locationId: section.locationId,
          label: section.label,
          count: section.rows.length,
          totalDiff: section.totalDiff,
        })),
        html,
      });
    }

    if (!printerId) {
      return res.status(400).json({ success: false, message: "printerId is required" });
    }

    const printerRow = await prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerRow) {
      return res.status(404).json({ success: false, message: "Printer not found" });
    }

    const printResult = await sendHtmlToPrinter(printerRow, html, `difference_${scope}`);

    return res.json({
      success: true,
      message: `Difference report (${scope}) printed successfully`,
      cycleId: dataset.cycle.id,
      cycleDate: dataset.cycleDate,
      scope,
      todayDate: dataset.todayDate,
      sections: {
        shop: {
          count: dataset.sections.shop.items.length,
          totalDiff: dataset.sections.shop.totalDiff,
        },
        godown: {
          count: dataset.sections.godown.items.length,
          totalDiff: dataset.sections.godown.totalDiff,
        },
      },
      printer: {
        id: printerRow.id,
        name: printerRow.name,
        ipAddress: printerRow.ipAddress,
        port: printerRow.port,
      },
      printResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to print difference report";
    const status = message.includes("No active/current cycle found") ? 404 : 500;
    return res.status(status).json({ success: false, message });
  }
});

router.post("/print/difference-by-person", async (req, res) => {
  try {
    const modeRaw = String(req.body?.mode || "individual").trim().toLowerCase();
    const scopeRaw = String(req.body?.scope || "total").trim().toLowerCase();
    const mode =
      modeRaw === "individual" ? "individual" : modeRaw === "common" ? "common" : "";
    const scope = scopeRaw === "today" ? "today" : scopeRaw === "total" ? "total" : "";

    if (!mode) {
      return res.status(400).json({
        success: false,
        message: "Invalid mode. Use individual or common",
      });
    }
    if (!scope) {
      return res.status(400).json({
        success: false,
        message: "Invalid scope. Use today or total",
      });
    }

    const cycleId = parseOptionalPositiveInt(req.body?.cycleId);
    const printerId = parseOptionalPositiveInt(req.body?.printerId);
    const dayRange = getUtcDayRange(req.body?.activityDate);
    const preview = ["true", "1", "yes"].includes(
      String(req.body?.preview || "").trim().toLowerCase()
    );
    if (!dayRange) {
      return res.status(400).json({ success: false, message: "Invalid activityDate" });
    }

    const dataset = await buildDifferenceDataset({ cycleId, dayRange, scope });
    const operatorDiffData = dataset.operatorDiffData;
    if (!operatorDiffData.operators.length) {
      return res.status(404).json({
        success: false,
        message:
          scope === "today"
            ? "No operator activity found for today"
            : "No operator activity found for this cycle",
        cycleId: dataset.cycle.id,
        cycleDate: dataset.cycleDate,
        todayDate: dataset.todayDate,
        scope,
      });
    }

    const commonHtml = generateOperatorDifferenceCommonHTML({
      cycleDate: dataset.cycleDate,
      todayDate: dataset.todayDate,
      scope,
      operators: operatorDiffData.operators,
      summary: operatorDiffData.summary,
    });

    if (preview) {
      return res.json({
        success: true,
        cycleId: dataset.cycle.id,
        cycleDate: dataset.cycleDate,
        todayDate: dataset.todayDate,
        scope,
        mode,
        summary: operatorDiffData.summary,
        operators: operatorDiffData.operators.map((operator) => ({
          name: operator.name,
          touchedCount: operator.touchedCount,
          diffItemCount: operator.diffItemCount,
          shopDiff: operator.shopDiff,
          godownDiff: operator.godownDiff,
          totalDiff: operator.totalDiff,
        })),
        html:
          mode === "common"
            ? commonHtml
            : generateOperatorDifferenceIndividualHTML({
                cycleDate: dataset.cycleDate,
                todayDate: dataset.todayDate,
                scope,
                operator: operatorDiffData.operators[0],
              }),
        commonHtml,
      });
    }

    if (!printerId) {
      return res.status(400).json({ success: false, message: "printerId is required" });
    }

    const printerRow = await prisma.printer.findUnique({ where: { id: printerId } });
    if (!printerRow) {
      return res.status(404).json({ success: false, message: "Printer not found" });
    }

    if (mode === "common") {
      const printResult = await sendHtmlToPrinter(
        printerRow,
        commonHtml,
        "difference_person_common"
      );
      return res.json({
        success: true,
        message: "Common person-wise difference report printed successfully",
        cycleId: dataset.cycle.id,
        cycleDate: dataset.cycleDate,
        todayDate: dataset.todayDate,
        scope,
        mode,
        summary: operatorDiffData.summary,
        operators: operatorDiffData.operators.map((operator) => ({
          name: operator.name,
          touchedCount: operator.touchedCount,
          diffItemCount: operator.diffItemCount,
          shopDiff: operator.shopDiff,
          godownDiff: operator.godownDiff,
          totalDiff: operator.totalDiff,
        })),
        printer: {
          id: printerRow.id,
          name: printerRow.name,
          ipAddress: printerRow.ipAddress,
          port: printerRow.port,
        },
        printResult,
      });
    }

    const individualResults = [];
    const failedIndividuals = [];

    for (const operator of operatorDiffData.operators) {
      const html = generateOperatorDifferenceIndividualHTML({
        cycleDate: dataset.cycleDate,
        todayDate: dataset.todayDate,
        scope,
        operator,
      });
      const jobLabel = `difference_person_${toPrintJobToken(operator.name)}`;

      try {
        const personPrintResult = await sendHtmlToPrinter(printerRow, html, jobLabel);
        individualResults.push({
          name: operator.name,
          touchedCount: operator.touchedCount,
          diffItemCount: operator.diffItemCount,
          shopDiff: operator.shopDiff,
          godownDiff: operator.godownDiff,
          totalDiff: operator.totalDiff,
          referenceCode: personPrintResult.referenceCode,
        });
      } catch (printError) {
        const printErrorMessage =
          printError && printError.message
            ? printError.message
            : "Failed to print operator report";
        failedIndividuals.push({
          name: operator.name,
          error: printErrorMessage,
        });
      }
    }

    let commonPrintResult = null;
    let commonPrintError = "";
    try {
      commonPrintResult = await sendHtmlToPrinter(
        printerRow,
        commonHtml,
        "difference_person_common"
      );
    } catch (printError) {
      commonPrintError =
        printError && printError.message
          ? printError.message
          : "Failed to print common summary";
    }

    const hasAnySuccess = individualResults.length > 0 || Boolean(commonPrintResult);
    if (!hasAnySuccess) {
      return res.status(500).json({
        success: false,
        message: "All operator prints failed",
        cycleId: dataset.cycle.id,
        cycleDate: dataset.cycleDate,
        todayDate: dataset.todayDate,
        scope,
        mode,
        summary: operatorDiffData.summary,
        individualCount: 0,
        individualResults: [],
        failedIndividuals,
        commonReferenceCode: null,
        commonPrintError: commonPrintError || "Common summary failed",
      });
    }

    const partialFailure = failedIndividuals.length > 0 || Boolean(commonPrintError);
    const message = partialFailure
      ? `Printed ${individualResults.length} operators, failed ${failedIndividuals.length}${
          commonPrintResult ? "" : ", common summary failed"
        }`
      : `Printed ${individualResults.length} individual reports and 1 common summary`;

    return res.json({
      success: true,
      partialFailure,
      message,
      cycleId: dataset.cycle.id,
      cycleDate: dataset.cycleDate,
      todayDate: dataset.todayDate,
      scope,
      mode,
      summary: operatorDiffData.summary,
      individualCount: individualResults.length,
      individualResults,
      failedIndividuals,
      commonReferenceCode: commonPrintResult ? commonPrintResult.referenceCode : null,
      commonPrintError: commonPrintError || null,
      printer: {
        id: printerRow.id,
        name: printerRow.name,
        ipAddress: printerRow.ipAddress,
        port: printerRow.port,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to print person-wise difference report";
    const status = message.includes("No active/current cycle found") ? 404 : 500;
    return res.status(status).json({ success: false, message });
  }
});

router.post("/finished/reset", async (req, res) => {
  const rawCycleId = req.body?.cycleId;
  const rawShopLocationId = req.body?.shopLocationId;
  const where = {};

  if (rawCycleId !== undefined && rawCycleId !== null && rawCycleId !== "") {
    const cycleId = Number(rawCycleId);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid cycleId" });
    }
    where.cycleId = Math.trunc(cycleId);
  }
  if (rawShopLocationId !== undefined && rawShopLocationId !== null && rawShopLocationId !== "") {
    const shopLocationId = Number(rawShopLocationId);
    if (!Number.isFinite(shopLocationId) || shopLocationId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid shopLocationId" });
    }
    where.shopLocationId = Math.trunc(shopLocationId);
  }

  const result = await prisma.cycleFinishedStock.deleteMany({ where });
  return res.json({
    success: true,
    deletedCount: result.count,
    scope: where.cycleId ? `cycle:${where.cycleId}` : "all",
  });
});

router.post("/events/reset", async (req, res) => {
  const rawCycleId = req.body?.cycleId;
  const rawShopLocationId = req.body?.shopLocationId;
  const where = {};

  if (rawCycleId !== undefined && rawCycleId !== null && rawCycleId !== "") {
    const cycleId = Number(rawCycleId);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid cycleId" });
    }
    where.cycleId = Math.trunc(cycleId);
  }

  if (rawShopLocationId !== undefined && rawShopLocationId !== null && rawShopLocationId !== "") {
    const shopLocationId = Number(rawShopLocationId);
    if (!Number.isFinite(shopLocationId) || shopLocationId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid shopLocationId" });
    }
    where.shopLocationId = Math.trunc(shopLocationId);
  }

  const result = await prisma.cycleProductEvent.deleteMany({ where });
  return res.json({
    success: true,
    deletedCount: result.count,
    scope: where.cycleId ? `cycle:${where.cycleId}` : "all",
  });
});

module.exports = router;
module.exports.printFullCycleVerification = printFullCycleVerification;
