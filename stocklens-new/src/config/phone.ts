export const CURRENT_PHONE_ID_KEY = "stocklens_current_phone_id";

export function getCurrentPhoneIdFromStorage() {
  const raw = localStorage.getItem(CURRENT_PHONE_ID_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

export function setCurrentPhoneIdToStorage(phoneId: number) {
  localStorage.setItem(CURRENT_PHONE_ID_KEY, String(phoneId));
}

export function clearCurrentPhoneIdFromStorage() {
  localStorage.removeItem(CURRENT_PHONE_ID_KEY);
}
