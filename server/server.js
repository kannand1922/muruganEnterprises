const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const fs = require("fs");
const selfsigned = require("selfsigned");
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
const { centralPrisma } = require("./server-scanner/src/centralPrisma");
const registerPrinterRoutes = require("./server-printer/registerPrinterRoutes");
const newCyclesRouter = require("./server-scanner/src/routes/cycles");
const newStockRouter = require("./server-scanner/src/routes/stock");
const newMetaRouter = require("./server-scanner/src/routes/meta");
const newDbViewerRouter = require("./server-scanner/src/routes/dbViewer");
const newDesktopRouter = require("./server-scanner/src/routes/desktop");
const myAppCommonRouter = require("./server-scanner/src/routes/myAppCommon");
const {
  startLowStockMonitor,
  stopLowStockMonitor,
} = require("./server-scanner/src/services/lowStockMonitor");
const {
  startUnfinishedAutoFinishService,
  stopUnfinishedAutoFinishService,
} = require("./server-scanner/src/services/unfinishedAutoFinish");
const {
  startCentralCatalogSync,
  stopCentralCatalogSync,
} = require("./server-scanner/src/services/centralCatalogSync");

const app = express();

let httpServer;
let httpsServer;
let isShuttingDown = false;

const REQUIRED_BUILD_FILE = path.resolve(stockLensScannerConfigPaths.requiredBuildFile);
const DEFAULT_HTTPS_PORT = Number(process.env.PRINTER_SERVER_HTTPS_PORT || 4010);

