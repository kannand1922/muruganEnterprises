import { apiGet, apiPost } from "./httpClient";

export type DbViewerTableKey =
  | "cycleFinishedStock"
  | "cycleUnfinishedStock"
  | "cycleProductEvent"
  | "diffBatch"
  | "diffItem"
  | "cycle"
  | "operatorDailyMismatchSummary"
  | "bestSellingProduct"
  | "shopLocation"
  | "worker"
  | "device"
  | "phone"
  | "printer"
  | "appSetting"
  | "shopInfo"
  | "lowStockLocationConfig"
  | "lowStockPackRule"
  | "lowStockBrandRule"
  | "lowStockProductRule"
  | "lowStockNotificationRun"
  | "lowStockProductNotificationState"
  | "nilStockLocationConfig"
  | "nilStockNotificationRun"
  | "nilStockProductNotificationState"
  | "fcmDeviceToken";

export type DbViewerTableMeta = {
  key: DbViewerTableKey;
  label: string;
  group: "primary" | "secondary";
  clearable: boolean;
  supportsCycleFilter: boolean;
  supportsLocationFilter: boolean;
  supportsMatchFilter: boolean;
};

export type DbViewerQueryResponse = {
  success: boolean;
  table: DbViewerTableMeta;
  limit: number;
  totalCount: number;
  filteredCount: number;
  rows: Record<string, unknown>[];
};

export async function getDbViewerTables() {
  const result = await apiGet<{
    success: boolean;
    count: number;
    tables: DbViewerTableMeta[];
  }>("/db-viewer/tables");
  return result.tables;
}

export async function getDbViewerRows(params: {
  table: DbViewerTableKey;
  cycleId?: number | null;
  shopLocationId?: number | null;
  search?: string;
  matchState?: "all" | "matched" | "unmatched";
  status?: "all" | "active" | "inactive";
  limit?: number;
}) {
  const search = new URLSearchParams({
    table: params.table,
  });
  if (params.cycleId) search.set("cycleId", String(params.cycleId));
  if (params.shopLocationId) search.set("shopLocationId", String(params.shopLocationId));
  if (params.search?.trim()) search.set("search", params.search.trim());
  if (params.matchState && params.matchState !== "all") search.set("matchState", params.matchState);
  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.limit) search.set("limit", String(params.limit));
  return apiGet<DbViewerQueryResponse>(`/db-viewer/rows?${search.toString()}`);
}

export async function clearDbViewerRows(payload: {
  table: DbViewerTableKey;
  cycleId?: number | null;
  shopLocationId?: number | null;
  password: string;
  matchState?: "all" | "matched" | "unmatched";
}) {
  return apiPost<{
    success: boolean;
    table: DbViewerTableMeta;
    deletedCount: number;
    cycleId: number;
    shopLocationId: number | null;
  }>("/db-viewer/clear", payload);
}
