const express = require("express");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const { PNG } = require("pngjs");
const { printLogPaths } = require("../path/path");
const { defaultPrinterPort } = require("../../shared/config/ports");
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
} = require("node-thermal-printer");
const { markPrinted } = require("../pool/codePool");

let usedCodes = new Set();
let codeCounter = 1;
const DEFAULT_SLICE_HEIGHT_PX = 1200;

const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

async function getBrowserInstance() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (browserInitPromise) {
    return browserInitPromise;
  }

  browserInitPromise = puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu"
    ],
  }).then(browser => {
    browserInstance = browser;
    browserInitPromise = null;
    console.log("✅ Browser instance initialized");
    return browser;
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
  }

  log(label) {
    const elapsed = Date.now() - this.startTime;
    this.checkpoints.push({ label, elapsed });
    console.log(`⏱️  [${this.jobId}] ${label}: ${elapsed}ms`);
  }

  summary() {
    const total = Date.now() - this.startTime;
    console.log(`\n📊 Performance Summary [${this.jobId}]:`);
    this.checkpoints.forEach(cp => {
      console.log(`   ${cp.label}: ${cp.elapsed}ms`);
    });
    console.log(`   TOTAL TIME: ${total}ms\n`);
    return total;
  }
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

function createPrinterByIP(ip, printerPort = defaultPrinterPort) {
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
async function htmlToImageAndSave(html, uniqueCode, suffix = "", perf) {
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

    const receiptsDir = path.join(__dirname, "..", "receipts");
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const htmlPath = path.join(
      receiptsDir,
      `receipt_${uniqueCode}${suffix}.html`
    );
    const imagePath = path.join(
      receiptsDir,
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

async function printImageInSlices(printer, imagePath, options = {}) {
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

  for (let sliceIndex = 0; sliceIndex < totalSlices; sliceIndex += 1) {
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
  }

  if (cutAfter) {
    printer.cut();
    await printer.execute();
    printer.clear();
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

    // Lock the code as soon as a print is initiated to prevent reuse,
    // even if a later step fails after the printer has already started.
    try {
      await markPrinted("myapp", uniqueCode, "print_started");
    } catch (error) {
      console.error("Failed to lock code on print start:", error.message);
    }

    // Generate both HTMLs in parallel
    const [htmlWithQR, htmlWithoutQR] = await Promise.all([
      generateReceiptHTML(printData, true),
      generateReceiptHTML(printData, false)
    ]);
    perf.log("Both HTMLs generated");

    // Convert to images in parallel
    const [resultWithQR, resultWithoutQR] = await Promise.all([
      htmlToImageAndSave(htmlWithQR, uniqueCode, "_with_qr", perf),
      htmlToImageAndSave(htmlWithoutQR, uniqueCode, "_no_qr", perf)
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
    await printImageInSlices(printer, resultWithQR.imagePath, {
      cutAfter: true,
    });
    perf.log("Receipt 1 printed");

    perf.log("Sending to printer - Receipt 2");
    await printImageInSlices(printer, resultWithoutQR.imagePath, {
      cutAfter: true,
    });
    perf.log("Receipt 2 printed");

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
          viewUrl: `http://localhost:3000/receipt/${uniqueCode}_with_qr.html`,
        },
        withoutQR: {
          htmlPath: resultWithoutQR.htmlPath,
          imagePath: resultWithoutQR.imagePath,
          viewUrl: `http://localhost:3000/receipt/${uniqueCode}_no_qr.html`,
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

    // Lock the code as soon as a print is initiated to prevent reuse,
    // even if a later step fails after the printer has already started.
    try {
      await markPrinted("goddown", uniqueCode, "print_started");
    } catch (error) {
      console.error("Failed to lock code on print start:", error.message);
    }

    const htmlWithQR = await generateGoddownReceiptHTML(printData, true);
    perf.log("HTML generated");

    const resultWithQR = await htmlToImageAndSave(
      htmlWithQR,
      uniqueCode,
      "_with_qr",
      perf
    );
    perf.log("Image created");

    if (!resultWithQR.success) {
      throw new Error(`Receipt generation failed: ${resultWithQR.error}`);
    }

    perf.log("Sending to printer");
    await printImageInSlices(printer, resultWithQR.imagePath, {
      cutAfter: true,
    });
    perf.log("Receipt printed");

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
          viewUrl: `http://localhost:3000/receipt/${uniqueCode}_with_qr.html`,
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
  
  const renderResult = await htmlToImageAndSave(htmlContent, uniqueCode, "_custom", perf);

  if (!renderResult.success) {
    throw new Error(renderResult.error || "Failed to render printable HTML");
  }

  for (let i = 0; i < sanitizedCopies; i++) {
    await printImageInSlices(printer, renderResult.imagePath, {
      cutAfter: true,
    });
  }

  perf.summary();

  return {
    referenceCode: uniqueCode,
    ...renderResult,
  };
}

// ============================================
// API ROUTES WITH DETAILED LOGGING
// ============================================
function registerPrinterRoutes(app) {
  app.post("/api/print/ip/:ip", async (req, res) => {
    const requestStart = Date.now();
    console.log(`\n🔷 NEW PRINT REQUEST: ${new Date().toISOString()}`);
    
    try {
      const printerIP = req.params.ip;
      const port = req.query.port || defaultPrinterPort;
      const { scannedItems, addOns, uniqueCode, totalValue, totalQuantity } = req.body;

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`📦 Items: ${scannedItems?.length || 0}, AddOns: ${addOns?.length || 0}`);

      if (!scannedItems || !Array.isArray(scannedItems)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing scannedItems data",
        });
      }

      const printer = createPrinterByIP(printerIP, port);
      const printData = {
        totalQuantity,
        totalValue,
        uniqueCode,
        scannedItems,
        addOns: addOns || [],
      };

      try {
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
      } catch (error) {
        console.error("Failed to log myApp print payload:", error.message);
      }

      const result = await printReceiptWithHTML(printer, printData);

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
    
    try {
      const printerIP = req.params.ip;
      const port = req.query.port || defaultPrinterPort;
      const {
        scannedItems,
        addOns,
        uniqueCode,
        totalValue,
        totalQuantity,
        operatorName,
      } = req.body;

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`📦 Items: ${scannedItems?.length || 0}, AddOns: ${addOns?.length || 0}`);
      console.log(`👤 Operator: ${operatorName || 'N/A'}`);

      if (!scannedItems || !Array.isArray(scannedItems)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing scannedItems data",
        });
      }

      const operatorHeader = req.headers["x-operator-name"];
      const resolvedOperator =
        (operatorName || operatorHeader || "").toString().trim();

      const printer = createPrinterByIP(printerIP, port);
      const printData = {
        totalQuantity,
        totalValue,
        uniqueCode,
        scannedItems,
        addOns: addOns || [],
        operatorName: resolvedOperator,
      };

      try {
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
      } catch (error) {
        console.error("Failed to log goddown print payload:", error.message);
      }

      const result = await printGoddownReceiptWithHTML(printer, printData);

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
    
    try {
      const { printerIP, port = defaultPrinterPort, htmlContent, jobLabel = "cycle_report", copies = 1 } =
        req.body || {};

      console.log(`📍 Printer IP: ${printerIP}:${port}`);
      console.log(`📄 Job: ${jobLabel}, Copies: ${copies}`);

      if (!printerIP || typeof printerIP !== "string") {
        return res.status(400).json({
          success: false,
          message: "Printer IP is required",
        });
      }

      if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
        return res.status(400).json({
          success: false,
          message: "Printable HTML content is required",
        });
      }

      const printer = createPrinterByIP(printerIP, port);
      const result = await printHtmlBlock(printer, htmlContent, jobLabel, copies);

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
      console.error(`❌ HTML print failed after ${totalRequestTime}ms:`, error);
      
      res.status(500).json({
        success: false,
        message: error.message || "Failed to print report",
        totalRequestTimeMs: totalRequestTime,
      });
    }
  });

  app.use("/receipts", express.static(path.join(__dirname, "..", "receipts")));

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
