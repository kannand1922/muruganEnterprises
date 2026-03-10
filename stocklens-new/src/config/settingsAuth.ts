export const SETTINGS_UNLOCKED_AT_KEY = "stocklens_settings_unlocked_at";
export const SETTINGS_UNLOCK_TTL_MS = 30 * 60 * 1000;
export const SETTINGS_SAFETY_PASSWORD = "super@admin";

export function grantSettingsAccess() {
  sessionStorage.setItem(SETTINGS_UNLOCKED_AT_KEY, String(Date.now()));
}

export function clearSettingsAccess() {
  sessionStorage.removeItem(SETTINGS_UNLOCKED_AT_KEY);
}

export function hasSettingsAccess() {
  const raw = sessionStorage.getItem(SETTINGS_UNLOCKED_AT_KEY);
  if (!raw) return false;
  const unlockedAt = Number(raw);
  if (!Number.isFinite(unlockedAt)) return false;
  if (Date.now() - unlockedAt > SETTINGS_UNLOCK_TTL_MS) {
    clearSettingsAccess();
    return false;
  }
  return true;
}
