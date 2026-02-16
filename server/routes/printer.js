const express = require("express");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const { PNG } = require("pngjs");
const { printLogPaths } = require("../path/path");
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
} = require("node-thermal-printer");
const { markPrinted } = require("../pool/codePool");

let usedCodes = new Set();
let codeCounter = 1;
const DEFAULT_SLICE_HEIGHT_PX = 1200;
const RECEIPTS_DIR = path.join(__dirname, "..", "receipts");
const RECEIPT_BUCKETS = {
  SHOP: "shop",
  GODDOWN: "goddown",
  STOCKLENS: "stocklens",
};
const PUPPETEER_LAUNCH_TIMEOUT_MS = Number.parseInt(
  process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || "60000",
  10
);
const PUPPETEER_DUMPIO =
  String(process.env.PUPPETEER_DUMPIO || "false").toLowerCase() === "true";

const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const sanitizeReceiptBucket = (value, fallback = RECEIPT_BUCKETS.SHOP) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return normalized || fallback;
};

const getReceiptsBucketDir = (bucketName) => {
  const safeBucket = sanitizeReceiptBucket(bucketName, RECEIPT_BUCKETS.SHOP);
  return {
    bucket: safeBucket,
    dir: path.join(RECEIPTS_DIR, safeBucket),
  };
};

const PRINT_LOG_HEADER =
  "timestamp,appId,printerIP,port,uniqueCode,operatorName,totalQuantity,totalValue,itemsCount,addOnsCount,payloadJson\n";

const appendPrintCsvLog = (filePath, entry) => {
  ensureDirExists(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, PRINT_LOG_HEADER);
  }

  const line = [
    entry.timestamp,
    entry.appId,
    entry.printerIP,
    entry.port,
    entry.uniqueCode,
    entry.operatorName || "",
    entry.totalQuantity ?? "",
    entry.totalValue ?? "",
    entry.itemsCount ?? "",
    entry.addOnsCount ?? "",
    entry.payloadJson || "",
  ]
    .map((value) => `"${String(value).replace(/\"/g, '""')}"`)
    .join(",")
    .concat("\n");

  fs.appendFileSync(filePath, line);
};

const logPrintPayload = (appId, payload, meta) => {
  const filePath =
    appId === "goddown"
      ? printLogPaths.goddownPrintLogFile
      : printLogPaths.myAppPrintLogFile;
  const payloadJson = JSON.stringify(payload);
  appendPrintCsvLog(filePath, {
    timestamp: new Date().toISOString(),
    appId,
    printerIP: meta.printerIP,
    port: meta.port,
    uniqueCode: payload.uniqueCode,
    operatorName: payload.operatorName || "",
    totalQuantity: payload.totalQuantity,
    totalValue: payload.totalValue,
    itemsCount: payload.itemsCount,
    addOnsCount: payload.addOnsCount,
    payloadJson,
  });
};

