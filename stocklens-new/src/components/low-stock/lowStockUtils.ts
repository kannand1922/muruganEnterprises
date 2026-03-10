export type PackRuleForm = {
  id: string;
  packValue: string;
  thresholdBottles: string;
};

export type ProductRuleForm = {
  id: string;
  itemCode: string;
  thresholdBottles: string;
};

export function createRowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function toThresholdNumber(value: string, fallback = 6) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function normalizeSearchValue(value: string | number | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizePackRuleKey(value: string | number | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9.]/g, "");
}

export function buildPackRulesForAllPackValues(
  availablePackValues: string[],
  existingRows: Array<{ id?: string; packValue: string; thresholdBottles: string | number }>
) {
  const existingByPack = new Map(
    existingRows
      .map((row) => {
        const key = normalizePackRuleKey(row.packValue);
        if (!key) return null;
        return [key, row];
      })
      .filter(Boolean) as Array<[string, { id?: string; packValue: string; thresholdBottles: string | number }]>
  );

  if (availablePackValues.length === 0) {
    return existingRows
      .filter((row) => String(row.packValue || "").trim())
      .map((row) => ({
        id: row.id || createRowId("pack"),
        packValue: String(row.packValue || "").trim(),
        thresholdBottles: String(row.thresholdBottles || "6"),
      }));
  }

  return availablePackValues.map((packValue) => {
    const key = normalizePackRuleKey(packValue);
    const existing = existingByPack.get(key);
    return {
      id: existing?.id || createRowId("pack"),
      packValue,
      thresholdBottles: String(existing?.thresholdBottles || "6"),
    };
  });
}

export function parseShopLocationIdFromSearch(search: string) {
  const params = new URLSearchParams(search || "");
  const raw = Number(params.get("shopLocationId") || "");
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
}

export function buildShopLocationSearch(search: string, shopLocationId: number | null) {
  const params = new URLSearchParams(search || "");
  if (shopLocationId && shopLocationId > 0) {
    params.set("shopLocationId", String(Math.trunc(shopLocationId)));
  } else {
    params.delete("shopLocationId");
  }

  const next = params.toString();
  return next ? `?${next}` : "";
}

export function toPackSortValue(value: string) {
  const numeric = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric)) return numeric;
  return Number.MAX_SAFE_INTEGER;
}

export function formatPackLabel(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/[a-zA-Z]/.test(trimmed)) return trimmed;
  return `${trimmed}ml`;
}

export function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

export function formatNotificationDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}
