import { apiDelete, apiGet, apiPost, apiPut } from "./httpClient";

export type ShopInfo = {
  id?: number;
  shopCode: string;
  shopName: string;
  areaName?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  nilLocation?: number | null;
  active?: boolean;
};

export type CatalogSyncSettings = {
  centralBaseUrl: string | null;
  syncOperatorsWithCentral: boolean;
  syncBestSellingWithCentral: boolean;
};

export type ShopLocation = {
  id: number;
  locationCode: string;
  locationName: string;
  locationType?: string | null;
  locationColor: string;
  sortOrder: number;
  lowStockNotificationsEnabled: boolean;
};

export type Worker = {
  id: number;
  name: string;
  fatherName?: string | null;
  designationId?: number | null;
  designationName?: string | null;
  dateOfBirth?: string | null;
  dateOfJoining?: string | null;
  dateOfResignation?: string | null;
  permanentAddress?: string | null;
  temporaryAddress?: string | null;
  aadhaarNumber?: string | null;
  email?: string | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  recommendedBy?: string | null;
  workLocationId?: number | null;
  workLocationName?: string | null;
  profileImageBase64?: string | null;
  profileImageMimeType?: string | null;
  profileImageFileName?: string | null;
  resumeFileBase64?: string | null;
  resumeFileMimeType?: string | null;
  resumeFileName?: string | null;
  aadhaarImageBase64?: string | null;
  aadhaarImageMimeType?: string | null;
  aadhaarImageFileName?: string | null;
  phone?: string | null;
  phoneNumbers?: Array<{
    id?: number;
    label?: string | null;
    phoneNumber: string;
    isPrimary: boolean;
  }>;
  documents?: Array<{
    id?: number;
    category: string;
    label?: string | null;
    textValue?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    fileDataBase64?: string | null;
    sortOrder?: number;
    active?: boolean;
  }>;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkerPayload = {
  name: string;
  fatherName: string;
  designationName: string;
  dateOfBirth: string;
  dateOfJoining: string;
  dateOfResignation?: string | null;
  permanentAddress: string;
  temporaryAddress?: string | null;
  aadhaarNumber: string;
  email?: string | null;
  bankAccountNumber: string;
  ifscCode: string;
  recommendedBy: string;
  workLocationName?: string | null;
  profileImageBase64: string;
  profileImageMimeType?: string | null;
  profileImageFileName?: string | null;
  resumeFileBase64: string;
  resumeFileMimeType?: string | null;
  resumeFileName?: string | null;
  aadhaarImageBase64: string;
  aadhaarImageMimeType?: string | null;
  aadhaarImageFileName?: string | null;
  phoneNumbers: Array<{
    label?: string | null;
    phoneNumber: string;
    isPrimary: boolean;
  }>;
  documents?: Array<{
    category: string;
    label?: string | null;
    textValue?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    fileDataBase64?: string | null;
    sortOrder?: number;
    active?: boolean;
  }>;
  active?: boolean;
};

export type Printer = {
  id: number;
  name: string;
  ipAddress: string;
  port: number;
  defaultPrinter: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Phone = {
  id: number;
  name: string;
  lowStockNotificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FcmDeviceToken = {
  id: number;
  token: string;
  phoneId?: number | null;
  shopLocationId?: number | null;
  active: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type LowStockRuleRow = {
  thresholdBottles: number;
  packValue?: string;
  brandName?: string;
  itemCode?: string;
};

export type LowStockSettings = {
  shopLocationId: number;
  locationCode: string;
  locationName: string;
  sourceLocationId?: number | null;
  sourceLocationCode?: string;
  sourceLocationName?: string;
  notificationsEnabled: boolean;
  generalThresholdBottles?: number;
  packRules: Array<{ packValue: string; thresholdBottles: number }>;
  brandRules?: Array<{ brandName: string; thresholdBottles: number }>;
  productRules: Array<{ itemCode: string; thresholdBottles: number }>;
};

export type LowStockProductRow = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  displayName: string;
  thresholdBottles: number;
  currentBottles: number;
  sourceCurrentBottles?: number | null;
  ruleType: "product" | "pack";
};

export type LowStockProductsResponse = {
  shopLocationId: number;
  locationName: string;
  locationCode: string;
  sourceLocationId?: number | null;
  sourceLocationCode?: string;
  sourceLocationName?: string;
  notificationsEnabled: boolean;
  generalThresholdBottles?: number;
  lowCount: number;
  rows: LowStockProductRow[];
};

export type NilStockSettings = {
  shopLocationId: number;
  locationCode: string;
  locationName: string;
  sourceLocationId?: number | null;
  sourceLocationCode?: string;
  sourceLocationName?: string;
  notificationsEnabled: boolean;
};

export type NilStockProductRow = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  displayName: string;
  sourceCurrentBottles: number;
  targetCurrentBottles: number;
};

export type NilStockProductsResponse = {
  shopLocationId: number;
  locationName: string;
  locationCode: string;
  sourceLocationId?: number | null;
  sourceLocationCode?: string;
  sourceLocationName?: string;
  notificationsEnabled: boolean;
  nilCount: number;
  rows: NilStockProductRow[];
};

export type LowStockOverviewRow = {
  shopLocationId: number;
  locationCode: string;
  locationName: string;
  generalThresholdBottles?: number;
  lowCount: number;
};

export type LowStockOverview = {
  success: boolean;
  generatedAt: string;
  enabledLocationCount: number;
  locationsWithLowStock: number;
  totalLowProducts: number;
  rows: LowStockOverviewRow[];
};

export type LowStockNotificationRow = {
  id: number;
  shopLocationId: number;
  locationCode: string;
  locationName: string;
  csvVersion: string;
  trigger: string;
  status: "pending" | "sent" | "failed" | "skipped" | string;
  lowCount: number;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  reason: string;
  createdAt: string | null;
  sentAt: string | null;
  notificationTime: string | null;
};

export type LowStockNotificationsResponse = {
  success: boolean;
  filters: {
    shopLocationId: number | null;
    status: string;
    dateFrom: string;
    dateTo: string;
  };
  summary: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    pending: number;
    totalLowCount: number;
    totalSuccessCount: number;
    totalFailureCount: number;
  };
  count: number;
  rows: LowStockNotificationRow[];
};

export type MasterProduct = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
  godownStock?: string | null;
  shopStock?: string | null;
  locationStocks?: Record<string, string> | null;
};

