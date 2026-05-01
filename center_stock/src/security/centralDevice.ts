const CENTRAL_DEVICE_ID_KEY = "center_stock_device_id";

function buildDeviceLabel() {
  if (typeof navigator === "undefined") return "Browser device";
  const platform = String((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "").trim();
  const agent = String(navigator.userAgent || "").trim();
  const shortAgent = agent
    .replace(/^Mozilla\/[0-9.]+\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  return [platform, shortAgent].filter(Boolean).join(" · ") || "Browser device";
}

function generateDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `central-${crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 14);
  const stamp = Date.now().toString(36);
  return `central-${stamp}-${random}`;
}

export function getCentralDeviceId() {
  if (typeof localStorage === "undefined") return "";
  const existing = localStorage.getItem(CENTRAL_DEVICE_ID_KEY);
  if (existing) return existing;
  const nextId = generateDeviceId();
  localStorage.setItem(CENTRAL_DEVICE_ID_KEY, nextId);
  return nextId;
}

export function getCentralDeviceLabel() {
  return buildDeviceLabel();
}
