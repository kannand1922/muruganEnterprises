const path = require("path");

const SHARED_ROOT = path.join(__dirname, "..");
const DATA_ROOT = path.join(SHARED_ROOT, "data");
const CONFIG_DIR = path.join(SHARED_ROOT, "config");
const LOGS_DIR = path.join(DATA_ROOT, "logs");
const RECEIPTS_DIR = path.join(DATA_ROOT, "receipts");
const CODE_POOL_DIR = path.join(DATA_ROOT, "codePools");
const STOCK_LENS_DIR = path.join(DATA_ROOT, "stock");
const SCANNER_DATA_DIR = path.join(DATA_ROOT, "scanner");

const STOCK_LENS_SETTINGS_PASSWORD_FILE = path.join(
  CONFIG_DIR,
  "settings-password.txt"
);
const STOCK_LENS_CENTRAL_ADMIN_PASSWORD_FILE = path.join(
  CONFIG_DIR,
  "central-admin-password.txt"
);
const STOCK_LENS_REQUIRED_BUILD_FILE = path.join(
  CONFIG_DIR,
  "required-build.txt"
);
const STOCK_LENS_MASTER_MAX_AGE_FILE = path.join(
  CONFIG_DIR,
  "master-max-age-minutes.txt"
);
const STOCK_LENS_DIFF_IMAGE_PATH_FILE = path.join(
  CONFIG_DIR,
  "diff-image-path.txt"
);
const STOCK_LENS_SCANNER_SSL_CERT_PATH_FILE = path.join(
  CONFIG_DIR,
  "scanner-ssl-cert-path.txt"
);
const STOCK_LENS_SCANNER_SSL_KEY_PATH_FILE = path.join(
  CONFIG_DIR,
  "scanner-ssl-key-path.txt"
);
const STOCK_LENS_CENTRAL_ALLOWED_ORIGINS_FILE = path.join(
  CONFIG_DIR,
  "central-allowed-origins.txt"
);
const STOCK_LENS_CENTRAL_SMTP_FROM_FILE = path.join(
  CONFIG_DIR,
  "central-smtp-from.txt"
);
const STOCK_LENS_CENTRAL_SMTP_HOST_FILE = path.join(
  CONFIG_DIR,
  "central-smtp-host.txt"
);
const STOCK_LENS_CENTRAL_SMTP_PORT_FILE = path.join(
  CONFIG_DIR,
  "central-smtp-port.txt"
);
const STOCK_LENS_CENTRAL_SMTP_USER_FILE = path.join(
  CONFIG_DIR,
  "central-smtp-user.txt"
);
const STOCK_LENS_CENTRAL_SMTP_PASS_FILE = path.join(
  CONFIG_DIR,
  "central-smtp-pass.txt"
);
const STOCK_LENS_CENTRAL_SMTP_SECURE_FILE = path.join(
  CONFIG_DIR,
  "central-smtp-secure.txt"
);
const STOCK_LENS_CENTRAL_OWNER_EMAIL_FILE = path.join(
  CONFIG_DIR,
  "central-owner-email.txt"
);

const stockLensPaths = {
  dataDir: STOCK_LENS_DIR,
  brandsCsv: path.join(STOCK_LENS_DIR, "brands.csv"),
};

const scannerDataPaths = {
  dataDir: SCANNER_DATA_DIR,
  brandsCsv: path.join(SCANNER_DATA_DIR, "brands.csv"),
  printersCsv: path.join(SCANNER_DATA_DIR, "printers.csv"),
  productsCsv: path.join(SCANNER_DATA_DIR, "products.csv"),
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
  centralAdminPasswordFile: STOCK_LENS_CENTRAL_ADMIN_PASSWORD_FILE,
  requiredBuildFile: STOCK_LENS_REQUIRED_BUILD_FILE,
  masterMaxAgeMinutesFile: STOCK_LENS_MASTER_MAX_AGE_FILE,
  diffImagePathFile: STOCK_LENS_DIFF_IMAGE_PATH_FILE,
  scannerSslCertPathFile: STOCK_LENS_SCANNER_SSL_CERT_PATH_FILE,
  scannerSslKeyPathFile: STOCK_LENS_SCANNER_SSL_KEY_PATH_FILE,
  centralAllowedOriginsFile: STOCK_LENS_CENTRAL_ALLOWED_ORIGINS_FILE,
  centralSmtpFromFile: STOCK_LENS_CENTRAL_SMTP_FROM_FILE,
  centralSmtpHostFile: STOCK_LENS_CENTRAL_SMTP_HOST_FILE,
  centralSmtpPortFile: STOCK_LENS_CENTRAL_SMTP_PORT_FILE,
  centralSmtpUserFile: STOCK_LENS_CENTRAL_SMTP_USER_FILE,
  centralSmtpPassFile: STOCK_LENS_CENTRAL_SMTP_PASS_FILE,
  centralSmtpSecureFile: STOCK_LENS_CENTRAL_SMTP_SECURE_FILE,
  centralOwnerEmailFile: STOCK_LENS_CENTRAL_OWNER_EMAIL_FILE,
};

module.exports = {
  dataRoot: DATA_ROOT,
  configDir: CONFIG_DIR,
  stockLensPaths,
  scannerDataPaths,
  codePoolPaths,
  printLogPaths,
  receiptPaths,
  stockLensScannerConfigPaths,
};
