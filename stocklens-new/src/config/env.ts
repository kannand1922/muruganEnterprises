export const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://192.168.1.170:4000/new/api";
export const BACKEND_URL_STORAGE_KEY = "stocklens_backend_url";

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

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

export function getApiBaseUrl() {
  const stored = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
  if (stored && stored.trim()) {
    const migrated = migrateLegacyBaseUrl(stored);
    if (migrated !== normalizeBaseUrl(stored)) {
      localStorage.setItem(BACKEND_URL_STORAGE_KEY, migrated);
    }
    return migrated;
  }
  return normalizeBaseUrl(DEFAULT_API_BASE_URL);
}

export function setApiBaseUrl(value: string) {
  const normalized = migrateLegacyBaseUrl(value);
  localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function resetApiBaseUrl() {
  localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
  return normalizeBaseUrl(DEFAULT_API_BASE_URL);
}
