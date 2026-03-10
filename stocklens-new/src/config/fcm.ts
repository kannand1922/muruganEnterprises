export const FCM_ALERT_LOCATION_ID_KEY = "stocklens_fcm_alert_location_id";

export function getFcmAlertLocationIdFromStorage() {
  const raw = localStorage.getItem(FCM_ALERT_LOCATION_ID_KEY);
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

export function setFcmAlertLocationIdToStorage(id: number) {
  localStorage.setItem(FCM_ALERT_LOCATION_ID_KEY, String(id));
}

export function clearFcmAlertLocationIdFromStorage() {
  localStorage.removeItem(FCM_ALERT_LOCATION_ID_KEY);
}
