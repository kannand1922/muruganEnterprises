import type { CentralAccessUser } from "../types";

const CENTRAL_ACCESS_EXPIRY_KEY = "center_stock_access_expiry";
const CENTRAL_ACCESS_USER_KEY = "center_stock_access_user";

export function clearCentralAccessSession() {
  sessionStorage.removeItem(CENTRAL_ACCESS_EXPIRY_KEY);
  sessionStorage.removeItem(CENTRAL_ACCESS_USER_KEY);
}

export function setCentralAccessSession(expiresAt: string, user: CentralAccessUser) {
  sessionStorage.setItem(CENTRAL_ACCESS_EXPIRY_KEY, expiresAt);
  sessionStorage.setItem(CENTRAL_ACCESS_USER_KEY, JSON.stringify(user));
}

export function getCentralAccessToken() {
  return "";
}

export function getCentralAccessExpiry() {
  return sessionStorage.getItem(CENTRAL_ACCESS_EXPIRY_KEY) || "";
}

export function getCentralAccessUser(): CentralAccessUser | null {
  const raw = sessionStorage.getItem(CENTRAL_ACCESS_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CentralAccessUser;
  } catch {
    return null;
  }
}

export function hasCentralAccessSession() {
  const expiry = getCentralAccessExpiry();
  if (!expiry) return false;
  if (new Date(expiry).getTime() <= Date.now()) {
    clearCentralAccessSession();
    return false;
  }
  return Boolean(getCentralAccessUser());
}
