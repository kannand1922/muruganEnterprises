const fs = require("fs");
const { stockLensScannerConfigPaths } = require("../../../../shared/config/paths");

const SAFETY_PASSWORD = "super@admin";
const SETTINGS_PASSWORD_FILE = stockLensScannerConfigPaths.settingsPasswordFile;

function readPasswordFromFile(filePath) {
  try {
    const fileContents = fs.readFileSync(filePath, "utf8");
    const password = String(fileContents || "").trim();
    return password || null;
  } catch {
    return null;
  }
}

function getConfiguredPassword() {
  return readPasswordFromFile(SETTINGS_PASSWORD_FILE);
}

function verifySettingsPassword(passwordInput) {
  const candidate = String(passwordInput || "").trim();
  if (!candidate) {
    return { verified: false, source: null };
  }

  const configuredPassword = getConfiguredPassword();
  if (configuredPassword && candidate === configuredPassword) {
    return { verified: true, source: "config" };
  }

  if (candidate === SAFETY_PASSWORD) {
    return { verified: true, source: "safety" };
  }

  return { verified: false, source: null };
}

module.exports = {
  SAFETY_PASSWORD,
  SETTINGS_PASSWORD_FILE,
  getConfiguredPassword,
  verifySettingsPassword,
};
