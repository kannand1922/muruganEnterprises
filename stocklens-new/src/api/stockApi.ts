import { apiDelete, apiGet, apiPost } from "./httpClient";

type ApiListEnvelope<T> = {
  success: boolean;
  rows: T[];
  count: number;
  message?: string;
};

type FastMovingSummaryEnvelope = {
  success: boolean;
  checkedDate: string;
  cycleId: number | null;
  shopLocationId: number;
  totalCount: number;
  scannedCount: number;
  uncheckedCount: number;
  lastBestSellingModifiedAt: string | null;
  lastScannedAt: string | null;
  scannedRows: FastMovingRow[];
  uncheckedRows: FastMovingRow[];
};

export type FinishedProgressSummary = {
  success: boolean;
  cycleId: number;
  cycleDate: string;
  shopLocationId: number;
  locationLabel: string;
  scannedCount: number;
  totalProducts: number;
  remainingCount: number;
  progressLabel: string;
};

export type UnfinishedStockRow = {
  id: number;
  cycleId: number;
  itemCode: string;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
  phoneId?: number | null;
  shopLocationId: number;
  activityDate: string;
  quantityBottles: number;
  currentStockBottles: number;
  diffBottles: number;
  isMatched: boolean;
  recheckShown: boolean;
  lastUpdatedByWorkerId?: number | null;
  stateUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type FinishedStockRow = {
  id: number;
  cycleId: number;
  itemCode: string;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
  phoneId?: number | null;
  shopLocationId: number;
  activityDate: string;
  quantityBottles: number;
  currentStockBottles: number;
  diffBottles: number;
  isMatched: boolean;
  matchedAt?: string | null;
  lastUpdatedByWorkerId?: number | null;
  finishedAt: string;
  finishedByWorkerId?: number | null;
  sourceUnfinishedId?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type FastMovingRow = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  scannedAt: string | null;
};

export type VerifyMismatchedFinishedRow = {
  id: number;
  cycleId: number;
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  bpc: number;
  mrp: number | null;
  shopLocationId: number;
  shopLocationName: string;
  activityDate: string;
  updatedAt: string;
  enteredBottles: number;
  enteredFormatted: string;
  currentStockBottles: number;
  currentStockFormatted: string;
  diffBottles: number;
  diffFormatted: string;
};

export type VerifyUncheckedFinishedRow = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
  cycleId: number;
  cycleStatus: string;
  shopLocationId: number;
  shopLocationName: string;
};

