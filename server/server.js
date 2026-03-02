const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { printerServerPort } = require("../shared/config/ports");
const {
  stockLensPaths,
  stockLensScannerConfigPaths,
} = require("./path/path");

if (!process.env.DATABASE_URL) {
  const defaultSqlitePath = path.join(
    stockLensPaths.dbDir || stockLensPaths.dataDir,
    "stocklens_prisma.sqlite"
  );
  process.env.DATABASE_URL = `file:${defaultSqlitePath}`;
}

const { prisma } = require("./server-scanner/src/prisma");
const registerPrinterRoutes = require("./server-printer/registerPrinterRoutes");
const newCyclesRouter = require("./server-scanner/src/routes/cycles");
const newStockRouter = require("./server-scanner/src/routes/stock");
const newMetaRouter = require("./server-scanner/src/routes/meta");
const newDesktopRouter = require("./server-scanner/src/routes/desktop");

const app = express();

let server;
let isShuttingDown = false;

const REQUIRED_BUILD_FILE = path.resolve(stockLensScannerConfigPaths.requiredBuildFile);

const closePrisma = async () => {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.warn(`⚠️ Prisma disconnect failed: ${error.message}`);
  }
};

const shutdown = (reason, exitCode = 0) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  if (reason) {
    console.error(`Shutting down (${reason})...`);
  }
  if (server) {
    server.close(async () => {
      await closePrisma();
      process.exit(exitCode);
    });
    setTimeout(() => {
      process.exit(exitCode);
    }, 10_000).unref();
  } else {
    closePrisma().finally(() => process.exit(exitCode));
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  shutdown("unhandledRejection", 1);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const brandsCsvPath = stockLensPaths.brandsCsv;

const readRequiredBuildNumber = () => {
  try {
    const raw = fs.readFileSync(REQUIRED_BUILD_FILE, "utf8");
    const value = String(raw || "").trim();
    return value || "1";
  } catch (error) {
    console.warn(
      `⚠️ Unable to read required build config (${REQUIRED_BUILD_FILE}): ${error.message}`
    );
    return "1";
  }
};

registerPrinterRoutes(app);

app.get("/new/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (error) {
    res.status(500).json({ ok: false, db: "error", error: error.message });
  }
});

app.get("/new/api/app/version", (req, res) => {
  const requiredBuild = readRequiredBuildNumber();
  res.json({ success: true, requiredBuild });
});

app.use("/new/api/cycles", newCyclesRouter);
app.use("/new/api/stock", newStockRouter);
app.use("/new/api/meta", newMetaRouter);
app.use("/new/desktop", newDesktopRouter);

app.get("/api/app/version", (req, res) => {
  const requiredBuild = readRequiredBuildNumber();
  res.json({ success: true, requiredBuild });
});

const logBrandsCsvModifiedTime = () => {
  try {
    const stats = fs.statSync(brandsCsvPath);
    console.log(
      `brands.csv last modified: ${stats.mtime.toLocaleString()} (${brandsCsvPath})`
    );
  } catch (error) {
    console.error(`Unable to read ${brandsCsvPath}: ${error.message}`);
  }
};

server = app.listen(printerServerPort, "0.0.0.0", () => {
  console.log(
    `Thermal printer server running on http://localhost:${printerServerPort}`
  );
  logBrandsCsvModifiedTime();
  console.log("Available endpoints:");
  console.log("  GET  /new/health - New StockLens health");
  console.log("  GET  /new/api/app/version - New StockLens build requirement");
  console.log("  GET  /new/api/meta/* - New StockLens metadata");
  console.log("  GET  /new/api/stock/* - New StockLens stock routes");
  console.log("  GET  /new/api/cycles/* - New StockLens cycle routes");
  console.log("  GET  /new/desktop/api/* - Desktop compatibility routes");
  console.log("  GET  /api/products - List products");
  console.log("  GET  /api/allprinters - List printers");
  console.log("  GET  /api/brands - List brands");
  console.log("  GET  /api/app/version - App build requirement");
  console.log("  POST /api/print/ip/:ip - Print receipt");
  console.log("  POST /api/print/ip-goddown/:ip - Print receipt (Goddown QR)");
  console.log("  GET  /api/print/sample/:ip - Print sample slip");
  console.log("  POST /api/print/html - Print custom HTML report");
  console.log(
    "  POST /api/print/difference-report/:date?scope=today|total&printer=IP - Print diff report"
  );
  console.log(
    "  POST /api/print/difference-by-person/:date?mode=individual|common&printer=IP - Print person diff report"
  );
  console.log("  GET  /api/print/status - Print status");
});

module.exports = app;