export type MasterStatus = {
  success: boolean;
  allowed: boolean;
  recent: boolean;
  lastModified: string;
  lastModifiedIST: string;
  checkedAt?: string;
  checkedAtIST?: string;
  ageMs: number;
  ageMinutes: number;
  ageLabel?: string;
  maxAgeMinutes: number;
  sourceFile: string;
  message?: string;
};

export type BestSellingProduct = {
  id: number;
  itemCode: string;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type ApiListEnvelope<T> = {
  success: boolean;
  rows: T[];
  count: number;
  message?: string;
};

export async function getShopInfo() {
  const result = await apiGet<ApiEnvelope<ShopInfo | null>>("/meta/shop");
  return result.data;
}

export async function getCatalogSyncSettings() {
  const result = await apiGet<ApiEnvelope<CatalogSyncSettings>>("/meta/sync-settings");
  return result.data;
}

export async function updateCatalogSyncSettings(payload: CatalogSyncSettings) {
  const result = await apiPut<ApiEnvelope<CatalogSyncSettings>>("/meta/sync-settings", payload);
  return result.data;
}

export async function createOrUpdateShopInfo(payload: ShopInfo) {
  const result = await apiPost<ApiEnvelope<ShopInfo>>("/meta/shop", payload);
  return result.data;
}

export async function deleteShopInfo() {
  return apiDelete<{ success: boolean; message?: string }>("/meta/shop");
}

export async function getShopLocations() {
  const result = await apiGet<ApiListEnvelope<ShopLocation>>("/meta/shop-locations");
  return result.rows;
}

export async function createShopLocation(payload: {
  locationCode: string;
  locationName: string;
  locationType?: string;
  locationColor: string;
  sortOrder?: number;
  lowStockNotificationsEnabled?: boolean;
}) {
  const result = await apiPost<ApiEnvelope<ShopLocation>>("/meta/shop-locations", payload);
  return result.data;
}

export async function updateShopLocation(
  id: number,
  payload: {
    locationCode: string;
    locationName: string;
    locationType?: string;
    locationColor: string;
    sortOrder?: number;
    lowStockNotificationsEnabled?: boolean;
  }
) {
  const result = await apiPut<ApiEnvelope<ShopLocation>>(`/meta/shop-locations/${id}`, payload);
  return result.data;
}

export async function deleteShopLocation(id: number) {
  return apiDelete<{ success: boolean; message?: string }>(`/meta/shop-locations/${id}`);
}

export async function getWorkers() {
  const result = await apiGet<ApiListEnvelope<Worker>>("/meta/workers");
  return result.rows;
}

export async function createWorker(payload: WorkerPayload) {
  const result = await apiPost<ApiEnvelope<Worker>>("/meta/workers", payload);
  return result.data;
}

export async function updateWorker(
  id: number,
  payload: WorkerPayload
) {
  const result = await apiPut<ApiEnvelope<Worker>>(`/meta/workers/${id}`, payload);
  return result.data;
}

export async function deleteWorker(id: number) {
  return apiDelete<{ success: boolean; message?: string }>(`/meta/workers/${id}`);
}

export async function getPhones() {
  const result = await apiGet<ApiListEnvelope<Phone>>("/meta/phones");
  return result.rows;
}

export async function createPhone(payload: { name: string; lowStockNotificationsEnabled?: boolean }) {
  const result = await apiPost<ApiEnvelope<Phone>>("/meta/phones", payload);
  return result.data;
}

export async function updatePhone(
  id: number,
  payload: { name: string; lowStockNotificationsEnabled?: boolean }
) {
  const result = await apiPut<ApiEnvelope<Phone>>(`/meta/phones/${id}`, payload);
  return result.data;
}

export async function deletePhone(id: number) {
  return apiDelete<{ success: boolean; message?: string }>(`/meta/phones/${id}`);
}

export async function getPrinters() {
  const result = await apiGet<ApiListEnvelope<Printer>>("/meta/printers");
  return result.rows;
}

export async function createPrinter(payload: {
  name: string;
  ipAddress: string;
  port?: number;
  defaultPrinter?: boolean;
}) {
  const result = await apiPost<ApiEnvelope<Printer>>("/meta/printers", payload);
  return result.data;
}

export async function updatePrinter(
  id: number,
  payload: { name: string; ipAddress: string; port?: number; defaultPrinter?: boolean }
) {
  const result = await apiPut<ApiEnvelope<Printer>>(`/meta/printers/${id}`, payload);
  return result.data;
}

export async function deletePrinter(id: number) {
  return apiDelete<{ success: boolean; message?: string }>(`/meta/printers/${id}`);
}

export async function searchMasterProducts(query: string, limit = 50) {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const result = await apiGet<ApiListEnvelope<MasterProduct>>(`/meta/master-products?${params}`);
  return result.rows;
}

export async function getAllMasterProducts(limit = 5000, options: { includeAll?: boolean } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.includeAll) {
    params.set("includeAll", "true");
  }
  const result = await apiGet<ApiListEnvelope<MasterProduct>>(`/meta/master-products?${params}`);
  return result.rows;
}

