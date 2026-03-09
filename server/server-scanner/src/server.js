const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { prisma } = require("./prisma");
const { stockLensScannerConfigPaths } = require("../../../shared/config/paths");

const cyclesRouter = require("./routes/cycles");
const stockRouter = require("./routes/stock");
const metaRouter = require("./routes/meta");
const desktopRouter = require("./routes/desktop");
const myAppCommonRouter = require("./routes/myAppCommon");
const { startLowStockMonitor, stopLowStockMonitor } = require("./services/lowStockMonitor");
const {
  startUnfinishedAutoFinishService,
  stopUnfinishedAutoFinishService,
} = require("./services/unfinishedAutoFinish");

const app = express();
const port = Number(process.env.PORT || 3010);
let server = null;
let isShuttingDown = false;

app.use(cors());
app.use(express.json());

const REQUIRED_BUILD_FILE = stockLensScannerConfigPaths.requiredBuildFile;

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
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (error) {
    res.status(500).json({ ok: false, db: "error", error: error.message });
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
app.use("/desktop", desktopRouter);

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ success: false, message: error.message || "Internal error" });
});

server = app.listen(port, () => {
  console.log(`Prisma server listening on http://localhost:${port}`);
  void startLowStockMonitor();
  void startUnfinishedAutoFinishService();
});

const shutdown = async (reason = "shutdown", exitCode = 0) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.error(`Shutting down scanner server (${reason})...`);
  stopLowStockMonitor();
  stopUnfinishedAutoFinishService();
  if (server) {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(exitCode);
    });
    setTimeout(() => {
      process.exit(exitCode);
    }, 10_000).unref();
    return;
  }
  await prisma.$disconnect();
  process.exit(exitCode);
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
