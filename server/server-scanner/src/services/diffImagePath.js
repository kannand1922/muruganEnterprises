const fs = require("fs");
const path = require("path");
const { stockLensScannerConfigPaths } = require("../../../../shared/config/paths");

const DEFAULT_DIFF_IMAGE_PATH = "/image/diff";
const DIFF_IMAGE_PATH_FILE = stockLensScannerConfigPaths.diffImagePathFile;

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_DIFF_IMAGE_PATH;
  return trimmed.replace(/[\\/]+$/, "") || DEFAULT_DIFF_IMAGE_PATH;
}

function readDiffImageBasePath() {
  try {
    if (!DIFF_IMAGE_PATH_FILE || !fs.existsSync(DIFF_IMAGE_PATH_FILE)) {
      return DEFAULT_DIFF_IMAGE_PATH;
    }
    const raw = fs.readFileSync(DIFF_IMAGE_PATH_FILE, "utf8");
    return normalizeBasePath(raw);
  } catch {
    return DEFAULT_DIFF_IMAGE_PATH;
  }
}

function getDiffImageBasePath() {
  return normalizeBasePath(readDiffImageBasePath());
}

function getDiffImageFileNameExtension(fileName) {
  const ext = path.extname(String(fileName || "").trim());
  return ext || "";
}

module.exports = {
  DEFAULT_DIFF_IMAGE_PATH,
  DIFF_IMAGE_PATH_FILE,
  getDiffImageBasePath,
  getDiffImageFileNameExtension,
};