// ============================================
// PERFORMANCE OPTIMIZATION: Browser Pooling
// ============================================
let browserInstance = null;
let browserInitPromise = null;
const DEFAULT_CHROME_PATH_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function isExecutableFile(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function getLaunchArgs() {
  if (process.platform === "linux") {
    return [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ];
  }
  return ["--disable-gpu"];
}

function getExecutableCandidates() {
  const candidates = [...DEFAULT_CHROME_PATH_CANDIDATES];
  try {
    const bundledPath = puppeteer.executablePath();
    if (bundledPath) {
      candidates.unshift(bundledPath);
    }
  } catch (error) {
    // no-op
  }

  const seen = new Set();
  const resolved = [];
  candidates.forEach((entry) => {
    const normalized = String(entry || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    if (isExecutableFile(normalized)) {
      resolved.push(normalized);
    }
  });

  return resolved;
}

function formatLaunchError(error) {
  if (!error) return "Unknown launch error";
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.cause?.message) parts.push(`cause=${error.cause.message}`);
  if (error.stack) parts.push(`stack=${error.stack.split("\n").slice(0, 6).join(" | ")}`);
  return parts.join(" | ");
}

async function getBrowserInstance() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (browserInitPromise) {
    return browserInitPromise;
  }

  browserInitPromise = (async () => {
    let lastError;
    const executableCandidates = getExecutableCandidates();
    const launchTargets =
      executableCandidates.length > 0
        ? executableCandidates.map((executablePath) => ({ executablePath }))
        : [{}];

    console.log(
      `🧭 [browser] Launch targets: ${
        launchTargets.map((target) => target.executablePath || "puppeteer-default").join(", ")
      }`
    );

    let attempt = 1;
    for (const target of launchTargets) {
      try {
        const browser = await puppeteer.launch({
          headless: true,
          timeout: Number.isFinite(PUPPETEER_LAUNCH_TIMEOUT_MS)
            ? PUPPETEER_LAUNCH_TIMEOUT_MS
            : 60000,
          dumpio: PUPPETEER_DUMPIO,
          args: getLaunchArgs(),
          ...(target.executablePath
            ? { executablePath: target.executablePath }
            : {}),
        });
        browserInstance = browser;
        browser.on("disconnected", () => {
          browserInstance = null;
        });
        console.log(
          `✅ Browser instance initialized (attempt ${attempt})${
            target.executablePath
              ? ` using ${target.executablePath}`
              : " using puppeteer default"
          }`
        );
        return browser;
      } catch (error) {
        lastError = error;
        console.error(
          `⚠️ Browser launch attempt ${attempt} failed${
            target.executablePath ? ` [${target.executablePath}]` : ""
          }: ${formatLaunchError(error)}`
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      attempt += 1;
    }

    browserInstance = null;
    throw lastError;
  })().finally(() => {
    browserInitPromise = null;
  });

  return browserInitPromise;
}

// Graceful shutdown
process.on("SIGINT", async () => {
  if (browserInstance) {
    await browserInstance.close();
    console.log("Browser instance closed");
  }
  process.exit(0);
});

// ============================================
// PERFORMANCE LOGGER
// ============================================
class PerformanceLogger {
  constructor(jobId) {
    this.jobId = jobId;
    this.startTime = Date.now();
    this.checkpoints = [];
    this.stepCounter = 1;
  }

  log(label) {
    const elapsed = Date.now() - this.startTime;
    const step = this.stepCounter++;
    this.checkpoints.push({ step, label, elapsed });
    console.log(`⏱️  [${this.jobId}] [${step}] ${label}: ${elapsed}ms`);
  }

  summary() {
    const total = Date.now() - this.startTime;
    console.log(`\n📊 Performance Summary [${this.jobId}]:`);
    this.checkpoints.forEach(cp => {
      console.log(`   [${cp.step}] ${cp.label}: ${cp.elapsed}ms`);
    });
    console.log(`   TOTAL TIME: ${total}ms\n`);
    return total;
  }
}

function formatLogMeta(meta) {
  if (meta === undefined || meta === null) return "";
  if (typeof meta === "string") return meta;
  try {
    return JSON.stringify(meta);
  } catch (error) {
    return String(meta);
  }
}

function createRequestStepLogger(requestId) {
  const requestStart = Date.now();
  let step = 1;

  return {
    step(label, meta) {
      const elapsed = Date.now() - requestStart;
      const metaText = formatLogMeta(meta);
      console.log(
        `🧭 [${requestId}] [${step++}] ${label} (${elapsed}ms)${
          metaText ? ` | ${metaText}` : ""
        }`
      );
    },
    error(label, error, meta) {
      const elapsed = Date.now() - requestStart;
      const metaText = formatLogMeta(meta);
      console.error(
        `❌ [${requestId}] [${step++}] ${label} FAILED (${elapsed}ms): ${
          error?.message || error
        }${metaText ? ` | ${metaText}` : ""}`
      );
    },
  };
}

// ============================================
// EXISTING HELPER FUNCTIONS (unchanged)
// ============================================
function formatCaseQuantity(quantity, bpc) {
  const numericQuantity =
    typeof quantity === "number" ? quantity : Number.parseFloat(String(quantity));
  const total = Number.isFinite(numericQuantity) ? numericQuantity : 0;
  const numericBpc = typeof bpc === "number" ? bpc : Number.parseInt(String(bpc), 10);
  if (!Number.isFinite(numericBpc) || numericBpc <= 0) {
    return total.toString();
  }

  const cases = Math.floor(total / numericBpc);
  let bottles = Math.round(total - cases * numericBpc);

  if (bottles < 0) {
    bottles = 0;
  }
  if (bottles >= numericBpc) {
    const overflowCases = Math.floor(bottles / numericBpc);
    bottles = bottles % numericBpc;
    return `${cases + overflowCases}.${bottles.toString().padStart(3, "0")}`;
  }

  return `${cases}.${bottles.toString().padStart(3, "0")}`;
}

function normalizeItemCode(item) {
  const code =
    item?.itemCode ??
    item?.code ??
    item?.Code ??
    item?.CODE ??
    item?.value ??
    item?.BarCode ??
    item?.BARCODE ??
    item?.barcode ??
    item?.BARCODEVALUE ??
    item?.barcodeValue ??
    "";
  const trimmed = String(code).trim();
  return trimmed || "UNKNOWN";
}

function getItemBpc(item) {
  if (!item) return undefined;
  return item.bpc ?? item.BPC ?? item.bpcValue ?? item.BPCValue;
}

function buildDefaultQrPayload(scannedItems) {
  return scannedItems
    .map((item) => {
      const itemCode = item.itemCode || item.value || "UNKNOWN";
      const formattedQuantity = formatCaseQuantity(
        item.quantity || 0,
        item.bpc
      );
      return `${itemCode}\n${formattedQuantity}`;
    })
    .join("\n+\n");
}

function buildGoddownQrPayload(scannedItems) {
  return scannedItems
    .map((item) => {
      const itemCode = normalizeItemCode(item);
      const formattedQuantity = formatCaseQuantity(
        item.quantity || item.qty || 0,
        getItemBpc(item)
      );
      return `${itemCode}\n${formattedQuantity}`;
    })
    .join("\n+\n");
}

function buildGoddownQrPayloadWithAddOns(scannedItems, addOns) {
  const payloads = [];

  if (Array.isArray(scannedItems) && scannedItems.length > 0) {
    const scannedPayload = buildGoddownQrPayload(scannedItems);
    if (scannedPayload) {
      payloads.push(scannedPayload);
    }
  }

  if (Array.isArray(addOns) && addOns.length > 0) {
    const addOnPayload = addOns
      .filter((addon) => (addon?.quantity || 0) > 0)
      .map((addon) => {
        const itemCode = normalizeItemCode(addon);
        const formattedQuantity = formatCaseQuantity(
          addon.quantity || addon.qty || 0,
          getItemBpc(addon)
        );
        return `${itemCode}\n${formattedQuantity}`;
      })
      .join("\n+\n");

    if (addOnPayload) {
      payloads.push(addOnPayload);
    }
  }

  return payloads.join("\n+\n");
}

function createPrinterByIP(ip, printerPort = 9100) {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${ip}:${printerPort}`,
    characterSet: CharacterSet.PC852_LATIN2,
    removeSpecialCharacters: false,
    lineCharacter: "=",
  });
}

// ============================================
// OPTIMIZED: Generate QR as Data URL (sync)
// ============================================
async function generateQRDataURL(qrDataString) {
  return await QRCode.toDataURL(qrDataString, {
    width: 200,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
    rendererOpts: {
      quality: 0.92,
    },
  });
}

// ============================================
// OPTIMIZED: Receipt HTML Generation
// ============================================
async function generateReceiptHTML(printData, includeQR = true) {
  const { uniqueCode, scannedItems, addOns = [], totalValue } = printData;

  let qrSection = "";

  if (includeQR) {
    let qrDataString = "";
    scannedItems.forEach((item) => {
      const qty = item.quantity || 1;
      for (let i = 0; i < qty; i++) {
        qrDataString += (item.value || "UNKNOWN") + "\n";
      }
    });

    addOns.forEach((addon) => {
      const qty = addon?.quantity || 1;
      if (addon?.itemCode) {
        qrDataString += addon.itemCode + "\n";
      }
      qrDataString += qty + "\n";
    });

    qrDataString = qrDataString.trim();
    const qrCodeImage = await generateQRDataURL(qrDataString);

    qrSection = `
      <div class="separator"></div>
      <div class="qr-container">
        <img src="${qrCodeImage}" alt="QR Code" />
      </div>
    `;
  }

  let totalQuantity = 0;
  scannedItems.forEach((item) => (totalQuantity += item.quantity || 0));

  const allItems = [
    ...scannedItems.map((item, index) => ({
      no: index + 1,
      name:
        item.isMatched && item.brandName
          ? `${item.brandName || "Unknown Product"}`
          : item.value || "UNKNOWN",
      qty: item.quantity || 0,
      rate: item.isMatched ? item.mrp || 0 : "-",
      pack: item.pack || "-",
    })),
    ...addOns.map((addon, i) => ({
      no: scannedItems.length + i + 1,
      name: addon?.product || "ADD-ON",
      pack: "-",
      qty: addon.quantity || 0,
      rate: addon?.price || "-",
    })),
  ];

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Receipt ${uniqueCode}${includeQR ? "" : " (No QR)"}</title>
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
      .extra-bold { font-weight: 900; font-size: 16px; }
      .separator { 
        border-bottom: 2px solid #000; 
        margin: 3px 0;
      }
      .qr-container { 
        text-align: center; 
        margin: 5px 0;
      }
      .qr-container img { 
        width: 140px;
        height: 140px;
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
      }
      .summary-box {
        padding: 2px;
        font-size: 14px;
        text-align: center;
      }
      .thank-you {
        font-size: 14px;
        margin: 2px 0;
        text-transform: uppercase;
      }
      .disclaimer {
        font-size: 11px;
        margin: 2px 0;
      }
      .timestamp {
        font-size: 14px;
        margin-top: 3px;
      }
    </style>
  </head>
  <body>
    <div class="center">
      <div class="extra-bold">REF: ${uniqueCode}${includeQR ? "" : " (COPY)"}</div>
      <div>Hi, here's your receipt${includeQR ? "" : " copy"}</div>
    </div>
    
    ${qrSection}
    
    <div class="separator"></div>
    
    <table>
      <thead>
        <tr>
          <th style="width: 52%;">Item</th>
          <th style="width: 14%;">Pack</th>
          <th style="width: 10%;">Qty</th>
          <th style="width: 12%;">Rate</th>
          <th style="width: 12%;">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${allItems
          .map(
            (item) => `
          <tr>
            <td>${item.name.length > 30 ? item.name.substring(0, 30) + "..." : item.name}</td>
            <td>${item.pack}</td>
            <td>${item.qty}</td>
            <td>${item.rate}</td>
            <td>${item.rate * item.qty}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
    
    <div class="separator"></div>
    
    <div class="summary-box">
      Items:${allItems.length}
      |Qty:${allItems.reduce((sum, item) => sum + item.qty, 0)}
      |Total:₹${totalValue || 0}
    </div>

    <div class="separator"></div>
    <div class="center disclaimer">
      MRP total is for reference. Bill may differ!
    </div>

    <div class="center thank-you">THANK YOU! VISIT AGAIN</div>
    
    <div class="center timestamp">
      ${new Date().toLocaleString()}
    </div>
  </body>
  </html>
`;

  return html;
}

async function generateGoddownReceiptHTML(printData, includeQR = true) {
  const {
    uniqueCode,
    scannedItems,
    addOns = [],
    totalValue,
    operatorName = "",
  } = printData;

  let qrSection = "";

  if (includeQR) {
    const qrDataString = buildGoddownQrPayloadWithAddOns(scannedItems, addOns);
    const qrCodeImage = await generateQRDataURL(qrDataString);

    qrSection = `
      <div class="separator"></div>
      <div class="qr-container">
        <img src="${qrCodeImage}" alt="QR Code" />
      </div>
    `;
  }

  let totalQuantity = 0;
  scannedItems.forEach((item) => (totalQuantity += item.quantity || 0));

  const allItems = [
    ...scannedItems.map((item, index) => ({
      no: index + 1,
      name:
        item.isMatched && item.brandName
          ? `${item.brandName || "Unknown Product"}`
          : item.value || "UNKNOWN",
      qty: item.quantity || 0,
      rate: item.isMatched ? item.mrp || 0 : "-",
      pack: item.pack || "-",
    })),
    ...addOns.map((addon, i) => ({
      no: scannedItems.length + i + 1,
      name: addon?.product || "ADD-ON",
      pack: "-",
      qty: addon.quantity || 0,
      rate: addon?.price || "-",
    })),
  ];

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Receipt ${uniqueCode}${includeQR ? "" : " (No QR)"}</title>
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
      .extra-bold { font-weight: 900; font-size: 16px; }
      .operator-name { font-size: 14px; margin-top: 2px; text-transform: uppercase; }
      .separator { 
        border-bottom: 2px solid #000; 
        margin: 3px 0;
      }
      .qr-container { 
        text-align: center; 
        margin: 5px 0;
      }
      .qr-container img { 
        width: 140px;
        height: 140px;
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
      }
      .summary-box {
        padding: 2px;
        font-size: 14px;
        text-align: center;
      }
      .thank-you {
        font-size: 14px;
        margin: 2px 0;
        text-transform: uppercase;
      }
      .disclaimer {
        font-size: 11px;
        margin: 2px 0;
      }
      .timestamp {
        font-size: 14px;
        margin-top: 3px;
      }
    </style>
  </head>
  <body>
    <div class="center">
      <div class="extra-bold">REF: ${uniqueCode}${includeQR ? "" : " (COPY)"}</div>
      ${
        operatorName
          ? `<div class="operator-name">Operator: ${operatorName}</div>`
          : ""
      }
      <div>Hi, here's your receipt${includeQR ? "" : " copy"}</div>
    </div>
    
    ${qrSection}
    
    <div class="separator"></div>
    
    <table>
      <thead>
        <tr>
          <th style="width: 52%;">Item</th>
          <th style="width: 14%;">Pack</th>
          <th style="width: 10%;">Qty</th>
          <th style="width: 12%;">Rate</th>
          <th style="width: 12%;">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${allItems
          .map(
            (item) => `
          <tr>
            <td>${item.name.length > 30 ? item.name.substring(0, 30) + "..." : item.name}</td>
            <td>${item.pack}</td>
            <td>${item.qty}</td>
            <td>${item.rate}</td>
            <td>${item.rate * item.qty}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
    
    <div class="separator"></div>
    
    <div class="summary-box">
      Items:${allItems.length}
      |Qty:${allItems.reduce((sum, item) => sum + item.qty, 0)}
      |Total:₹${totalValue || 0}
    </div>

    <div class="separator"></div>
    <div class="center disclaimer">
      MRP total is for reference. Bill may differ!
    </div>

    <div class="center thank-you">THANK YOU! VISIT AGAIN</div>
    
    <div class="center timestamp">
      ${new Date().toLocaleString()}
    </div>
  </body>
  </html>
`;

  return html;
}

// ============================================
// OPTIMIZED: HTML to Image (Reuses Browser)
// ============================================
async function htmlToImageAndSave(
  html,
  uniqueCode,
  suffix = "",
  perf,
  receiptBucket = RECEIPT_BUCKETS.SHOP
) {
  const browser = await getBrowserInstance();
  perf?.log(`Browser ready${suffix}`);
  
  try {
    const page = await browser.newPage();
    perf?.log(`New page created${suffix}`);
    
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    perf?.log(`HTML loaded${suffix}`);

    const dimensions = await page.evaluate(() => {
      const body = document.body;
      return {
        width: body.scrollWidth,
        height: body.scrollHeight,
      };
    });

    await page.setViewport({
      width: Math.max(384, dimensions.width),
      height: dimensions.height,
      deviceScaleFactor: 2,
    });

    const bucketInfo = getReceiptsBucketDir(receiptBucket);
    ensureDirExists(bucketInfo.dir);

    const htmlPath = path.join(
      bucketInfo.dir,
      `receipt_${uniqueCode}${suffix}.html`
    );
    const imagePath = path.join(
      bucketInfo.dir,
      `receipt_${uniqueCode}${suffix}.png`
    );

    fs.writeFileSync(htmlPath, html);
    perf?.log(`HTML saved${suffix}`);

    await page.screenshot({
      path: imagePath,
      fullPage: true,
      type: "png",
    });
    perf?.log(`Screenshot captured${suffix}`);

    await page.close();
    perf?.log(`Page closed${suffix}`);

    console.log(`✅ Receipt${suffix} saved: ${htmlPath}`);

    return {
      htmlPath,
      imagePath,
      success: true,
      dimensions,
    };
  } catch (error) {
    perf?.log(`ERROR rendering${suffix}: ${error.message}`);
    console.error(`Error generating receipt${suffix}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

function slicePng(png, offsetY, sliceHeight) {
  const slice = new PNG({ width: png.width, height: sliceHeight });
  const rowSize = png.width * 4;

  for (let y = 0; y < sliceHeight; y += 1) {
    const srcStart = (offsetY + y) * rowSize;
    const srcEnd = srcStart + rowSize;
    const destStart = y * rowSize;
    png.data.copy(slice.data, destStart, srcStart, srcEnd);
  }

  return slice;
}

async function printImageInSlices(printer, imagePath, options = {}, perf) {
  const {
    sliceHeight = DEFAULT_SLICE_HEIGHT_PX,
    align = "center",
    cutAfter = false,
  } = options;
  const imageBuffer = fs.readFileSync(imagePath);
  const png = PNG.sync.read(imageBuffer);
  const totalHeight = png.height;
  const effectiveSliceHeight = Math.max(1, Math.floor(sliceHeight));
  const totalSlices = Math.ceil(totalHeight / effectiveSliceHeight);
  perf?.log(
    `Image loaded for print: ${path.basename(imagePath)} (${png.width}x${png.height}), slices=${totalSlices}`
  );

  for (let sliceIndex = 0; sliceIndex < totalSlices; sliceIndex += 1) {
    perf?.log(`Printing slice ${sliceIndex + 1}/${totalSlices}`);
    const offsetY = sliceIndex * effectiveSliceHeight;
    const currentHeight = Math.min(
      effectiveSliceHeight,
      totalHeight - offsetY
    );
    const slice = slicePng(png, offsetY, currentHeight);
    const sliceBuffer = PNG.sync.write(slice);

    if (align === "center") {
      printer.alignCenter();
    } else if (align === "right") {
      printer.alignRight();
    } else {
      printer.alignLeft();
    }

    await printer.printImageBuffer(sliceBuffer);
    await printer.execute();
    printer.clear();
    perf?.log(`Slice ${sliceIndex + 1}/${totalSlices} sent`);
  }

  if (cutAfter) {
    perf?.log("Sending cut command");
    printer.cut();
    await printer.execute();
    printer.clear();
    perf?.log("Cut command completed");
  }

  return {
    width: png.width,
    height: png.height,
    slices: totalSlices,
  };
}

// ============================================
// OPTIMIZED: Print Function with Logging
// ============================================
async function printReceiptWithHTML(printer, printData) {
  const { uniqueCode } = printData;
  const perf = new PerformanceLogger(uniqueCode);

  try {
    perf.log("API request received");

    // Generate both HTMLs in parallel
    const [htmlWithQR, htmlWithoutQR] = await Promise.all([
      generateReceiptHTML(printData, true),
      generateReceiptHTML(printData, false)
    ]);
    perf.log("Both HTMLs generated");

    // Convert to images in parallel
    const [resultWithQR, resultWithoutQR] = await Promise.all([
      htmlToImageAndSave(
        htmlWithQR,
        uniqueCode,
        "_with_qr",
        perf,
        RECEIPT_BUCKETS.SHOP
      ),
      htmlToImageAndSave(
        htmlWithoutQR,
        uniqueCode,
        "_no_qr",
        perf,
        RECEIPT_BUCKETS.SHOP
      )
    ]);
    perf.log("Both images created");

    if (!resultWithQR.success || !resultWithoutQR.success) {
      throw new Error(
        `Receipt generation failed: ${
          resultWithQR.error || resultWithoutQR.error
        }`
      );
    }

    // Print both receipts
    perf.log("Sending to printer - Receipt 1");
    await printImageInSlices(
      printer,
      resultWithQR.imagePath,
      {
        cutAfter: true,
      },
      perf
    );
    perf.log("Receipt 1 printed");

    perf.log("Sending to printer - Receipt 2");
    await printImageInSlices(
      printer,
      resultWithoutQR.imagePath,
      {
        cutAfter: true,
      },
      perf
    );
    perf.log("Receipt 2 printed");

    try {
      await markPrinted("myapp", uniqueCode, "printed_success");
    } catch (error) {
      console.error("Failed to mark code as printed:", error.message);
    }

    const totalTime = perf.summary();

    return {
      success: true,
      message: "Both receipts printed successfully",
      referenceCode: uniqueCode,
      performanceMs: totalTime,
      receipts: {
        withQR: {
          htmlPath: resultWithQR.htmlPath,
          imagePath: resultWithQR.imagePath,
          viewPath: `/receipts/${RECEIPT_BUCKETS.SHOP}/receipt_${uniqueCode}_with_qr.html`,
        },
        withoutQR: {
          htmlPath: resultWithoutQR.htmlPath,
          imagePath: resultWithoutQR.imagePath,
          viewPath: `/receipts/${RECEIPT_BUCKETS.SHOP}/receipt_${uniqueCode}_no_qr.html`,
        },
      },
    };
  } catch (error) {
    perf.log(`ERROR: ${error.message}`);

    return {
      success: false,
      message: "Dual print failed: " + error.message,
    };
  }
}

async function printGoddownReceiptWithHTML(printer, printData) {
  const { uniqueCode } = printData;
  const perf = new PerformanceLogger(uniqueCode);

  try {
    perf.log("API request received");

    const htmlWithQR = await generateGoddownReceiptHTML(printData, true);
    perf.log("HTML generated");

    const resultWithQR = await htmlToImageAndSave(
      htmlWithQR,
      uniqueCode,
      "_with_qr",
      perf,
      RECEIPT_BUCKETS.GODDOWN
    );
    perf.log("Image created");

    if (!resultWithQR.success) {
      throw new Error(`Receipt generation failed: ${resultWithQR.error}`);
    }

    perf.log("Sending to printer");
    await printImageInSlices(
      printer,
      resultWithQR.imagePath,
      {
        cutAfter: true,
      },
      perf
    );
    perf.log("Receipt printed");

    try {
      await markPrinted("goddown", uniqueCode, "printed_success");
    } catch (error) {
      console.error("Failed to mark code as printed:", error.message);
    }

    const totalTime = perf.summary();

    return {
      success: true,
      message: "Receipt printed successfully",
      referenceCode: uniqueCode,
      performanceMs: totalTime,
      receipts: {
        withQR: {
          htmlPath: resultWithQR.htmlPath,
          imagePath: resultWithQR.imagePath,
          viewPath: `/receipts/${RECEIPT_BUCKETS.GODDOWN}/receipt_${uniqueCode}_with_qr.html`,
        },
      },
    };
  } catch (error) {
    perf.log(`ERROR: ${error.message}`);
    perf.summary();
    return {
      success: false,
      message: "Print failed: " + error.message,
    };
  }
}

async function printHtmlBlock(printer, htmlContent, jobLabel = "report", copies = 1) {
  if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
    throw new Error("Printable HTML content is required");
  }

  const sanitizedCopies = Math.max(1, parseInt(copies, 10) || 1);
  const uniqueCode = `${jobLabel}_${Date.now()}`;
  const perf = new PerformanceLogger(uniqueCode);
  perf.log("HTML print job received");
  
  const renderResult = await htmlToImageAndSave(
    htmlContent,
    uniqueCode,
    "_custom",
    perf,
    RECEIPT_BUCKETS.STOCKLENS
  );
  perf.log("HTML render complete");

  if (!renderResult.success) {
    perf.log(`Render failed: ${renderResult.error || "unknown error"}`);
    throw new Error(renderResult.error || "Failed to render printable HTML");
  }

  for (let i = 0; i < sanitizedCopies; i++) {
    perf.log(`Printing copy ${i + 1}/${sanitizedCopies}`);
    await printImageInSlices(
      printer,
      renderResult.imagePath,
      {
        cutAfter: true,
      },
      perf
    );
    perf.log(`Copy ${i + 1}/${sanitizedCopies} printed`);
  }

  perf.summary();

  return {
    referenceCode: uniqueCode,
    ...renderResult,
  };
}

async function printSampleSlip(printer, copies = 1) {
  const sanitizedCopies = Math.max(1, Math.min(10, parseInt(copies, 10) || 1));
  const referenceCode = `sample_${Date.now()}`;

  for (let i = 0; i < sanitizedCopies; i += 1) {
    printer.alignCenter();
    printer.println("HELLO");
    printer.println("HI");
    printer.println("THANKS");
    printer.println("");
    printer.cut();
    await printer.execute();
    printer.clear();
  }

  return {
    referenceCode,
    copiesPrinted: sanitizedCopies,
  };
}

function buildReceiptViewUrl(req, receiptEntry) {
  if (!receiptEntry || !receiptEntry.viewPath) {
    return receiptEntry;
  }
  const host = req.get("host");
  const protocol = req.protocol || "http";
  return {
    ...receiptEntry,
    viewUrl: `${protocol}://${host}${receiptEntry.viewPath}`,
  };
}

function attachReceiptViewUrls(req, result) {
  if (!result || !result.receipts) {
    return result;
  }

  const nextReceipts = {};
  Object.entries(result.receipts).forEach(([key, value]) => {
    nextReceipts[key] = buildReceiptViewUrl(req, value);
  });

  return {
    ...result,
    receipts: nextReceipts,
  };
}

// ============================================
// API ROUTES WITH DETAILED LOGGING
// ============================================
function registerPrinterRoutes(app) {
  app.get("/api/print/sample/:ip", async (req, res) => {
    const requestStart = Date.now();
    console.log(`\n🔷 NEW SAMPLE PRINT REQUEST: ${new Date().toISOString()}`);
    const requestLogger = createRequestStepLogger(
      `sample-${req.params.ip}-${requestStart}`
    );
    requestLogger.step("Request received");

    try {
      const printerIP = req.params.ip;
      const port = req.query.port || 9100;
      const copies = req.query.copies || 1;
      requestLogger.step("Parsed request parameters", {
        printerIP,
        port,
        copies,
      });

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`🧾 Sample copies: ${copies}`);

      if (!printerIP || typeof printerIP !== "string") {
        requestLogger.step("Validation failed: printer IP missing");
        return res.status(400).json({
          success: false,
          message: "Printer IP is required",
        });
      }

      const printer = createPrinterByIP(printerIP, port);
      requestLogger.step("Printer instance created");

      try {
        requestLogger.step("Checking printer connectivity");
        const connected = await printer.isPrinterConnected();
        if (connected === false) {
          throw new Error(`Printer not reachable at ${printerIP}:${port}`);
        }
        requestLogger.step("Printer connectivity confirmed");
      } catch (connectError) {
        requestLogger.error("Printer connectivity check", connectError);
        throw new Error(connectError.message || "Failed to verify printer connectivity");
      }

      requestLogger.step("Sending sample print");
      const result = await printSampleSlip(printer, copies);
      requestLogger.step("Sample print completed", result);
      const totalRequestTime = Date.now() - requestStart;
      console.log(`✅ Sample print request completed in ${totalRequestTime}ms\n`);

      return res.json({
        success: true,
        message: "Sample print sent to printer",
        printerIP,
        port,
        totalRequestTimeMs: totalRequestTime,
        ...result,
      });
    } catch (error) {
      const totalRequestTime = Date.now() - requestStart;
      requestLogger.error("Sample print request", error);
      console.error(
        `❌ Sample print failed after ${totalRequestTime}ms:`,
        error.message
      );

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to print sample",
        totalRequestTimeMs: totalRequestTime,
      });
    }
  });

  app.post("/api/print/ip/:ip", async (req, res) => {
    const requestStart = Date.now();
    console.log(`\n🔷 NEW PRINT REQUEST: ${new Date().toISOString()}`);
    const requestLogger = createRequestStepLogger(
      `print-${req.params.ip}-${requestStart}`
    );
    requestLogger.step("Request received");
    
    try {
      const printerIP = req.params.ip;
      const port = req.query.port || 9100;
      const { scannedItems, addOns, uniqueCode, totalValue, totalQuantity } = req.body;
      requestLogger.step("Parsed request payload", {
        printerIP,
        port,
        uniqueCode,
        items: scannedItems?.length || 0,
        addOns: addOns?.length || 0,
      });

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`📦 Items: ${scannedItems?.length || 0}, AddOns: ${addOns?.length || 0}`);

      if (!scannedItems || !Array.isArray(scannedItems)) {
        requestLogger.step("Validation failed: scannedItems missing/invalid");
        return res.status(400).json({
          success: false,
          message: "Invalid or missing scannedItems data",
        });
      }

      const printer = createPrinterByIP(printerIP, port);
      requestLogger.step("Printer instance created");
      const printData = {
        totalQuantity,
        totalValue,
        uniqueCode,
        scannedItems,
        addOns: addOns || [],
      };

      try {
        requestLogger.step("Writing print payload log");
        logPrintPayload(
          "myapp",
          {
            uniqueCode,
            scannedItems,
            addOns: addOns || [],
            totalValue,
            totalQuantity,
            itemsCount: scannedItems.length,
            addOnsCount: (addOns || []).length,
          },
          {
            printerIP,
            port,
          }
        );
        requestLogger.step("Print payload log saved");
      } catch (error) {
        requestLogger.error("Writing print payload log", error);
        console.error("Failed to log myApp print payload:", error.message);
      }

      requestLogger.step("Starting receipt render + print pipeline");
      const result = attachReceiptViewUrls(
        req,
        await printReceiptWithHTML(printer, printData)
      );
      requestLogger.step("Print pipeline finished", {
        success: result.success,
        message: result.message,
      });

      const totalRequestTime = Date.now() - requestStart;
      console.log(`✅ Total API request time: ${totalRequestTime}ms\n`);

      res.json({
        ...result,
        printerIP: printerIP,
        port: port,
        totalRequestTimeMs: totalRequestTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const totalRequestTime = Date.now() - requestStart;
      requestLogger.error("Print request", error);
      console.error(`❌ Request failed after ${totalRequestTime}ms:`, error.message);
      
      res.status(500).json({
        success: false,
        message: error.message,
        totalRequestTimeMs: totalRequestTime,
      });
    }
  });

  app.post("/api/print/ip-goddown/:ip", async (req, res) => {
    const requestStart = Date.now();
    console.log(`\n🔷 NEW GODDOWN PRINT REQUEST: ${new Date().toISOString()}`);
    const requestLogger = createRequestStepLogger(
      `goddown-print-${req.params.ip}-${requestStart}`
    );
    requestLogger.step("Request received");
    
    try {
      const printerIP = req.params.ip;
      const port = req.query.port || 9100;
      const {
        scannedItems,
        addOns,
        uniqueCode,
        totalValue,
        totalQuantity,
        operatorName,
      } = req.body;
      requestLogger.step("Parsed request payload", {
        printerIP,
        port,
        uniqueCode,
        items: scannedItems?.length || 0,
        addOns: addOns?.length || 0,
        operatorName: operatorName || "",
      });

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`📦 Items: ${scannedItems?.length || 0}, AddOns: ${addOns?.length || 0}`);
      console.log(`👤 Operator: ${operatorName || 'N/A'}`);

      if (!scannedItems || !Array.isArray(scannedItems)) {
        requestLogger.step("Validation failed: scannedItems missing/invalid");
        return res.status(400).json({
          success: false,
          message: "Invalid or missing scannedItems data",
        });
      }

      const operatorHeader = req.headers["x-operator-name"];
      const resolvedOperator =
        (operatorName || operatorHeader || "").toString().trim();

      const printer = createPrinterByIP(printerIP, port);
      requestLogger.step("Printer instance created");
      const printData = {
        totalQuantity,
        totalValue,
        uniqueCode,
        scannedItems,
        addOns: addOns || [],
        operatorName: resolvedOperator,
      };

      try {
        requestLogger.step("Writing print payload log");
        logPrintPayload(
          "goddown",
          {
            uniqueCode,
            operatorName: resolvedOperator,
            scannedItems,
            addOns: addOns || [],
            totalValue,
            totalQuantity,
            itemsCount: scannedItems.length,
            addOnsCount: (addOns || []).length,
          },
          {
            printerIP,
            port,
          }
        );
        requestLogger.step("Print payload log saved");
      } catch (error) {
        requestLogger.error("Writing print payload log", error);
        console.error("Failed to log goddown print payload:", error.message);
      }

      requestLogger.step("Starting receipt render + print pipeline");
      const result = attachReceiptViewUrls(
        req,
        await printGoddownReceiptWithHTML(printer, printData)
      );
      requestLogger.step("Print pipeline finished", {
        success: result.success,
        message: result.message,
      });

      const totalRequestTime = Date.now() - requestStart;
      console.log(`✅ Total API request time: ${totalRequestTime}ms\n`);

      res.json({
        ...result,
        printerIP: printerIP,
        port: port,
        totalRequestTimeMs: totalRequestTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const totalRequestTime = Date.now() - requestStart;
      requestLogger.error("Goddown print request", error);
      console.error(`❌ Request failed after ${totalRequestTime}ms:`, error.message);
      
      res.status(500).json({
        success: false,
        message: error.message,
        totalRequestTimeMs: totalRequestTime,
      });
    }
  });

  app.post("/api/print/html", async (req, res) => {
    const requestStart = Date.now();
    console.log(`\n🔷 NEW HTML PRINT REQUEST: ${new Date().toISOString()}`);
    const requestLogger = createRequestStepLogger(
      `html-print-${requestStart}`
    );
    requestLogger.step("Request received");
    
    try {
      const { printerIP, port = 9100, htmlContent, jobLabel = "cycle_report", copies = 1 } =
        req.body || {};
      requestLogger.step("Parsed request payload", {
        printerIP,
        port,
        jobLabel,
        copies,
        htmlLength: typeof htmlContent === "string" ? htmlContent.length : 0,
      });

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`📄 Job: ${jobLabel}, Copies: ${copies}`);

      if (!printerIP || typeof printerIP !== "string") {
        requestLogger.step("Validation failed: printerIP missing");
        return res.status(400).json({
          success: false,
          message: "Printer IP is required",
        });
      }

      if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
        requestLogger.step("Validation failed: htmlContent missing");
        return res.status(400).json({
          success: false,
          message: "Printable HTML content is required",
        });
      }

      const printer = createPrinterByIP(printerIP, port);
      requestLogger.step("Printer instance created");
      requestLogger.step("Starting HTML print pipeline");
      const result = await printHtmlBlock(printer, htmlContent, jobLabel, copies);
      requestLogger.step("HTML print pipeline finished", {
        success: true,
        referenceCode: result.referenceCode,
      });

      const totalRequestTime = Date.now() - requestStart;
      console.log(`✅ Total API request time: ${totalRequestTime}ms\n`);

      res.json({
        success: true,
        message: "Report sent to printer",
        printerIP,
        port,
        totalRequestTimeMs: totalRequestTime,
        ...result,
      });
    } catch (error) {
      const totalRequestTime = Date.now() - requestStart;
      requestLogger.error("HTML print request", error);
      console.error(`❌ HTML print failed after ${totalRequestTime}ms:`, error);
      
      res.status(500).json({
        success: false,
        message: error.message || "Failed to print report",
        totalRequestTimeMs: totalRequestTime,
      });
    }
  });

  ensureDirExists(RECEIPTS_DIR);
  ensureDirExists(getReceiptsBucketDir(RECEIPT_BUCKETS.SHOP).dir);
  ensureDirExists(getReceiptsBucketDir(RECEIPT_BUCKETS.GODDOWN).dir);
  ensureDirExists(getReceiptsBucketDir(RECEIPT_BUCKETS.STOCKLENS).dir);
  app.use("/receipts", express.static(RECEIPTS_DIR));

  app.get("/api/print/status", (req, res) => {
    res.json({
      success: true,
      browserActive: browserInstance !== null && browserInstance.isConnected(),
      currentCounter: codeCounter,
      usedCodesCount: usedCodes.size,
      lastFewCodes: Array.from(usedCodes).slice(-5),
    });
  });
}

module.exports = registerPrinterRoutes;
module.exports.createPrinterByIP = createPrinterByIP;
module.exports.printHtmlBlock = printHtmlBlock;
module.exports.htmlToImageAndSave = htmlToImageAndSave;