export async function getMasterStatus() {
  return apiGet<MasterStatus>("/meta/master-status");
}

export async function getBestSelling() {
  const result = await apiGet<ApiListEnvelope<BestSellingProduct>>("/meta/best-selling");
  return result.rows;
}

export async function createBestSelling(payload: {
  itemCode: string;
  itemName?: string;
  brandName?: string;
  packValue?: string;
}) {
  const result = await apiPost<ApiEnvelope<BestSellingProduct>>("/meta/best-selling", payload);
  return result.data;
}

export async function updateBestSelling(
  id: number,
  payload: {
    itemCode?: string;
    itemName?: string;
    brandName?: string;
    packValue?: string;
  }
) {
  const result = await apiPut<ApiEnvelope<BestSellingProduct>>(`/meta/best-selling/${id}`, payload);
  return result.data;
}

export async function deleteBestSelling(id: number) {
  return apiDelete<{ success: boolean; message?: string }>(`/meta/best-selling/${id}`);
}

export async function verifySettingsPassword(password: string) {
  const result = await apiPost<ApiEnvelope<{ verified: boolean; source: "config" | "safety" }>>(
    "/meta/settings-auth",
    { password }
  );
  return result.data.verified;
}

export async function getRequiredBuild(): Promise<string> {
  const result = await apiGet<{ success: boolean; requiredBuild: string }>("/app/version");
  return String(result.requiredBuild ?? "").trim();
}