const renderServerLauncherPage = () => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StockLens Server</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #f5f7fb;
        color: #14213d;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(81, 125, 255, 0.18), transparent 40%),
          linear-gradient(180deg, #f8fbff 0%, #eef3fb 100%);
      }

      main {
        width: min(100%, 520px);
        padding: 32px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 18px 50px rgba(20, 33, 61, 0.12);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 1.75rem;
      }

      p {
        margin: 0 0 24px;
        color: #42526b;
        line-height: 1.5;
      }

      .actions {
        display: grid;
        gap: 14px;
      }

      button {
        width: 100%;
        border: 0;
        border-radius: 14px;
        padding: 16px 18px;
        font: inherit;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
      }

      button[data-target="app"] {
        background: linear-gradient(135deg, #f97316, #ea580c);
      }

      button[data-target="stocklens"] {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
      }

      .meta {
        margin-top: 20px;
        font-size: 0.95rem;
        color: #5b6b84;
      }

      code {
        font-family: "SFMono-Regular", Consolas, monospace;
        background: #edf2ff;
        color: #1e3a8a;
        padding: 2px 6px;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Server Ready</h1>
      <p>
        HTTPS is working. Use the buttons below to open this server on the required
        ports.
      </p>

      <div class="actions">
        <button type="button" data-target="app">Stock · HTTPS port 4100</button>
        <button type="button" data-target="stocklens">Scanner · HTTPS port 4200</button>
      </div>

      <div class="meta">
        Current host: <code id="current-host">loading...</code>
      </div>
    </main>

    <script>
      const host = window.location.hostname || "localhost";
      document.getElementById("current-host").textContent = host;

      const targets = {
        app: "https://" + host + ":4100/",
        stocklens: "https://" + host + ":4200/",
      };

      document.querySelectorAll("button[data-target]").forEach((button) => {
        button.addEventListener("click", () => {
          window.open(targets[button.dataset.target], "_blank", "noopener,noreferrer");
        });
      });
    </script>
  </body>
</html>`;

const getLocalIpAltNames = () => {
  const interfaces = os.networkInterfaces();
  const altNames = [];

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal) return;
      if (entry.family !== "IPv4") return;
      altNames.push({ type: 7, ip: entry.address });
    });
  });

  return altNames;
};

const resolveHttpsCredentials = async () => {
  const candidatePairs = [
    {
      cert: process.env.SERVER_SSL_CERT_FILE,
      key: process.env.SERVER_SSL_KEY_FILE,
    },
    {
      cert: path.resolve(__dirname, "../stocklens-new/certs/dev-cert.pem"),
      key: path.resolve(__dirname, "../stocklens-new/certs/dev-key.pem"),
    },
    {
      cert: path.resolve(__dirname, "certs/dev-cert.pem"),
      key: path.resolve(__dirname, "certs/dev-key.pem"),
    },
  ];

  for (const pair of candidatePairs) {
    const certPath = String(pair.cert || "").trim();
    const keyPath = String(pair.key || "").trim();
    if (!certPath || !keyPath) continue;
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) continue;

    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      certPath,
      keyPath,
    };
  }

  const generated = await selfsigned.generate(
    [
      { name: "commonName", value: "localhost" },
      { name: "organizationName", value: "StockLens Dev" },
    ],
    {
      algorithm: "sha256",
      days: 30,
      keySize: 2048,
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
            ...getLocalIpAltNames(),
          ],
        },
      ],
    }
  );

  return {
    cert: generated.cert,
    key: generated.private,
    generated: true,
  };
};

const closePrisma = async () => {
  try {
    await Promise.all([prisma.$disconnect(), centralPrisma.$disconnect()]);
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
  stopLowStockMonitor();
  stopUnfinishedAutoFinishService();
  stopCentralCatalogSync();
  const runningServers = [httpServer, httpsServer].filter(Boolean);
  if (runningServers.length > 0) {
    let pending = runningServers.length;
    const finishClose = async () => {
      pending -= 1;
      if (pending > 0) return;
      await closePrisma();
      process.exit(exitCode);
    };

    runningServers.forEach((instance) => {
      instance.close(() => {
        void finishClose();
      });
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
app.use(express.json({ limit: "15mb" }));
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
app.use("/api", myAppCommonRouter);

app.get("/", (req, res) => {
  res.type("html").send(renderServerLauncherPage());
});

app.get("/new/health", async (req, res) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, centralPrisma.$queryRaw`SELECT 1`]);
    res.json({
      ok: true,
      db: {
        stock: "connected",
        central: "connected",
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      db: {
        stock: "error",
        central: "error",
      },
      error: error.message,
    });
  }
});

app.get("/health", async (req, res) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, centralPrisma.$queryRaw`SELECT 1`]);
    res.json({
      ok: true,
      db: {
        stock: "connected",
        central: "connected",
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      db: {
        stock: "error",
        central: "error",
      },
      error: error.message,
    });
  }
});

app.get("/new/api/app/version", (req, res) => {
  const requiredBuild = readRequiredBuildNumber();
  res.json({ success: true, requiredBuild });
});

app.use("/new/api/cycles", newCyclesRouter);
app.use("/new/api/stock", newStockRouter);
app.use("/new/api/meta", newMetaRouter);
app.use("/new/api/db-viewer", newDbViewerRouter);
app.use("/new/desktop", newDesktopRouter);
app.use("/api/cycles", newCyclesRouter);
app.use("/api/stock", newStockRouter);
app.use("/api/meta", newMetaRouter);
app.use("/api/db-viewer", newDbViewerRouter);
app.use("/desktop", newDesktopRouter);

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

async function startServer() {
  const httpsCredentials = await resolveHttpsCredentials();

  httpServer = http.createServer(app);
  httpsServer = https.createServer(
    {
      cert: httpsCredentials.cert,
      key: httpsCredentials.key,
    },
    app
  );

  httpServer.listen(printerServerPort, "0.0.0.0", () => {
    console.log(
      `Thermal printer server running on http://localhost:${printerServerPort}`
    );
  });

  httpsServer.listen(DEFAULT_HTTPS_PORT, "0.0.0.0", () => {
    console.log(
      `Thermal printer server running on https://localhost:${DEFAULT_HTTPS_PORT}`
    );
    if (httpsCredentials.generated) {
      console.log("HTTPS cert: auto-generated self-signed development certificate");
    } else {
      console.log(`HTTPS cert: ${httpsCredentials.certPath}`);
      console.log(`HTTPS key: ${httpsCredentials.keyPath}`);
    }
  });

  logBrandsCsvModifiedTime();
  void startLowStockMonitor();
  void startUnfinishedAutoFinishService();
  void startCentralCatalogSync();
  console.log("Available endpoints:");
  console.log("  GET  /health - StockLens health");
  console.log("  GET  /new/health - New StockLens health");
  console.log("  GET  /api/meta/* - StockLens metadata");
  console.log("  GET  /api/stock/* - StockLens stock routes");
  console.log("  GET  /api/cycles/* - StockLens cycle routes");
  console.log("  GET  /api/db-viewer/* - StockLens DB viewer routes");
  console.log("  GET  /desktop/api/* - Desktop compatibility routes");
  console.log("  GET  /new/api/app/version - New StockLens build requirement");
  console.log("  GET  /new/api/meta/* - New StockLens metadata");
  console.log("  GET  /new/api/stock/* - New StockLens stock routes");
  console.log("  GET  /new/api/cycles/* - New StockLens cycle routes");
  console.log("  GET  /new/api/db-viewer/* - New StockLens DB viewer routes");
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
}

void startServer().catch((error) => {
  console.error("Failed to start server:", error);
  shutdown("startup_failure", 1);
});

module.exports = app;
