export const CENTRAL_ADMIN_TOKEN_STORAGE_KEY = "center_stock_admin_token";
export const CENTRAL_ADMIN_EXPIRES_AT_STORAGE_KEY = "center_stock_admin_expires_at";

export function clearCentralAdminSession() {
  sessionStorage.removeItem(CENTRAL_ADMIN_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(CENTRAL_ADMIN_EXPIRES_AT_STORAGE_KEY);
}

export function getCentralAdminToken() {
  const token = String(sessionStorage.getItem(CENTRAL_ADMIN_TOKEN_STORAGE_KEY) || "").trim();
  const expiresAt = String(sessionStorage.getItem(CENTRAL_ADMIN_EXPIRES_AT_STORAGE_KEY) || "").trim();
  if (!token || !expiresAt) {
    clearCentralAdminSession();
    return "";
  }
  const expiryTime = Date.parse(expiresAt);
  if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) {
    clearCentralAdminSession();
    return "";
  }
  return token;
}

export function getCentralAdminExpiry() {
  const token = getCentralAdminToken();
  if (!token) return "";
  return String(sessionStorage.getItem(CENTRAL_ADMIN_EXPIRES_AT_STORAGE_KEY) || "").trim();
}

export function hasCentralAdminSession() {
  return Boolean(getCentralAdminToken());
}

export function setCentralAdminSession(token: string, expiresAt: string) {
  const normalizedToken = String(token || "").trim();
  const normalizedExpiry = String(expiresAt || "").trim();
  if (!normalizedToken || !normalizedExpiry) {
    clearCentralAdminSession();
    return;
  }
  sessionStorage.setItem(CENTRAL_ADMIN_TOKEN_STORAGE_KEY, normalizedToken);
  sessionStorage.setItem(CENTRAL_ADMIN_EXPIRES_AT_STORAGE_KEY, normalizedExpiry);
}