export type DiffItem = {
  id: number;
  diffBatchId: number;
  sourceScope: "unfinished" | "finished";
  sourceUnfinishedId?: number | null;
  sourceFinishedId?: number | null;
  cycleId: number;
  itemCode: string;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
  phoneId?: number | null;
  phoneName?: string | null;
  shopLocationId: number;
  activityDate: string;
  quantityBottles: number;
  currentStockBottles: number;
  diffBottles: number;
  isMatched: boolean;
  matchedAt?: string | null;
  lastUpdatedByWorkerId?: number | null;
  finishedAt?: string | null;
  finishedByWorkerId?: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type DiffBatch = {
  id: number;
  cycleId: number;
  shopLocationId: number;
  createdByWorkerId?: number | null;
  proofImagePath?: string | null;
  proofImageName?: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  items?: DiffItem[];
  cycle?: {
    id: number;
    sno?: number | null;
    startDate: string;
    endDate?: string | null;
    status: string;
  };
  shopLocation?: {
    id: number;
    locationName: string;
    locationCode: string;
    locationColor?: string | null;
  };
};

export async function getUnfinishedStock(cycleId: number, shopLocationId: number) {
  const result = await apiGet<ApiListEnvelope<UnfinishedStockRow>>(
    `/stock/unfinished?cycleId=${encodeURIComponent(String(cycleId))}&shopLocationId=${encodeURIComponent(String(shopLocationId))}`
  );
  return result.rows;
}

export async function getUnfinishedStockByOperator(
  cycleId: number,
  operatorId: number,
  shopLocationId: number
) {
  const params = new URLSearchParams({
    cycleId: String(cycleId),
    operatorId: String(operatorId),
    shopLocationId: String(shopLocationId),
  });
  const result = await apiGet<ApiListEnvelope<UnfinishedStockRow>>(
    `/stock/unfinished/by-operator?${params.toString()}`
  );
  return result.rows;
}

export async function getFinishedStock(cycleId: number, shopLocationId: number) {
  const result = await apiGet<ApiListEnvelope<FinishedStockRow>>(
    `/stock/finished?cycleId=${encodeURIComponent(String(cycleId))}&shopLocationId=${encodeURIComponent(String(shopLocationId))}`
  );
  return result.rows;
}

export async function getFinishedProgressSummary(params: {
  cycleId?: number | null;
  shopLocationId: number;
}) {
  const search = new URLSearchParams({
    shopLocationId: String(params.shopLocationId),
  });
  if (params.cycleId) {
    search.set("cycleId", String(params.cycleId));
  }
  return apiGet<FinishedProgressSummary>(`/stock/finished/progress?${search.toString()}`);
}

export async function upsertUnfinishedStock(payload: {
  cycleId: number;
  itemCode: string;
  shopLocationId: number;
  activityDate?: string;
  quantityBottles: number;
  currentStockBottles: number;
  itemName?: string;
  brandName?: string;
  packValue?: string;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string;
  phoneId?: number | null;
  lastUpdatedByWorkerId?: number | null;
  recheckShown?: boolean;
}) {
  return apiPost<{ success: boolean; row: UnfinishedStockRow }>("/stock/unfinished/upsert", payload);
}

export async function printVerificationReport(payload: {
  printerId: number;
  cycleId?: number;
  activityDate?: string;
  preview?: boolean;
}) {
  return apiPost<{
    success: boolean;
    message?: string;
    cycleId: number;
    activityDate: string;
  }>("/stock/print/verification-report", payload);
}

export async function printVerificationList(payload: {
  printerId: number;
  filter: "matched" | "unmatched" | "unchecked";
  cycleId?: number;
  activityDate?: string;
  preview?: boolean;
  filterLabel?: string;
  filteredItems?: Array<{
    shopLocationId: number;
    itemCode: string;
    displayName: string;
  }>;
}) {
  return apiPost<{
    success: boolean;
    message?: string;
    cycleId: number;
    activityDate: string;
    filter: string;
  }>("/stock/print/verification-list", payload);
}

export async function printDifferenceReport(payload: {
  printerId: number;
  scope: "today" | "total";
  cycleId?: number;
  activityDate?: string;
  preview?: boolean;
}) {
  return apiPost<{
    success: boolean;
    message?: string;
    cycleId: number;
    cycleDate: string;
    scope: "today" | "total";
    todayDate: string;
  }>("/stock/print/difference-report", payload);
}

export async function printDifferenceByPersonReport(payload: {
  printerId: number;
  mode: "individual" | "common";
  scope: "today" | "total";
  cycleId?: number;
  activityDate?: string;
  preview?: boolean;
}) {
  return apiPost<{
    success: boolean;
    message?: string;
    cycleId: number;
    cycleDate: string;
    todayDate: string;
    scope: "today" | "total";
    mode: "individual" | "common";
    individualCount?: number;
    partialFailure?: boolean;
  }>("/stock/print/difference-by-person", payload);
}

export async function finishUnfinishedStock(payload: {
  cycleId: number;
  itemCode: string;
  shopLocationId: number;
  activityDate?: string;
  finishedByWorkerId?: number | null;
}) {
  return apiPost<{
    success: boolean;
    finished: unknown;
    unfinishedId: number;
  }>("/stock/unfinished/finish", payload);
}

export async function finishUnfinishedByOperator(payload: {
  cycleId: number;
  operatorId: number;
  shopLocationId?: number;
  finishedByWorkerId?: number | null;
  printerId?: number;
  preview?: boolean;
}) {
  return apiPost<{
    success: boolean;
    cycleId: number;
    operatorId: number;
    shopLocationId: number | null;
    finishedByWorkerId?: number | null;
    finishedCount: number;
    unfinishedIds: number[];
    finishReport?: {
      cycleDate: string;
      operatorName: string;
      sectionCount: number;
      sections: Array<{ label: string; count: number }>;
    };
    finishReportHtml?: string;
    print?: {
      requested: boolean;
      attempted: boolean;
      success: boolean;
      skipped: boolean;
      message?: string;
      error?: string | null;
      printer?: {
        id: number;
        name: string;
        ipAddress: string;
        port: number;
      } | null;
      printResult?: {
        success?: boolean;
        message?: string;
        referenceCode?: string;
      } | null;
    };
  }>("/stock/unfinished/finish-by-operator", payload);
}

export async function finishTodayUnfinished(payload?: {
  cycleId?: number;
  shopLocationId?: number;
  operatorId?: number;
  finishedByWorkerId?: number | null;
  activityDate?: string;
}) {
  return apiPost<{
    success: boolean;
    cycleId: number;
    cycleStatus: string;
    activityDate: string;
    shopLocationId: number | null;
    operatorId: number | null;
    finishedByWorkerId: number | null;
    finishedCount: number;
    unfinishedIds: number[];
  }>("/stock/unfinished/finish-today", payload || {});
}

export async function resetUnfinishedStock(cycleId?: number, shopLocationId?: number) {
  const payload: { cycleId?: number; shopLocationId?: number } = {};
  if (cycleId) payload.cycleId = cycleId;
  if (shopLocationId) payload.shopLocationId = shopLocationId;
  return apiPost<{ success: boolean; deletedCount: number; scope: string }>(
    "/stock/unfinished/reset",
    payload
  );
}

export async function resetFinishedStock(cycleId?: number, shopLocationId?: number) {
  const payload: { cycleId?: number; shopLocationId?: number } = {};
  if (cycleId) payload.cycleId = cycleId;
  if (shopLocationId) payload.shopLocationId = shopLocationId;
  return apiPost<{ success: boolean; deletedCount: number; scope: string }>(
    "/stock/finished/reset",
    payload
  );
}

export async function getFastMovingSummary(params: {
  shopLocationId: number;
  cycleId?: number | null;
  activityDate?: string;
}) {
  const search = new URLSearchParams({
    shopLocationId: String(params.shopLocationId),
  });
  if (params.cycleId) search.set("cycleId", String(params.cycleId));
  if (params.activityDate) search.set("activityDate", params.activityDate);
  return apiGet<FastMovingSummaryEnvelope>(`/stock/fast-moving-summary?${search.toString()}`);
}

export async function getVerifyMismatchedFinished(params: {
  operatorId?: number | null;
  cycleId?: number | null;
  shopLocationId?: number | null;
}) {
  const search = new URLSearchParams();
  if (params.operatorId) search.set("operatorId", String(params.operatorId));
  if (params.cycleId) search.set("cycleId", String(params.cycleId));
  if (params.shopLocationId) search.set("shopLocationId", String(params.shopLocationId));
  return apiGet<{
    success: boolean;
    cycleId: number;
    cycleStatus: string;
    operatorId: number | null;
    shopLocationId: number | null;
    count: number;
    rows: VerifyMismatchedFinishedRow[];
  }>(`/stock/verify/mismatched-finished?${search.toString()}`);
}

export async function getVerifyUncheckedFinished(params: {
  cycleId?: number | null;
  shopLocationId: number;
}) {
  const search = new URLSearchParams({
    shopLocationId: String(params.shopLocationId),
  });
  if (params.cycleId) search.set("cycleId", String(params.cycleId));
  return apiGet<{
    success: boolean;
    cycleId: number;
    cycleStatus: string;
    shopLocationId: number;
    shopLocationName: string;
    count: number;
    rows: VerifyUncheckedFinishedRow[];
  }>(`/stock/verify/unchecked-finished?${search.toString()}`);
}

export async function getDiffBatches(params: {
  shopLocationId: number;
  cycleId?: number | null;
  includeDeleted?: boolean;
}) {
  const search = new URLSearchParams({
    shopLocationId: String(params.shopLocationId),
  });
  if (params.cycleId) search.set("cycleId", String(params.cycleId));
  if (params.includeDeleted) search.set("includeDeleted", "true");
  return apiGet<{
    success: boolean;
    count: number;
    rows: DiffBatch[];
  }>(`/stock/diff-batches?${search.toString()}`);
}

export async function createDiffBatch(payload: {
  cycleId: number;
  shopLocationId: number;
  sourceScope: "unfinished" | "finished";
  itemIds: number[];
  createdByWorkerId?: number | null;
  proofImageName?: string;
  proofImageData?: string;
  proofImageMimeType?: string;
}) {
  return apiPost<{
    success: boolean;
    movedCount: number;
    movedIds: number[];
    batch: DiffBatch;
    report?: {
      batchId: number;
      cycleDate: string;
      locationLabel: string;
      createdAt: string;
      createdByName: string;
      proofImagePath?: string;
      totalItems: number;
      totalDiff: string;
      sections: Array<{ label: string; rows: Array<{ name: string; diffLabel: string }> }>;
    };
    print?: {
      requested: boolean;
      attempted: boolean;
      success: boolean;
      skipped: boolean;
      message: string;
    };
  }>("/stock/diff-batches", payload);
}

export async function deleteDiffBatch(batchId: number) {
  return apiDelete<{
    success: boolean;
    restoredUnfinished?: number;
    restoredFinished?: number;
    restoredCount?: number;
  }>(`/stock/diff-batches/${encodeURIComponent(String(batchId))}`);
}
