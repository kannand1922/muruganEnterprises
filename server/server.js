const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { printerServerPort } = require("../shared/config/ports");
const { stockLensPaths, adminPasswordFile } = require("./path/path");

const registerCycleRoutes = require("./routes/cycle");
const registerPrinterRoutes = require("./routes/printer");

const app = express();

let server;
let isShuttingDown = false;

const shutdown = (reason, exitCode = 0) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  if (reason) {
    console.error(`Shutting down (${reason})...`);
  }
  if (server) {
    server.close(() => {
      process.exit(exitCode);
    });
    setTimeout(() => {
      process.exit(exitCode);
    }, 10_000).unref();
  } else {
    process.exit(exitCode);
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
const adminPasswordPath = adminPasswordFile;

const readAdminConfigValue = (key) => {
  try {
    const raw = fs.readFileSync(adminPasswordPath, "utf8");
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
    console.warn(
      `⚠️ Unable to read admin config (${adminPasswordPath}): ${error.message}`
    );
    return "";
  }
};

const readRequiredBuildNumber = () => {
  const required = readAdminConfigValue("required_build");
  return required || "1";
};

registerCycleRoutes(app);
registerPrinterRoutes(app);

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
  console.log("  GET  /api/products - List products");
  console.log("  GET  /api/allprinters - List printers");
  console.log("  GET  /api/brands - List brands");
  console.log("  GET  /api/app/version - App build requirement");
  console.log("  POST /api/cycle/:date/product - Add/Update product");
  console.log("  DELETE /api/cycle/:date/product - Delete product");
  console.log("  GET  /api/cycle/:date - Get cycle CSV data");
  console.log("  GET  /api/cycle/:date/match?brand=X&pack=Y - Match product");
  console.log("  GET  /api/cycle/:date/product?brand=X&pack=Y - Get product details");
  console.log("  POST /api/cycle/start - Start a cycle");
  console.log("  POST /api/cycle/stop - Stop a cycle");
  console.log("  GET  /api/cycle/current - Get active cycle");
  console.log("  GET  /api/cycle/all - List cycles");
  console.log("  POST /api/print/ip/:ip - Print receipt");
  console.log("  POST /api/print/ip-goddown/:ip - Print receipt (Goddown QR)");
  console.log("  GET  /api/print/sample/:ip - Print sample slip");
  console.log("  POST /api/print/html - Print custom HTML report");
  console.log("  GET  /api/print/status - Print status");
});

module.exports = app;
