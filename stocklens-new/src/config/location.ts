export const CURRENT_LOCATION_ID_KEY = "stocklens_current_location_id";
export const LOCATION_CHANGED_EVENT = "stocklens-location-changed";

export function getCurrentLocationIdFromStorage() {
  const raw = localStorage.getItem(CURRENT_LOCATION_ID_KEY);
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

export function setCurrentLocationIdToStorage(id: number) {
  localStorage.setItem(CURRENT_LOCATION_ID_KEY, String(id));
}
