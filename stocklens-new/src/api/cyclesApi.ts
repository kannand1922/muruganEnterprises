import { apiGet, apiPost } from "./httpClient";

type CurrentCycleEnvelope = {
  success: boolean;
  active: boolean;
  cycle: {
    id: number;
    sno?: number | null;
    startDate: string;
    endDate?: string | null;
    status: "active" | "inactive";
  } | null;
};

export async function getCurrentCycle() {
  return apiGet<CurrentCycleEnvelope>("/cycles/current");
}

export async function startCycle(startDate?: string) {
  return apiPost<{
    success: boolean;
    cycle: {
      id: number;
      sno?: number | null;
      startDate: string;
      endDate?: string | null;
      status: "active" | "inactive";
    };
  }>("/cycles/start", { startDate });
}

export async function getActiveCycleSummary() {
  return apiGet<{
    success: boolean;
    active: boolean;
    cycle: {
      id: number;
      sno?: number | null;
      startDate: string;
      endDate?: string | null;
      status: "active" | "inactive";
    } | null;
    cycleSno: number | null;
    cycleStartDate: string | null;
    closeAllowed: boolean;
    closeGuard: {
      unfinishedCount: number;
      unmatchedFinishedCount: number;
    };
  }>("/cycles/active-summary");
}

export async function stopCycle(cycleId?: number, endDate?: string) {
  return apiPost<{
    success: boolean;
    cycle: {
      id: number;
      sno?: number | null;
      startDate: string;
      endDate?: string | null;
      status: "active" | "inactive";
    };
    print?: {
      success: boolean;
      skipped?: boolean;
      message?: string;
    } | null;
  }>("/cycles/stop", { cycleId, endDate });
}

export async function forceCloseCycle(payload?: {
  startNew?: boolean;
  startDate?: string;
  endDate?: string;
  password?: string;
}) {
  return apiPost<{
    success: boolean;
    closedCycle: {
      id: number;
      sno?: number | null;
      startDate: string;
      endDate?: string | null;
      status: "active" | "inactive";
    };
    startedCycle: {
      id: number;
      sno?: number | null;
      startDate: string;
      endDate?: string | null;
      status: "active" | "inactive";
    } | null;
  }>("/cycles/force-close", payload || {});
}