export async function registerFcmToken(payload: {
  token: string;
  phoneId?: number | null;
  shopLocationId?: number | null;
  active?: boolean;
}) {
  const result = await apiPost<ApiEnvelope<FcmDeviceToken>>("/meta/push/register-token", payload);
  return result.data;
}

export async function sendFcmHeartbeat(payload: {
  token: string;
  phoneId?: number | null;
  shopLocationId?: number | null;
  active?: boolean;
}) {
  const result = await apiPost<ApiEnvelope<FcmDeviceToken>>("/meta/push/heartbeat", payload);
  return result.data;
}

export async function getLowStockSettings(shopLocationId: number) {
  const result = await apiGet<ApiEnvelope<LowStockSettings>>(`/meta/low-stock/settings/${shopLocationId}`);
  return result.data;
}

export async function saveLowStockSettings(
  shopLocationId: number,
  payload: {
    sourceLocationId?: number | null;
    packRules: Array<{ packValue: string; thresholdBottles: number }>;
    productRules: Array<{ itemCode: string; thresholdBottles: number }>;
  }
) {
  const result = await apiPut<ApiEnvelope<LowStockSettings>>(`/meta/low-stock/settings/${shopLocationId}`, payload);
  return result.data;
}

export async function getLowStockProducts(shopLocationId: number) {
  const result = await apiGet<ApiEnvelope<LowStockProductsResponse>>(
    `/meta/low-stock/products?shopLocationId=${encodeURIComponent(String(shopLocationId))}`
  );
  return result.data;
}

export async function getNilStockSettings(shopLocationId: number) {
  const result = await apiGet<ApiEnvelope<NilStockSettings>>(`/meta/nil-stock/settings/${shopLocationId}`);
  return result.data;
}

export async function saveNilStockSettings(
  shopLocationId: number,
  payload: {
    sourceLocationId?: number | null;
    notificationsEnabled?: boolean;
  }
) {
  const result = await apiPut<ApiEnvelope<NilStockSettings>>(`/meta/nil-stock/settings/${shopLocationId}`, payload);
  return result.data;
}

export async function getNilStockProducts(shopLocationId: number) {
  const result = await apiGet<ApiEnvelope<NilStockProductsResponse>>(
    `/meta/nil-stock/products?shopLocationId=${encodeURIComponent(String(shopLocationId))}`
  );
  return result.data;
}

export async function getLowStockOverview() {
  return apiGet<LowStockOverview>("/meta/low-stock/overview");
}

export async function checkLowStockNow(payload: { shopLocationId?: number; dryRun?: boolean } = {}) {
  return apiPost<{
    success: boolean;
    generatedAt: string;
    locationCount: number;
    locationsWithLowStock: number;
    totalLowProducts: number;
    notifyResults: Array<{
      shopLocationId: number;
      locationName: string;
      lowCount: number;
      tokenCount: number;
      sent: boolean;
      reason: string;
      successCount?: number;
      failureCount?: number;
      invalidTokenCount?: number;
    }>;
  }>("/meta/low-stock/check-now", payload);
}

export async function checkNilStockNow(
  payload: { shopLocationId?: number; dryRun?: boolean; enforceState?: boolean } = {}
) {
  return apiPost<{
    success: boolean;
    generatedAt?: string;
    locationCount: number;
    locationsWithNilStock: number;
    totalNilProducts: number;
    notifyResults: Array<{
      shopLocationId: number;
      locationName: string;
      nilCount: number;
      tokenCount: number;
      sent: boolean;
      reason: string;
      successCount?: number;
      failureCount?: number;
      invalidTokenCount?: number;
    }>;
  }>("/meta/nil-stock/check-now", payload);
}

export async function getLowStockNotifications(params: {
  shopLocationId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
} = {}) {
  const search = new URLSearchParams();
  if (params.shopLocationId) search.set("shopLocationId", String(params.shopLocationId));
  if (params.status) search.set("status", String(params.status));
  if (params.dateFrom) search.set("dateFrom", String(params.dateFrom));
  if (params.dateTo) search.set("dateTo", String(params.dateTo));

  const query = search.toString();
  const path = query ? `/meta/low-stock/notifications?${query}` : "/meta/low-stock/notifications";
  return apiGet<LowStockNotificationsResponse>(path);
}
