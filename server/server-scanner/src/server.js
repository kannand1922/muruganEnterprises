const http = require("http");
const https = require("https");
const os = require("os");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { prisma } = require("./prisma");
const { centralPrisma } = require("./centralPrisma");
const { stockLensScannerConfigPaths } = require("../../../shared/config/paths");

const cyclesRouter = require("./routes/cycles");
const stockRouter = require("./routes/stock");
const metaRouter = require("./routes/meta");
const desktopRouter = require("./routes/desktop");
const dbViewerRouter = require("./routes/dbViewer");
const myAppCommonRouter = require("./routes/myAppCommon");
const { startLowStockMonitor, stopLowStockMonitor } = require("./services/lowStockMonitor");
const {
  startCentralCatalogSync,
  stopCentralCatalogSync,
} = require("./services/centralCatalogSync");
const {
  startUnfinishedAutoFinishService,
  stopUnfinishedAutoFinishService,
} = require("./services/unfinishedAutoFinish");

const app = express();
const port = Number(process.env.PORT || 3010);
const httpsPort = Number(process.env.HTTPS_PORT || 3443);
let httpServer = null;
let httpsServer = null;
let isShuttingDown = false;

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "../../public")));

const REQUIRED_BUILD_FILE = stockLensScannerConfigPaths.requiredBuildFile;
const SSL_CERT_PATH_FILE = stockLensScannerConfigPaths.scannerSslCertPathFile;
const SSL_KEY_PATH_FILE = stockLensScannerConfigPaths.scannerSslKeyPathFile;
const CENTRAL_ALLOWED_ORIGINS_FILE = stockLensScannerConfigPaths.centralAllowedOriginsFile;

function loadSelfsignedModule() {
  try {
    return require("selfsigned");
  } catch (primaryError) {
    try {
      return require(path.resolve(__dirname, "../../node_modules/selfsigned"));
    } catch (fallbackError) {
      throw primaryError;
    }
  }
}

function readOptionalTextFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const value = String(raw || "").trim();
    return value || null;
  } catch {
    return null;
  }
}

function readAllowedOriginsFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function isLocalBrowserOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function buildCorsOptions() {
  const configuredOrigins = new Set(readAllowedOriginsFile(CENTRAL_ALLOWED_ORIGINS_FILE));
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (configuredOrigins.has(origin) || isLocalBrowserOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  };
}

app.use(cors(buildCorsOptions()));

function getLocalIpAltNames() {
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
}

async function resolveHttpsCredentials() {
  const configuredCertPath = readOptionalTextFile(SSL_CERT_PATH_FILE);
  const configuredKeyPath = readOptionalTextFile(SSL_KEY_PATH_FILE);
  const candidatePairs = [
    {
      cert: process.env.SCANNER_SSL_CERT_FILE || process.env.SERVER_SSL_CERT_FILE,
      key: process.env.SCANNER_SSL_KEY_FILE || process.env.SERVER_SSL_KEY_FILE,
    },
    {
      cert: configuredCertPath,
      key: configuredKeyPath,
    },
    {
      cert: path.resolve(__dirname, "../../stocklens-new/certs/dev-cert.pem"),
      key: path.resolve(__dirname, "../../stocklens-new/certs/dev-key.pem"),
    },
    {
      cert: path.resolve(__dirname, "../../certs/dev-cert.pem"),
      key: path.resolve(__dirname, "../../certs/dev-key.pem"),
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
      generated: false,
    };
  }

  const selfsigned = loadSelfsignedModule();
  const generated = await selfsigned.generate(
    [
      { name: "commonName", value: "localhost" },
      { name: "organizationName", value: "StockLens Scanner Dev" },
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
}

function readRequiredBuild() {
  try {
    const raw = fs.readFileSync(REQUIRED_BUILD_FILE, "utf8");
    const value = String(raw || "").trim();
    return value || "1";
  } catch (error) {
    console.warn(`⚠️ Unable to read required-build.txt: ${error.message}`);
    return "1";
  }
}

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

app.get("/api/app/version", (req, res) => {
  const requiredBuild = readRequiredBuild();
  res.json({ success: true, requiredBuild });
});

app.use("/api", myAppCommonRouter);
app.use("/api/cycles", cyclesRouter);
app.use("/api/stock", stockRouter);
app.use("/api/meta", metaRouter);
app.use("/api/db-viewer", dbViewerRouter);
app.use("/desktop", desktopRouter);

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ success: false, message: error.message || "Internal error" });
});

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

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Prisma server listening on http://localhost:${port}`);
  });

  httpsServer.listen(httpsPort, "0.0.0.0", () => {
    console.log(`Prisma server listening on https://localhost:${httpsPort}`);
    if (httpsCredentials.generated) {
      console.log("HTTPS cert: auto-generated self-signed development certificate");
    } else {
      console.log(`HTTPS cert: ${httpsCredentials.certPath}`);
      console.log(`HTTPS key: ${httpsCredentials.keyPath}`);
    }
  });

  void startLowStockMonitor();
  void startCentralCatalogSync();
  void startUnfinishedAutoFinishService();
}

void startServer().catch((error) => {
  console.error("Failed to start scanner server:", error);
  process.exit(1);
});

const shutdown = async (reason = "shutdown", exitCode = 0) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.error(`Shutting down scanner server (${reason})...`);
  stopLowStockMonitor();
  stopCentralCatalogSync();
  stopUnfinishedAutoFinishService();
  const runningServers = [httpServer, httpsServer].filter(Boolean);
  if (runningServers.length === 0) {
    await Promise.all([prisma.$disconnect(), centralPrisma.$disconnect()]);
    process.exit(exitCode);
    return;
  }

  let pending = runningServers.length;
  const finishClose = async () => {
    pending -= 1;
    if (pending > 0) return;
    await Promise.all([prisma.$disconnect(), centralPrisma.$disconnect()]);
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
};

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  void shutdown("unhandledRejection", 1);
});

module.exports = app;
