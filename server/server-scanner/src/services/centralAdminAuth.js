const fs = require("fs");
const crypto = require("crypto");
const { stockLensScannerConfigPaths } = require("../../../../shared/config/paths");

const CENTRAL_ADMIN_PASSWORD_FILE = stockLensScannerConfigPaths.centralAdminPasswordFile;
const CENTRAL_ADMIN_TOKEN_HEADER = "x-central-admin-token";
const CENTRAL_ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const adminSessions = new Map();

function readCentralAdminPassword() {
  try {
    const raw = fs.readFileSync(CENTRAL_ADMIN_PASSWORD_FILE, "utf8");
    const password = String(raw || "").trim();
    return password || "";
  } catch {
    return "";
  }
}

function verifyCentralAdminPassword(passwordInput) {
  const configuredPassword = readCentralAdminPassword();
  if (!configuredPassword) {
    return { verified: false, message: "Admin password is not configured" };
  }
  const candidate = String(passwordInput || "").trim();
  if (!candidate) {
    return { verified: false, message: "Admin password is required" };
  }
  return {
    verified: candidate === configuredPassword,
    message: candidate === configuredPassword ? null : "Invalid admin password",
  };
}

function clearExpiredAdminSessions() {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (!session?.expiresAt || session.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function issueCentralAdminToken() {
  clearExpiredAdminSessions();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + CENTRAL_ADMIN_TOKEN_TTL_MS;
  adminSessions.set(token, { expiresAt });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function validateCentralAdminToken(tokenInput) {
  clearExpiredAdminSessions();
  const token = String(tokenInput || "").trim();
  if (!token) {
    return { ok: false, message: "Missing admin token" };
  }
  const session = adminSessions.get(token);
  if (!session) {
    return { ok: false, message: "Invalid admin token" };
  }
  if (!session.expiresAt || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return { ok: false, message: "Admin token expired" };
  }
  return {
    ok: true,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

module.exports = {
  CENTRAL_ADMIN_TOKEN_HEADER,
  CENTRAL_ADMIN_PASSWORD_FILE,
  verifyCentralAdminPassword,
  issueCentralAdminToken,
  validateCentralAdminToken,
};
