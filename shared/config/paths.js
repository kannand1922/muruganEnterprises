const path = require("path");

const SHARED_ROOT = path.join(__dirname, "..");
const DATA_ROOT = path.join(SHARED_ROOT, "data");
const CONFIG_DIR = path.join(SHARED_ROOT, "config");
const LOGS_DIR = path.join(DATA_ROOT, "logs");
const RECEIPTS_DIR = path.join(DATA_ROOT, "receipts");
const CODE_POOL_DIR = path.join(DATA_ROOT, "codePools");
const STOCK_LENS_DIR = path.join(DATA_ROOT, "stock");

const STOCK_LENS_SETTINGS_PASSWORD_FILE = path.join(
  CONFIG_DIR,
  "settings-password.txt"
);
const STOCK_LENS_REQUIRED_BUILD_FILE = path.join(
  CONFIG_DIR,
  "required-build.txt"
);
const STOCK_LENS_MASTER_MAX_AGE_FILE = path.join(
  CONFIG_DIR,
  "master-max-age-minutes.txt"
);

const stockLensPaths = {
  dataDir: STOCK_LENS_DIR,
  brandsCsv: path.join(STOCK_LENS_DIR, "brands.csv"),
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

const receiptPaths = {
  dataDir: RECEIPTS_DIR,
};

const stockLensScannerConfigPaths = {
  configDir: CONFIG_DIR,
  settingsPasswordFile: STOCK_LENS_SETTINGS_PASSWORD_FILE,
  requiredBuildFile: STOCK_LENS_REQUIRED_BUILD_FILE,
  masterMaxAgeMinutesFile: STOCK_LENS_MASTER_MAX_AGE_FILE,
};

module.exports = {
  dataRoot: DATA_ROOT,
  configDir: CONFIG_DIR,
  stockLensPaths,
  codePoolPaths,
  printLogPaths,
  receiptPaths,
  stockLensScannerConfigPaths,
};
