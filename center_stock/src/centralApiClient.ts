import axios from "axios";
import { getApiBaseUrl } from "./config/env";
import { getCentralAdminToken } from "./security/adminSession";
import { getCentralDeviceId, getCentralDeviceLabel } from "./security/centralDevice";
import { getCentralAccessToken } from "./security/centralAccessSession";

export const centralApiClient = axios.create({
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

centralApiClient.interceptors.request.use((config) => {
  const headers = config.headers || {};
  headers["x-central-device-id"] = getCentralDeviceId();
  headers["x-central-device-label"] = getCentralDeviceLabel();
  const accessToken = getCentralAccessToken();
  if (accessToken) {
    headers["x-central-session-token"] = accessToken;
  }
  const adminToken = getCentralAdminToken();
  if (adminToken) {
    headers["x-central-admin-token"] = adminToken;
  }
  config.headers = headers;
  config.baseURL = getApiBaseUrl();
  return config;
});
