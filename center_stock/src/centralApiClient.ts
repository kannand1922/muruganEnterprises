import axios from "axios";
import { getApiBaseUrl } from "./config/env";
import { buildCentralAccessToken } from "./security/centralAuth";

export const centralApiClient = axios.create({
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

centralApiClient.interceptors.request.use((config) => {
  const headers = config.headers || {};
  headers.Authorization = `Bearer ${buildCentralAccessToken()}`;
  config.headers = headers;
  config.baseURL = getApiBaseUrl();
  return config;
});
