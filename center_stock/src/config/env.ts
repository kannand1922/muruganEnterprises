const FALLBACK_API_URL = "http://192.168.1.170:4000/new/api";
export const BACKEND_URL_STORAGE_KEY = "center_stock_backend_url";

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getConfiguredHost() {
  const raw = String(import.meta.env.VITE_API_BASE_URL || FALLBACK_API_URL).trim();
  try {
    return new URL(raw).hostname || "192.168.1.170";
  } catch {
    return "192.168.1.170";
  }
}

function getPlatformDefaultBaseUrl() {
  const configuredHost = getConfiguredHost();
  return `https://${configuredHost}:4010/new/api`;
}

export const DEFAULT_API_BASE_URL = normalizeBaseUrl(getPlatformDefaultBaseUrl());

function migrateLegacyBaseUrl(value: string) {
  const normalized = normalizeBaseUrl(value);
  if (
    normalized === "http://localhost:3100/api" ||
    normalized === "http://localhost:3000/api" ||
    normalized === "http://localhost:3010/api"
  ) {
    return "http://localhost:3010/new/api";
  }
  return normalized;
}

function sanitizeStoredBaseUrl(value: string) {
  return migrateLegacyBaseUrl(value);
}

export function getApiBaseUrl() {
  const stored = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
  if (stored && stored.trim()) {
    const normalized = sanitizeStoredBaseUrl(stored);
    if (normalized !== normalizeBaseUrl(stored)) {
      localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
    }
    return normalized;
  }

  localStorage.setItem(BACKEND_URL_STORAGE_KEY, DEFAULT_API_BASE_URL);
  return DEFAULT_API_BASE_URL;
}

export function setApiBaseUrl(value: string) {
  const normalized = sanitizeStoredBaseUrl(value);
  localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function resetApiBaseUrl() {
  localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
  localStorage.setItem(BACKEND_URL_STORAGE_KEY, DEFAULT_API_BASE_URL);
  return DEFAULT_API_BASE_URL;
}
