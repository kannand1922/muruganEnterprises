import axios from "axios";
import type {
  BestSellingProduct,
  CentralAccessDevice,
  CentralAccessSessionRow,
  CentralAccessStatus,
  CentralAccessUser,
  CentralDashboardResponse,
  CentralDashboardShopDetailResponse,
  CentralMasterAccessStatus,
  CentralMasterProductsByShopResponse,
  CentralReverseSyncSettings,
  CentralSecuritySettings,
  CentralShopEndpoint,
  MasterProduct,
  Worker,
  WorkerLookupRow,
  WorkerPayload,
} from "./types";
import { centralApiClient } from "./centralApiClient";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await centralApiClient.request<T>({
      url: path,
      method: init?.method as
        | "GET"
        | "POST"
        | "PUT"
        | "PATCH"
        | "DELETE"
        | "HEAD"
        | "OPTIONS"
        | undefined,
      headers: init?.headers as Record<string, string> | undefined,
      data: init?.body,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message =
        (error.response?.data as { message?: string } | undefined)?.message ||
        `Request failed with status ${error.response?.status || 500}`;
      throw new Error(message);
    }
    throw error;
  }
}

export async function getCentralAuthStatus() {
  const result = await request<{ success: boolean; data: CentralAccessStatus }>("/meta/central/auth/status");
  return result.data;
}

export async function bootstrapCentralOwner(email: string) {
  const result = await request<{
    success: boolean;
    data: {
      email: string;
      expiresAt: string;
      sessionDays: number;
      otpTtlMinutes: number;
    };
  }>("/meta/central/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return result.data;
}

export async function requestCentralOtp(email: string) {
  const result = await request<{
    success: boolean;
    data: {
      email: string;
      expiresAt: string;
      sessionDays: number;
      otpTtlMinutes: number;
    };
  }>("/meta/central/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return result.data;
}

export async function verifyCentralOtp(email: string, otp: string) {
  const result = await request<{
    success: boolean;
    data: {
      expiresAt: string;
      user: CentralAccessUser;
      sessionDays: number;
    };
  }>("/meta/central/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp }),
  });
  return result.data;
}

export async function logoutCentralSession() {
  return request<{ success: boolean; message: string }>("/meta/central/auth/logout", {
    method: "POST",
  });
}

export async function getCentralSecuritySettings() {
  const result = await request<{ success: boolean; data: CentralSecuritySettings }>(
    "/meta/central/auth/security"
  );
  return result.data;
}

export async function updateCentralOwnerEmail(email: string) {
  const result = await request<{ success: boolean; data: { ownerEmail: string } }>(
    "/meta/central/auth/security/owner-email",
    {
      method: "PUT",
      body: JSON.stringify({ email }),
    }
  );
  return result.data;
}

export async function revokeAllCentralSessions() {
  const result = await request<{
    success: boolean;
    data: {
      revokedCount: number;
      revokedAt: string;
      message: string;
    };
  }>("/meta/central/auth/security/revoke-all", {
    method: "POST",
  });
  return result.data;
}

export async function getCentralDevices() {
  const result = await request<{ success: boolean; rows: CentralAccessDevice[] }>(
    "/meta/central/auth/devices"
  );
  return result.rows;
}

export async function getCentralSessions() {
  const result = await request<{ success: boolean; rows: CentralAccessSessionRow[] }>(
    "/meta/central/auth/sessions"
  );
  return result.rows;
}

export async function revokeCentralSessionById(id: number) {
  const result = await request<{
    success: boolean;
    data: {
      revokedSessionId: number;
      email?: string | null;
    };
  }>(`/meta/central/auth/sessions/${id}/revoke`, {
    method: "POST",
  });
  return result.data;
}

export async function logoutCentralDeviceSessions(id: number) {
  const result = await request<{
    success: boolean;
    data: {
      deviceId: string;
      revokedCount: number;
    };
  }>(`/meta/central/auth/devices/${id}/logout`, {
    method: "POST",
  });
  return result.data;
}

export async function updateCentralDevice(
  id: number,
  payload: {
    active?: boolean;
    canAccessMasterData?: boolean;
  }
) {
  const result = await request<{ success: boolean; data: CentralAccessDevice }>(
    `/meta/central/auth/devices/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export async function getCentralMasterAccessStatus() {
  const result = await request<{ success: boolean; data: CentralMasterAccessStatus }>(
    "/meta/central/auth/master-status"
  );
  return result.data;
}

export async function requestCentralMasterOtp() {
  const result = await request<{
    success: boolean;
    data: {
      email: string;
      expiresAt: string;
      otpTtlMinutes: number;
      unlockTtlMinutes: number;
    };
  }>("/meta/central/auth/master/request-otp", {
    method: "POST",
  });
  return result.data;
}

export async function verifyCentralMasterOtp(otp: string) {
  const result = await request<{
    success: boolean;
    data: {
      expiresAt: string;
      unlockTtlMinutes: number;
    };
  }>("/meta/central/auth/master/verify-otp", {
    method: "POST",
    body: JSON.stringify({ otp }),
  });
  return result.data;
}

export async function logoutCentralMasterAccess() {
  return request<{ success: boolean; message: string }>("/meta/central/auth/master/logout", {
    method: "POST",
  });
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

export async function unlockCentralAdmin(password: string) {
  const result = await request<{
    success: boolean;
    data: {
      verified: boolean;
      token: string;
      expiresAt: string;
    };
  }>("/meta/central/admin-auth", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  return result.data;
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

export async function getCentralDesignations(includeInactive = true) {
  const result = await request<{ success: boolean; count: number; rows: WorkerLookupRow[] }>(
    `/meta/central/designations${includeInactive ? "?includeInactive=1" : ""}`
  );
  return result.rows;
}

export async function createCentralDesignation(payload: { name: string; active?: boolean }) {
  const result = await request<{ success: boolean; data: WorkerLookupRow }>(
    "/meta/central/designations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
}

export async function getCentralWorkLocations(includeInactive = true) {
  const result = await request<{ success: boolean; count: number; rows: WorkerLookupRow[] }>(
    `/meta/central/work-locations${includeInactive ? "?includeInactive=1" : ""}`
  );
  return result.rows;
}

export async function createCentralWorkLocation(payload: { name: string; active?: boolean }) {
  const result = await request<{ success: boolean; data: WorkerLookupRow }>(
    "/meta/central/work-locations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return result.data;
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

export function getCentralMasterProductsByShop(query = "", limit = 10000) {
  const search = new URLSearchParams();
  if (query) search.set("query", query);
  search.set("limit", String(limit));
  return request<CentralMasterProductsByShopResponse>(
    `/meta/central/master-products/by-shop?${search.toString()}`
  );
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
