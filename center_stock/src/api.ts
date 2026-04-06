import type {
  BestSellingProduct,
  CentralDashboardResponse,
  CentralDashboardShopDetailResponse,
  CentralReverseSyncSettings,
  CentralShopEndpoint,
  MasterProduct,
  Worker,
  WorkerPayload,
} from "./types";
import { getApiBaseUrl } from "./config/env";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || `Request failed with status ${response.status}`);
  }

  return data as T;
}

export function getCentralDashboard(params?: {
  cycleId?: number | null;
  shopLocationId?: number | null;
}) {
  const search = new URLSearchParams();
  if (params?.cycleId) search.set("cycleId", String(params.cycleId));
  if (params?.shopLocationId) search.set("shopLocationId", String(params.shopLocationId));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<CentralDashboardResponse>(`/meta/central/dashboard${suffix}`);
}

export function getCentralDashboardShopDetail(
  shopId: number,
  params?: {
    cycleId?: number | null;
    shopLocationId?: number | null;
  }
) {
  const search = new URLSearchParams();
  if (params?.cycleId) search.set("cycleId", String(params.cycleId));
  if (params?.shopLocationId) search.set("shopLocationId", String(params.shopLocationId));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<CentralDashboardShopDetailResponse>(
    `/meta/central/dashboard/shops/${shopId}${suffix}`
  );
}

export async function getCentralShops(includeInactive = true) {
  const result = await request<{
    success: boolean;
    count: number;
    rows: CentralShopEndpoint[];
  }>(`/meta/central/shops${includeInactive ? "?includeInactive=1" : ""}`);
  return result.rows;
}

export async function createCentralShop(payload: {
  shopName: string;
  baseUrl: string;
  active: boolean;
}) {
  const result = await request<{ success: boolean; data: CentralShopEndpoint }>(
    "/meta/central/shops",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export async function updateCentralShop(
  id: number,
  payload: {
    shopName: string;
    baseUrl: string;
    active: boolean;
  }
) {
  const result = await request<{ success: boolean; data: CentralShopEndpoint }>(
    `/meta/central/shops/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export function deleteCentralShop(id: number) {
  return request<{ success: boolean; message: string }>(`/meta/central/shops/${id}`, {
    method: "DELETE",
  });
}

export async function getCentralWorkers(includeInactive = true) {
  const result = await request<{ success: boolean; count: number; rows: Worker[] }>(
    `/meta/central/workers${includeInactive ? "?includeInactive=1" : ""}`
  );
  return result.rows;
}

export async function createCentralWorker(payload: WorkerPayload) {
  const result = await request<{ success: boolean; data: Worker }>(
    "/meta/central/workers",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export async function updateCentralWorker(
  id: number,
  payload: WorkerPayload
) {
  const result = await request<{ success: boolean; data: Worker }>(
    `/meta/central/workers/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export function deleteCentralWorker(id: number) {
  return request<{ success: boolean; message: string }>(`/meta/central/workers/${id}`, {
    method: "DELETE",
  });
}

export async function getCentralBestSelling(includeInactive = true) {
  const result = await request<{ success: boolean; count: number; rows: BestSellingProduct[] }>(
    `/meta/central/best-selling${includeInactive ? "?includeInactive=1" : ""}`
  );
  return result.rows;
}

export async function createCentralBestSelling(payload: {
  itemCode: string;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  active?: boolean;
}) {
  const result = await request<{ success: boolean; data: BestSellingProduct }>(
    "/meta/central/best-selling",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export async function deleteCentralBestSelling(id: number) {
  return request<{ success: boolean; message: string }>(`/meta/central/best-selling/${id}`, {
    method: "DELETE",
  });
}

export async function getMasterProducts(query = "", limit = 500) {
  const search = new URLSearchParams();
  if (query) search.set("query", query);
  search.set("limit", String(limit));
  const result = await request<{ success: boolean; count: number; rows: MasterProduct[] }>(
    `/meta/central/master-products?${search.toString()}`
  );
  return result.rows;
}

export async function getCentralReverseSyncSettings() {
  const result = await request<{ success: boolean; data: CentralReverseSyncSettings }>(
    "/meta/central/reverse-sync-settings"
  );
  return result.data;
}

export async function updateCentralReverseSyncSettings(payload: CentralReverseSyncSettings) {
  const result = await request<{ success: boolean; data: CentralReverseSyncSettings }>(
    "/meta/central/reverse-sync-settings",
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}
