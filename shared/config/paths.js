const path = require("path");

const SHARED_ROOT = path.join(__dirname, "..");
const DATA_ROOT = path.join(SHARED_ROOT, "data");
const CONFIG_DIR = path.join(SHARED_ROOT, "config");
const LOGS_DIR = path.join(DATA_ROOT, "logs");
const CODE_POOL_DIR = path.join(DATA_ROOT, "codePools");
const MY_APP_DIR = path.join(DATA_ROOT, "scanner");
const STOCK_LENS_DIR = path.join(DATA_ROOT, "stock");
const STOCK_LENS_CYCLES_DIR = path.join(STOCK_LENS_DIR, "cycles");

const adminPasswordFile = path.join(CONFIG_DIR, "admin-password.txt");

const myAppPaths = {
  dataDir: MY_APP_DIR,
  productsCsv: path.join(MY_APP_DIR, "products.csv"),
  printersCsv: path.join(MY_APP_DIR, "printers.csv"),
  brandsCsv: "M://STOCK.csv",
};

const stockLensPaths = {
  dataDir: STOCK_LENS_DIR,
  cyclesDir: STOCK_LENS_CYCLES_DIR,
  productsCsv: path.join(STOCK_LENS_DIR, "products.csv"),
  printersCsv: path.join(STOCK_LENS_DIR, "printers.csv"),
  brandsCsv: "M://STOCK.csv",
  cycleManagementCsv: path.join(STOCK_LENS_DIR, "cycle.csv"),
  bestSellingCsv: path.join(STOCK_LENS_DIR, "bestselling.csv"),
  workerCsv: path.join(STOCK_LENS_DIR, "worker.csv"),
};

const codePoolPaths = {
  configDir: CONFIG_DIR,
  dataDir: CODE_POOL_DIR,
  logsDir: LOGS_DIR,
  myAppPoolFile: path.join(CODE_POOL_DIR, "myapp_pool.json"),
  goddownPoolFile: path.join(CODE_POOL_DIR, "goddown_pool.json"),
  myAppLogFile: path.join(LOGS_DIR, "myapp_codes.csv"),
  goddownLogFile: path.join(LOGS_DIR, "goddown_codes.csv"),
};

const printLogPaths = {
  myAppPrintLogFile: path.join(LOGS_DIR, "myapp_prints.csv"),
  goddownPrintLogFile: path.join(LOGS_DIR, "goddown_prints.csv"),
};

function getCycleFilePath(cycleDate) {
  return path.join(STOCK_LENS_CYCLES_DIR, `${cycleDate}.csv`);
}

module.exports = {
  dataRoot: DATA_ROOT,
  configDir: CONFIG_DIR,
  adminPasswordFile,
  myAppPaths,
  stockLensPaths,
  getCycleFilePath,
  codePoolPaths,
  printLogPaths,
};
