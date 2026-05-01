const express = require("express");
const fs = require("fs");
const net = require("net");
const { prisma } = require("../prisma");
const { centralPrisma } = require("../centralPrisma");
const {
  searchMasterProducts,
  getMasterProductByCode,
  masterFilePath,
} = require("../services/masterProducts");
const { verifySettingsPassword } = require("../services/settingsPassword");
const {
  CENTRAL_ADMIN_TOKEN_HEADER,
  issueCentralAdminToken,
  validateCentralAdminToken,
  verifyCentralAdminPassword,
} = require("../services/centralAdminAuth");
const {
  CENTRAL_SESSION_HEADER,
  CENTRAL_SESSION_COOKIE,
  CENTRAL_DEVICE_HEADER,
  CENTRAL_DEVICE_LABEL_HEADER,
  SESSION_TTL_DAYS,
  OTP_TTL_MINUTES,
  MASTER_UNLOCK_TTL_MINUTES,
  bootstrapOwner,
  requestLoginOtp,
  verifyLoginOtp,
  validateCentralSession,
  revokeSession,
  revokeAllCentralSessions,
  updateOwnerEmail,
  requestMasterAccessOtp,
  verifyMasterAccessOtp,
  revokeMasterAccess,
  getMasterAccessStatus,
  getAccessAuthStatus,
  listActiveCentralSessions,
  revokeCentralSessionById,
  revokeCentralSessionsByDevice,
  listCentralDevices,
  updateCentralDeviceAccess,
} = require("../services/centralAccessAuth");
const {
  getMasterMaxAgeMinutes,
  formatTimestampIST,
  formatAgeLabel,
} = require("../services/masterStatus");
const { sendPushNotification } = require("../services/fcmPush");
const {
  evaluateLowStock,
  getLocationLowStockSettings,
  saveLocationLowStockSettings,
  runLowStockCheckAndNotify,
} = require("../services/lowStockAlerts");
const {
  evaluateHighStock,
  getLocationHighStockSettings,
  saveLocationHighStockSettings,
} = require("../services/highStockAlerts");
const {
  evaluateNilStock,
  getLocationNilStockSettings,
  saveLocationNilStockSettings,
  runNilStockCheckAndNotify,
} = require("../services/nilStockAlerts");
const { getActiveDeviceCutoff, getActiveDeviceWindowMs } = require("../services/pushTokenActivity");
const {
  readCentralCatalog,
  normalizeOperators,
  normalizeBestSellers,
  normalizeDesignations,
  normalizeWorkLocations,
  syncCatalogToLocal,
  syncCentralCatalog,
  getCentralSyncState,
} = require("../services/centralCatalogSync");

const router = express.Router();
const CENTRAL_SYNC_BASE_URL_KEY = "central_sync_base_url";
const CENTRAL_SYNC_OPERATORS_ENABLED_KEY = "central_sync_operators_enabled";
const CENTRAL_SYNC_BEST_SELLING_ENABLED_KEY = "central_sync_best_selling_enabled";
const CENTRAL_REVERSE_SYNC_OPERATORS_ENABLED_KEY = "central_reverse_sync_operators_enabled";
const CENTRAL_REVERSE_SYNC_BEST_SELLING_ENABLED_KEY = "central_reverse_sync_best_selling_enabled";
const CENTRAL_SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function readCookie(req, cookieName) {
  const rawHeader = String(req.headers?.cookie || "");
  if (!rawHeader) return "";
  const pairs = rawHeader.split(";").map((entry) => entry.trim());
  for (const pair of pairs) {
    if (!pair) continue;
    const separatorIndex = pair.indexOf("=");
    const key = separatorIndex >= 0 ? pair.slice(0, separatorIndex).trim() : pair.trim();
    if (key !== cookieName) continue;
    const value = separatorIndex >= 0 ? pair.slice(separatorIndex + 1).trim() : "";
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

function getCentralDeviceId(req) {
  const headerValue = req.headers[CENTRAL_DEVICE_HEADER];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function getCentralDeviceLabel(req) {
  const headerValue = req.headers[CENTRAL_DEVICE_LABEL_HEADER];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function getRequestIpAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0] || "").split(",")[0].trim();
  }
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "";
}

function getCentralSessionToken(req) {
  const headerValue = req.headers[CENTRAL_SESSION_HEADER];
  const tokenFromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return String(tokenFromHeader || readCookie(req, CENTRAL_SESSION_COOKIE) || "").trim();
}

function isHttpsRequest(req) {
  if (req.secure) return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (Array.isArray(forwardedProto)) {
    return String(forwardedProto[0] || "").trim().toLowerCase() === "https";
  }
  return String(forwardedProto || "").trim().toLowerCase() === "https";
}

function setCentralSessionCookie(res, req, token) {
  res.cookie(CENTRAL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(req),
    path: "/",
    maxAge: CENTRAL_SESSION_COOKIE_MAX_AGE_MS,
  });
}

function clearCentralSessionCookie(res, req) {
  res.clearCookie(CENTRAL_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(req),
    path: "/",
  });
}

function getCentralRequestMeta(req) {
  return {
    deviceId: getCentralDeviceId(req),
    deviceLabel: getCentralDeviceLabel(req),
    ipAddress: getRequestIpAddress(req),
    userAgent: req.headers["user-agent"],
  };
}

function toNullableText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function toLowerTrimmed(value) {
  return String(value || "").trim().toLowerCase();
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseId(rawId) {
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseOptionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseIncludeInactive(value) {
  return parseOptionalBoolean(value, false);
}

function parseDateBoundary(rawValue, endOfDay = false) {
  const value = String(rawValue || "").trim();
  if (!value) return null;
  const parsed = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parsePrinterPort(value) {
  if (value === undefined || value === null || value === "") return 9100;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const port = Math.trunc(parsed);
  if (port < 1 || port > 65535) return null;
  return port;
}

function requireCentralAdminAccess(req, res, next) {
  const headerValue = req.headers[CENTRAL_ADMIN_TOKEN_HEADER];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const validation = validateCentralAdminToken(token);
  if (!validation.ok) {
    return res.status(401).json({
      success: false,
      message: validation.message || "Admin access required",
    });
  }
  return next();
}

async function requireCentralSessionAccess(req, res, next) {
  const validation = await validateCentralSession(
    getCentralSessionToken(req),
    getCentralDeviceId(req),
    getCentralRequestMeta(req)
  );
  if (!validation.ok) {
    clearCentralSessionCookie(res, req);
    return res.status(401).json({
      success: false,
      message: validation.message || "Central login required",
    });
  }
  req.centralAccessUser = validation.user;
  req.centralAccessSession = validation.session;
  return next();
}

async function requireCentralMasterAccess(req, res, next) {
  const validation = await validateCentralSession(
    getCentralSessionToken(req),
    getCentralDeviceId(req),
    getCentralRequestMeta(req)
  );
  if (!validation.ok) {
    clearCentralSessionCookie(res, req);
    return res.status(401).json({
      success: false,
      message: validation.message || "OTP verification is required to access master data",
    });
  }
  req.centralAccessUser = validation.user;
  req.centralAccessSession = validation.session;
  return next();
}

function requireCentralOwner(req, res, next) {
  const role = String(req.centralAccessUser?.role || "").trim().toLowerCase();
  if (role !== "owner") {
    return res.status(403).json({
      success: false,
      message: "Owner access required",
    });
  }
  return next();
}

async function requireCentralOwnerOrAdminAccess(req, res, next) {
  const headerValue = req.headers[CENTRAL_ADMIN_TOKEN_HEADER];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const adminValidation = validateCentralAdminToken(token);
  if (adminValidation.ok) {
    req.centralAdmin = {
      enabled: true,
      expiresAt: adminValidation.expiresAt,
    };
    return next();
  }

  const validation = await validateCentralSession(
    getCentralSessionToken(req),
    getCentralDeviceId(req),
    getCentralRequestMeta(req)
  );
  if (!validation.ok) {
    clearCentralSessionCookie(res, req);
    return res.status(401).json({
      success: false,
      message: "Owner login or admin mode is required",
    });
  }

  req.centralAccessUser = validation.user;
  req.centralAccessSession = validation.session;
  const role = String(validation.user?.role || "").trim().toLowerCase();
  if (role !== "owner") {
    return res.status(403).json({
      success: false,
      message: "Owner access required",
    });
  }
  return next();
}

function isValidPrinterIp(value) {
  return net.isIP(String(value || "").trim()) !== 0;
}

function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const candidate = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

function normalizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseStoredBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

async function getAppSettingValue(key) {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setAppSettingValue(key, value) {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function getCatalogSyncSettings() {
  const [centralBaseUrlRaw, operatorsEnabledRaw, bestSellingEnabledRaw] = await Promise.all([
    getAppSettingValue(CENTRAL_SYNC_BASE_URL_KEY),
    getAppSettingValue(CENTRAL_SYNC_OPERATORS_ENABLED_KEY),
    getAppSettingValue(CENTRAL_SYNC_BEST_SELLING_ENABLED_KEY),
  ]);

  return {
    centralBaseUrl: normalizeHttpUrl(centralBaseUrlRaw),
    syncOperatorsWithCentral: parseStoredBoolean(operatorsEnabledRaw, true),
    syncBestSellingWithCentral: parseStoredBoolean(bestSellingEnabledRaw, true),
  };
}

async function saveCatalogSyncSettings(payload = {}) {
  const centralBaseUrl = normalizeHttpUrl(payload.centralBaseUrl);
  const syncOperatorsWithCentral = parseOptionalBoolean(payload.syncOperatorsWithCentral, true);
  const syncBestSellingWithCentral = parseOptionalBoolean(payload.syncBestSellingWithCentral, true);

  await Promise.all([
    setAppSettingValue(CENTRAL_SYNC_BASE_URL_KEY, centralBaseUrl || ""),
    setAppSettingValue(
      CENTRAL_SYNC_OPERATORS_ENABLED_KEY,
      syncOperatorsWithCentral ? "true" : "false"
    ),
    setAppSettingValue(
      CENTRAL_SYNC_BEST_SELLING_ENABLED_KEY,
      syncBestSellingWithCentral ? "true" : "false"
    ),
  ]);

  return {
    centralBaseUrl,
    syncOperatorsWithCentral,
    syncBestSellingWithCentral,
  };
}

async function getCentralReverseSyncSettings() {
  const [operatorsEnabledRaw, bestSellingEnabledRaw] = await Promise.all([
    getAppSettingValue(CENTRAL_REVERSE_SYNC_OPERATORS_ENABLED_KEY),
    getAppSettingValue(CENTRAL_REVERSE_SYNC_BEST_SELLING_ENABLED_KEY),
  ]);

  return {
    reverseSyncOperatorsEnabled: parseStoredBoolean(operatorsEnabledRaw, true),
    reverseSyncBestSellingEnabled: parseStoredBoolean(bestSellingEnabledRaw, true),
  };
}

async function saveCentralReverseSyncSettings(payload = {}) {
  const reverseSyncOperatorsEnabled = parseOptionalBoolean(
    payload.reverseSyncOperatorsEnabled,
    true
  );
  const reverseSyncBestSellingEnabled = parseOptionalBoolean(
    payload.reverseSyncBestSellingEnabled,
    true
  );

  await Promise.all([
    setAppSettingValue(
      CENTRAL_REVERSE_SYNC_OPERATORS_ENABLED_KEY,
      reverseSyncOperatorsEnabled ? "true" : "false"
    ),
    setAppSettingValue(
      CENTRAL_REVERSE_SYNC_BEST_SELLING_ENABLED_KEY,
      reverseSyncBestSellingEnabled ? "true" : "false"
    ),
  ]);

  return {
    reverseSyncOperatorsEnabled,
    reverseSyncBestSellingEnabled,
  };
}

const REMOTE_SHOP_TIMEOUT_MS = 8000;

function buildRemoteApiUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname.startsWith("/") ? pathname : `/${pathname}`, `${baseUrl}/`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = REMOTE_SHOP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: init.method || "GET",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      body: init.body,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error ||
        `Remote request failed with status ${response.status}`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Remote response was not valid JSON");
    }
    return payload;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function pickOverviewMetrics(summary = null) {
  if (!summary) return null;
  return {
    scannedCount: Number(summary.scannedCount) || 0,
    trackedCount: Number(summary.trackedCount) || 0,
    matchedCount: Number(summary.matchedCount) || 0,
    uncheckedCount: Number(summary.uncheckedCount) || 0,
    mismatchCount: Number(summary.mismatchCount) || 0,
    totalDiffBottles: Number(summary.totalDiffBottles) || 0,
    totalDiffValue: Number(summary.totalDiffValue) || 0,
    totalDiffValueFormatted: String(summary.totalDiffValueFormatted || "0.00"),
    locationCount: Number(summary.locationCount) || 0,
    operatorCount: Number(summary.operatorCount) || 0,
  };
}

function mergeLocationOverview(cycleLocation = null, todayLocation = null) {
  const source = cycleLocation || todayLocation || {};
  return {
    shopLocationId: source.shopLocationId ?? null,
    shopLocationCode: source.shopLocationCode || "",
    shopLocationName: source.shopLocationName || "",
    shopLocationLabel: source.shopLocationLabel || "",
    cycle: cycleLocation ? pickOverviewMetrics(cycleLocation) : null,
    today: todayLocation ? pickOverviewMetrics(todayLocation) : null,
  };
}

function summarizeRemoteOverviewForDashboard(endpoint, overview) {
  const cycleLocations = Array.isArray(overview?.locations) ? overview.locations : [];
  const todayLocations = Array.isArray(overview?.today?.locations) ? overview.today.locations : [];
  const cycleByLocation = new Map(cycleLocations.map((row) => [Number(row.shopLocationId), row]));
  const todayByLocation = new Map(todayLocations.map((row) => [Number(row.shopLocationId), row]));
  const locationIds = new Set([...cycleByLocation.keys(), ...todayByLocation.keys()]);
  const nilByLocation = Array.isArray(overview?.nilStock?.byLocation)
    ? overview.nilStock.byLocation.map((row) => ({
        locationId: Number(row?.locationId) || 0,
        label: String(row?.label || "").trim() || "LOCATION",
        count: Number(row?.count) || 0,
      }))
    : [];
  const nilTotalCountFromLocations = nilByLocation.reduce((sum, row) => sum + row.count, 0);
  const nilTotalCount = Number(overview?.nilStock?.totalCount);
  const safeNilTotalCount = Number.isFinite(nilTotalCount)
    ? nilTotalCount
    : Number(overview?.nilCount) || nilTotalCountFromLocations;

  return {
    id: endpoint.id,
    registryName: endpoint.shopName,
    baseUrl: endpoint.baseUrl,
    active: Boolean(endpoint.active),
    status: "online",
    shopName: String(overview?.shopName || endpoint.shopName || "").trim() || endpoint.shopName,
    cycle: overview?.cycle || null,
    cycleSummary: pickOverviewMetrics(overview?.summary),
    today: overview?.today
      ? {
          activityDate: overview.today.activityDate || null,
          operatorCount: Number(overview.today.operatorCount) || 0,
          summary: pickOverviewMetrics(overview.today.summary),
        }
      : null,
    nilStock: {
      sourceLocationId: Number(overview?.nilStock?.sourceLocationId) || null,
      sourceLocationLabel: String(overview?.nilStock?.sourceLocationLabel || "").trim() || "",
      totalCount: safeNilTotalCount,
      byLocation: nilByLocation,
    },
    locations: Array.from(locationIds)
      .map((locationId) => mergeLocationOverview(cycleByLocation.get(locationId), todayByLocation.get(locationId)))
      .sort((a, b) => String(a.shopLocationLabel || "").localeCompare(String(b.shopLocationLabel || ""))),
  };
}

function mergeMasterProductRow(existing, candidate) {
  const next = { ...(existing || {}) };
  const source = candidate && typeof candidate === "object" ? candidate : {};

  const preferFields = [
    "itemCode",
    "itemName",
    "brandName",
    "packValue",
    "bpc",
    "mrp",
    "barcode",
    "godownStock",
    "shopStock",
  ];

  for (const field of preferFields) {
    const currentValue = next[field];
    const incomingValue = source[field];
    const hasCurrent =
      currentValue !== undefined &&
      currentValue !== null &&
      String(currentValue).trim() !== "";
    const hasIncoming =
      incomingValue !== undefined &&
      incomingValue !== null &&
      String(incomingValue).trim() !== "";
    if (!hasCurrent && hasIncoming) {
      next[field] = incomingValue;
    }
  }

  const currentLocationStocks =
    next.locationStocks && typeof next.locationStocks === "object" ? next.locationStocks : {};
  const incomingLocationStocks =
    source.locationStocks && typeof source.locationStocks === "object" ? source.locationStocks : {};

  next.locationStocks = {
    ...currentLocationStocks,
    ...incomingLocationStocks,
  };

  return next;
}

function sortMasterProducts(rows) {
  return [...rows].sort((a, b) => {
    const brandDiff = String(a?.brandName || "").localeCompare(String(b?.brandName || ""));
    if (brandDiff !== 0) return brandDiff;
    const itemDiff = String(a?.itemName || "").localeCompare(String(b?.itemName || ""));
    if (itemDiff !== 0) return itemDiff;
    return String(a?.itemCode || "").localeCompare(String(b?.itemCode || ""));
  });
}

async function readAggregatedCentralMasterProducts({ query = "", limit = 10000 } = {}) {
  const { activeEndpoints, remoteResponses } = await fetchCentralMasterProductsByShop({
    query,
    limit,
  });

  const mergedByCode = new Map();

  for (const response of remoteResponses) {
    for (const row of response.rows) {
      const codeKey = toLowerTrimmed(row?.itemCode);
      if (!codeKey) continue;
      const existing = mergedByCode.get(codeKey) || null;
      mergedByCode.set(codeKey, mergeMasterProductRow(existing, row));
    }
  }

  let rows = sortMasterProducts(Array.from(mergedByCode.values()));
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    rows = rows.slice(0, Math.trunc(Number(limit)));
  }

  return {
    rows,
    sourceCount: activeEndpoints.length,
    successCount: remoteResponses.filter((row) => row.success).length,
    failureCount: remoteResponses.filter((row) => !row.success).length,
    failures: remoteResponses
      .filter((row) => !row.success)
      .map((row) => ({
        shopId: row.endpoint.id,
        shopName: row.endpoint.shopName,
        baseUrl: row.endpoint.baseUrl,
        error: row.error,
      })),
  };
}

async function fetchCentralMasterProductsByShop({ query = "", limit = 10000 } = {}) {
  const activeEndpoints = await centralPrisma.shopEndpoint.findMany({
    where: { active: true },
    orderBy: [{ shopName: "asc" }, { id: "asc" }],
  });

  const remoteResponses = await Promise.all(
    activeEndpoints.map(async (endpoint) => {
      try {
        const payload = await fetchJsonWithTimeout(
          buildRemoteApiUrl(endpoint.baseUrl, "/api/meta/master-products", {
            query,
            limit,
            includeAll: true,
          }),
          {},
          12000
        );
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        return {
          endpoint,
          success: true,
          count: rows.length,
          rows,
          sourceFile: payload?.sourceFile || null,
        };
      } catch (error) {
        return {
          endpoint,
          success: false,
          count: 0,
          rows: [],
          sourceFile: null,
          error: error instanceof Error ? error.message : "Failed to load master products",
        };
      }
    })
  );

  return {
    activeEndpoints,
    remoteResponses,
  };
}

function flattenCentralMasterProductsByShop(remoteResponses = []) {
  const rows = [];

  for (const response of remoteResponses) {
    if (!response?.success) continue;
    const endpoint = response.endpoint || {};
    for (const row of response.rows || []) {
      rows.push({
        shopId: Number(endpoint.id) || null,
        shopName: String(endpoint.shopName || "").trim(),
        baseUrl: String(endpoint.baseUrl || "").trim(),
        active: Boolean(endpoint.active),
        itemCode: row?.itemCode || "",
        itemName: row?.itemName || "",
        brandName: row?.brandName || "",
        packValue: row?.packValue || "",
        bpc: row?.bpc ?? null,
        mrp: row?.mrp ?? null,
        barcode: row?.barcode || "",
        godownStock: row?.godownStock || "",
        shopStock: row?.shopStock || "",
        locationStocks:
          row?.locationStocks && typeof row.locationStocks === "object" ? row.locationStocks : {},
      });
    }
  }

  return rows.sort((a, b) => {
    const shopDiff = String(a?.shopName || "").localeCompare(String(b?.shopName || ""));
    if (shopDiff !== 0) return shopDiff;
    const brandDiff = String(a?.brandName || "").localeCompare(String(b?.brandName || ""));
    if (brandDiff !== 0) return brandDiff;
    const itemDiff = String(a?.itemName || "").localeCompare(String(b?.itemName || ""));
    if (itemDiff !== 0) return itemDiff;
    return String(a?.itemCode || "").localeCompare(String(b?.itemCode || ""));
  });
}

function summarizeCentralMasterProductShops(remoteResponses = []) {
  return remoteResponses.map((response) => ({
    shopId: Number(response?.endpoint?.id) || null,
    shopName: String(response?.endpoint?.shopName || "").trim(),
    baseUrl: String(response?.endpoint?.baseUrl || "").trim(),
    active: Boolean(response?.endpoint?.active),
    success: Boolean(response?.success),
    count: Number(response?.count) || 0,
    sourceFile: response?.sourceFile || null,
    error: response?.success ? null : response?.error || "Failed to load master products",
  }));
}

function createOfflineDashboardShop(endpoint, error) {
  return {
    id: endpoint.id,
    registryName: endpoint.shopName,
    baseUrl: endpoint.baseUrl,
    active: Boolean(endpoint.active),
    status: "offline",
    shopName: endpoint.shopName,
    cycle: null,
    cycleSummary: null,
    today: null,
    nilStock: {
      sourceLocationId: null,
      sourceLocationLabel: "",
      totalCount: 0,
      byLocation: [],
    },
    locations: [],
    error: error instanceof Error ? error.message : String(error || "Unable to reach shop"),
  };
}

function aggregateDashboardShops(shops) {
  const totals = {
    shopCount: shops.length,
    onlineShopCount: 0,
    offlineShopCount: 0,
    nilStockCount: 0,
    cycle: {
      scannedCount: 0,
      trackedCount: 0,
      matchedCount: 0,
      uncheckedCount: 0,
      mismatchCount: 0,
      totalDiffBottles: 0,
      totalDiffValue: 0,
      locationCount: 0,
      operatorCount: 0,
    },
    today: {
      activityDate: null,
      scannedCount: 0,
      trackedCount: 0,
      matchedCount: 0,
      uncheckedCount: 0,
      mismatchCount: 0,
      totalDiffBottles: 0,
      totalDiffValue: 0,
      locationCount: 0,
      operatorCount: 0,
    },
  };

  for (const shop of shops) {
    if (shop.status === "online") {
      totals.onlineShopCount += 1;
      totals.nilStockCount += Number(shop.nilStock?.totalCount) || 0;
      if (shop.cycleSummary) {
        totals.cycle.scannedCount += shop.cycleSummary.scannedCount;
        totals.cycle.trackedCount += shop.cycleSummary.trackedCount;
        totals.cycle.matchedCount += shop.cycleSummary.matchedCount;
        totals.cycle.uncheckedCount += shop.cycleSummary.uncheckedCount;
        totals.cycle.mismatchCount += shop.cycleSummary.mismatchCount;
        totals.cycle.totalDiffBottles += shop.cycleSummary.totalDiffBottles;
        totals.cycle.totalDiffValue += shop.cycleSummary.totalDiffValue;
        totals.cycle.locationCount += shop.cycleSummary.locationCount;
        totals.cycle.operatorCount += shop.cycleSummary.operatorCount;
      }
      if (shop.today?.summary) {
        totals.today.activityDate = totals.today.activityDate || shop.today.activityDate || null;
        totals.today.scannedCount += shop.today.summary.scannedCount;
        totals.today.trackedCount += shop.today.summary.trackedCount;
        totals.today.matchedCount += shop.today.summary.matchedCount;
        totals.today.uncheckedCount += shop.today.summary.uncheckedCount;
        totals.today.mismatchCount += shop.today.summary.mismatchCount;
        totals.today.totalDiffBottles += shop.today.summary.totalDiffBottles;
        totals.today.totalDiffValue += shop.today.summary.totalDiffValue;
        totals.today.locationCount += shop.today.summary.locationCount;
        totals.today.operatorCount += shop.today.summary.operatorCount;
      }
    } else {
      totals.offlineShopCount += 1;
    }
  }

  totals.cycle.totalDiffValueFormatted = totals.cycle.totalDiffValue.toFixed(2);
  totals.today.totalDiffValueFormatted = totals.today.totalDiffValue.toFixed(2);
  return totals;
}

async function pushCentralCatalogToShops(resource, options = {}) {
  const safeResource = ["operators", "bestSellers", "designations", "workLocations"].includes(resource)
    ? resource
    : "operators";
  const reverseSyncSettings = await getCentralReverseSyncSettings();
  if (
    (safeResource === "operators" && !reverseSyncSettings.reverseSyncOperatorsEnabled) ||
    (safeResource === "bestSellers" && !reverseSyncSettings.reverseSyncBestSellingEnabled) ||
    ((safeResource === "designations" || safeResource === "workLocations") &&
      !reverseSyncSettings.reverseSyncOperatorsEnabled)
  ) {
    return {
      resource: safeResource,
      skipped: true,
      message: `Reverse sync disabled for ${safeResource}`,
      ...reverseSyncSettings,
      count: 0,
      successCount: 0,
      failureCount: 0,
      results: [],
    };
  }

  const activeEndpoints = await centralPrisma.shopEndpoint.findMany({
    where: { active: true },
    orderBy: [{ shopName: "asc" }, { id: "asc" }],
  });
  const catalog = await readCentralCatalog({ includeInactive: true });
  const payload = {
    operators: safeResource === "operators" ? normalizeOperators(catalog.operators) : undefined,
    bestSellers: safeResource === "bestSellers" ? normalizeBestSellers(catalog.bestSellers) : undefined,
    designations:
      safeResource === "designations"
        ? normalizeDesignations(catalog.designations || [])
        : undefined,
    workLocations:
      safeResource === "workLocations"
        ? normalizeWorkLocations(catalog.workLocations || [])
        : undefined,
    source: "central",
    resource: safeResource,
    trigger: options.trigger || "central_update",
  };

  const results = await Promise.all(
    activeEndpoints.map(async (endpoint) => {
      try {
        const result = await fetchJsonWithTimeout(
          buildRemoteApiUrl(endpoint.baseUrl, "/api/meta/central-sync/apply"),
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        );
        return {
          shopId: endpoint.id,
          shopName: endpoint.shopName,
          baseUrl: endpoint.baseUrl,
          success: true,
          result,
        };
      } catch (error) {
        return {
          shopId: endpoint.id,
          shopName: endpoint.shopName,
          baseUrl: endpoint.baseUrl,
          success: false,
          message: error instanceof Error ? error.message : "Remote sync failed",
        };
      }
    })
  );

  return {
    resource: safeResource,
    skipped: false,
    count: results.length,
    successCount: results.filter((row) => row.success).length,
    failureCount: results.filter((row) => !row.success).length,
    results,
  };
}

async function forwardCatalogWriteToCentral(settings, path, method, payload = null) {
  if (!settings?.centralBaseUrl) {
    throw new Error("Central sync URL is not configured");
  }

  return fetchJsonWithTimeout(buildRemoteApiUrl(settings.centralBaseUrl, path), {
    method,
    ...(payload == null ? {} : { body: JSON.stringify(payload) }),
  });
}

function mapShopPayload(body) {
  return {
    shopCode: String(body.shopCode || "").trim(),
    shopName: String(body.shopName || "").trim(),
    areaName: toNullableText(body.areaName),
    city: toNullableText(body.city),
    state: toNullableText(body.state),
    pincode: toNullableText(body.pincode),
    addressLine1: toNullableText(body.addressLine1),
    addressLine2: toNullableText(body.addressLine2),
    nilLocation: toIntOrNull(body.nilLocation),
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

function mapLocationPayload(body) {
  const normalizedColor = normalizeHexColor(body.locationColor);
  return {
    locationCode: toLowerTrimmed(body.locationCode),
    locationName: String(body.locationName || "").trim(),
    locationType: toNullableText(body.locationType),
    locationColor: normalizedColor || "#2563eb",
    sortOrder: toIntOrNull(body.sortOrder) ?? 0,
    lowStockNotificationsEnabled: parseOptionalBoolean(body.lowStockNotificationsEnabled, true),
  };
}

function mapPrinterPayload(body) {
  return {
    name: String(body.name || "").trim(),
    ipAddress: String(body.ipAddress || "").trim(),
    port: parsePrinterPort(body.port),
    defaultPrinter: parseOptionalBoolean(body.defaultPrinter, false),
  };
}

function mapPhonePayload(body, existing = null) {
  return {
    name: String(body.name || "").trim(),
    lowStockNotificationsEnabled: parseOptionalBoolean(
      body.lowStockNotificationsEnabled,
      existing?.lowStockNotificationsEnabled ?? true
    ),
  };
}

function mapLookupPayload(body = {}, existing = null) {
  return {
    name: String(body.name ?? existing?.name ?? "").trim(),
    active:
      body.active === undefined
        ? existing?.active === undefined
          ? true
          : Boolean(existing.active)
        : Boolean(body.active),
  };
}

const OPERATOR_RELATION_INCLUDE = {
  designation: true,
  workLocation: true,
  phoneNumbers: {
    orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
  },
  documents: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  },
};

function parseOptionalDateValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseBase64Text(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parseOperatorPhoneNumbers(rawValue, fallbackPhone) {
  const sourceRows = Array.isArray(rawValue) ? rawValue : [];
  const parsedRows = sourceRows
    .map((row) => ({
      label: toNullableText(row?.label),
      phoneNumber: String(row?.phoneNumber ?? row?.phone ?? "").trim(),
      isPrimary: parseOptionalBoolean(row?.isPrimary, false),
    }))
    .filter((row) => row.phoneNumber);

  if (!parsedRows.length) {
    const fallback = String(fallbackPhone || "").trim();
    if (fallback) {
      parsedRows.push({
        label: "Primary",
        phoneNumber: fallback,
        isPrimary: true,
      });
    }
  }

  if (!parsedRows.length) {
    return [];
  }

  if (!parsedRows.some((row) => row.isPrimary)) {
    parsedRows[0].isPrimary = true;
  } else {
    let foundPrimary = false;
    for (const row of parsedRows) {
      if (row.isPrimary && !foundPrimary) {
        foundPrimary = true;
        continue;
      }
      if (row.isPrimary) {
        row.isPrimary = false;
      }
    }
  }

  return parsedRows.map((row, index) => ({
    ...row,
    sortOrder: index,
  }));
}

function normalizeDocumentCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "additionaldetail" || normalized === "additional_detail") {
    return "additionalDetail";
  }
  if (normalized === "otherproof" || normalized === "other_proof") {
    return "otherProof";
  }
  return normalized || "additionalDetail";
}

function parseOperatorDocuments(rawValue) {
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((row, index) => ({
      category: normalizeDocumentCategory(row?.category),
      label: toNullableText(row?.label),
      textValue: toNullableText(row?.textValue),
      fileName: toNullableText(row?.fileName),
      mimeType: toNullableText(row?.mimeType),
      fileDataBase64: parseBase64Text(row?.fileDataBase64),
      sortOrder: toIntOrNull(row?.sortOrder) ?? index,
      active: parseOptionalBoolean(row?.active, true),
    }))
    .filter((row) => row.label || row.textValue || row.fileName || row.fileDataBase64);
}

function getPrimaryPhoneValue(phoneNumbers) {
  if (!Array.isArray(phoneNumbers) || !phoneNumbers.length) return null;
  const primary = phoneNumbers.find((row) => row.isPrimary) || phoneNumbers[0];
  return primary?.phoneNumber || null;
}

function parseOperatorPayload(body = {}, options = {}) {
  const phoneNumbers = parseOperatorPhoneNumbers(body.phoneNumbers, body.phone);
  return {
    name: String(body.name || "").trim(),
    fatherName: String(body.fatherName || "").trim(),
    designationName: String(body.designationName || "").trim(),
    dateOfBirth: parseOptionalDateValue(body.dateOfBirth),
    dateOfJoining: parseOptionalDateValue(body.dateOfJoining),
    dateOfResignation: parseOptionalDateValue(body.dateOfResignation),
    permanentAddress: String(body.permanentAddress || "").trim(),
    temporaryAddress: toNullableText(body.temporaryAddress),
    aadhaarNumber: String(body.aadhaarNumber || "").trim(),
    email: toNullableText(body.email),
    bankAccountNumber: String(body.bankAccountNumber || "").trim(),
    ifscCode: String(body.ifscCode || "").trim(),
    recommendedBy: String(body.recommendedBy || "Direct").trim() || "Direct",
    workLocationName: toNullableText(body.workLocationName),
    profileImageBase64: parseBase64Text(body.profileImageBase64),
    profileImageMimeType: toNullableText(body.profileImageMimeType),
    profileImageFileName: toNullableText(body.profileImageFileName),
    resumeFileBase64: parseBase64Text(body.resumeFileBase64),
    resumeFileMimeType: toNullableText(body.resumeFileMimeType),
    resumeFileName: toNullableText(body.resumeFileName),
    aadhaarImageBase64: parseBase64Text(body.aadhaarImageBase64),
    aadhaarImageMimeType: toNullableText(body.aadhaarImageMimeType),
    aadhaarImageFileName: toNullableText(body.aadhaarImageFileName),
    phoneNumbers,
    documents: parseOperatorDocuments(body.documents),
    active: options.defaultActive === undefined
      ? parseOptionalBoolean(body.active, true)
      : parseOptionalBoolean(body.active, options.defaultActive),
  };
}

function validateOperatorPayload(payload) {
  if (!payload.name) return "Name is required";
  if (!payload.fatherName) return "Father's name is required";
  if (!payload.designationName) return "Designation is required";
  if (!payload.dateOfBirth) return "Date of birth is required";
  if (!payload.dateOfJoining) return "Date of joining is required";
  if (!payload.permanentAddress) return "Permanent address is required";
  if (!payload.aadhaarNumber) return "Aadhaar number is required";
  if (!payload.bankAccountNumber) return "Bank account number is required";
  if (!payload.ifscCode) return "IFSC code is required";
  if (!payload.recommendedBy) return "Recommended by is required";
  if (!payload.profileImageBase64) return "Profile image is required";
  if (!payload.resumeFileBase64) return "Resume file is required";
  if (!payload.aadhaarImageBase64) return "Aadhaar image is required";
  if (!payload.phoneNumbers.length) return "At least one phone number is required";
  return null;
}

function mapOperatorRecord(row) {
  return {
    id: row.id,
    name: row.name,
    fatherName: row.fatherName ?? null,
    designationId: row.designationId ?? null,
    designationName: row.designation?.name ?? null,
    dateOfBirth: row.dateOfBirth ?? null,
    dateOfJoining: row.dateOfJoining ?? null,
    dateOfResignation: row.dateOfResignation ?? null,
    permanentAddress: row.permanentAddress ?? null,
    temporaryAddress: row.temporaryAddress ?? null,
    aadhaarNumber: row.aadhaarNumber ?? null,
    email: row.email ?? null,
    bankAccountNumber: row.bankAccountNumber ?? null,
    ifscCode: row.ifscCode ?? null,
    recommendedBy: row.recommendedBy ?? "Direct",
    workLocationId: row.workLocationId ?? null,
    workLocationName: row.workLocation?.name ?? null,
    profileImageBase64: row.profileImageBase64 ?? null,
    profileImageMimeType: row.profileImageMimeType ?? null,
    profileImageFileName: row.profileImageFileName ?? null,
    resumeFileBase64: row.resumeFileBase64 ?? null,
    resumeFileMimeType: row.resumeFileMimeType ?? null,
    resumeFileName: row.resumeFileName ?? null,
    aadhaarImageBase64: row.aadhaarImageBase64 ?? null,
    aadhaarImageMimeType: row.aadhaarImageMimeType ?? null,
    aadhaarImageFileName: row.aadhaarImageFileName ?? null,
    phone: row.phone ?? getPrimaryPhoneValue(row.phoneNumbers),
    phoneNumbers: Array.isArray(row.phoneNumbers)
      ? row.phoneNumbers.map((phoneRow) => ({
          id: phoneRow.id,
          label: phoneRow.label ?? null,
          phoneNumber: phoneRow.phoneNumber,
          isPrimary: Boolean(phoneRow.isPrimary),
        }))
      : [],
    documents: Array.isArray(row.documents)
      ? row.documents.map((documentRow) => ({
          id: documentRow.id,
          category: documentRow.category,
          label: documentRow.label ?? null,
          textValue: documentRow.textValue ?? null,
          fileName: documentRow.fileName ?? null,
          mimeType: documentRow.mimeType ?? null,
          fileDataBase64: documentRow.fileDataBase64 ?? null,
          sortOrder: documentRow.sortOrder ?? 0,
          active: Boolean(documentRow.active),
        }))
      : [],
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureLookupIdByName(tx, delegateName, name) {
  const normalizedName = toNullableText(name);
  if (!normalizedName) return null;
  const existing = await tx[delegateName].findUnique({ where: { name: normalizedName } });
  if (existing) return existing.id;
  const created = await tx[delegateName].create({
    data: {
      name: normalizedName,
      active: true,
    },
  });
  return created.id;
}

function buildOperatorPhoneNumberCreateRows(phoneNumbers) {
  return phoneNumbers.map((row) => ({
    label: row.label,
    phoneNumber: row.phoneNumber,
    isPrimary: Boolean(row.isPrimary),
  }));
}

function buildOperatorDocumentCreateRows(documents) {
  return documents.map((row) => ({
    category: row.category,
    label: row.label,
    textValue: row.textValue,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileDataBase64: row.fileDataBase64,
    sortOrder: row.sortOrder ?? 0,
    active: row.active !== false,
  }));
}

async function createOperatorRow(tx, modelConfig, payload, options = {}) {
  const designationId = await ensureLookupIdByName(tx, modelConfig.designationDelegate, payload.designationName);
  const workLocationId = await ensureLookupIdByName(tx, modelConfig.workLocationDelegate, payload.workLocationName);
  const primaryPhone = getPrimaryPhoneValue(payload.phoneNumbers);
  const data = {
    ...(options.id ? { id: options.id } : {}),
    name: payload.name,
    fatherName: payload.fatherName,
    designationId,
    dateOfBirth: payload.dateOfBirth,
    dateOfJoining: payload.dateOfJoining,
    dateOfResignation: payload.dateOfResignation,
    permanentAddress: payload.permanentAddress,
    temporaryAddress: payload.temporaryAddress,
    aadhaarNumber: payload.aadhaarNumber,
    email: payload.email,
    bankAccountNumber: payload.bankAccountNumber,
    ifscCode: payload.ifscCode,
    recommendedBy: payload.recommendedBy,
    workLocationId,
    profileImageBase64: payload.profileImageBase64,
    profileImageMimeType: payload.profileImageMimeType,
    profileImageFileName: payload.profileImageFileName,
    resumeFileBase64: payload.resumeFileBase64,
    resumeFileMimeType: payload.resumeFileMimeType,
    resumeFileName: payload.resumeFileName,
    aadhaarImageBase64: payload.aadhaarImageBase64,
    aadhaarImageMimeType: payload.aadhaarImageMimeType,
    aadhaarImageFileName: payload.aadhaarImageFileName,
    phone: primaryPhone,
    active: payload.active,
    phoneNumbers: {
      create: buildOperatorPhoneNumberCreateRows(payload.phoneNumbers),
    },
    documents: {
      create: buildOperatorDocumentCreateRows(payload.documents),
    },
  };

  return tx[modelConfig.personDelegate].create({
    data,
    include: OPERATOR_RELATION_INCLUDE,
  });
}

async function updateOperatorRow(tx, modelConfig, id, payload) {
  const designationId = await ensureLookupIdByName(tx, modelConfig.designationDelegate, payload.designationName);
  const workLocationId = await ensureLookupIdByName(tx, modelConfig.workLocationDelegate, payload.workLocationName);
  const primaryPhone = getPrimaryPhoneValue(payload.phoneNumbers);
  return tx[modelConfig.personDelegate].update({
    where: { id },
    data: {
      name: payload.name,
      fatherName: payload.fatherName,
      designationId,
      dateOfBirth: payload.dateOfBirth,
      dateOfJoining: payload.dateOfJoining,
      dateOfResignation: payload.dateOfResignation,
      permanentAddress: payload.permanentAddress,
      temporaryAddress: payload.temporaryAddress,
      aadhaarNumber: payload.aadhaarNumber,
      email: payload.email,
      bankAccountNumber: payload.bankAccountNumber,
      ifscCode: payload.ifscCode,
      recommendedBy: payload.recommendedBy,
      workLocationId,
      profileImageBase64: payload.profileImageBase64,
      profileImageMimeType: payload.profileImageMimeType,
      profileImageFileName: payload.profileImageFileName,
      resumeFileBase64: payload.resumeFileBase64,
      resumeFileMimeType: payload.resumeFileMimeType,
      resumeFileName: payload.resumeFileName,
      aadhaarImageBase64: payload.aadhaarImageBase64,
      aadhaarImageMimeType: payload.aadhaarImageMimeType,
      aadhaarImageFileName: payload.aadhaarImageFileName,
      phone: primaryPhone,
      active: payload.active,
      phoneNumbers: {
        deleteMany: {},
        create: buildOperatorPhoneNumberCreateRows(payload.phoneNumbers),
      },
      documents: {
        deleteMany: {},
        create: buildOperatorDocumentCreateRows(payload.documents),
      },
    },
    include: OPERATOR_RELATION_INCLUDE,
  });
}

router.post("/settings-auth", async (req, res) => {
  const password = String(req.body?.password || "");
  const result = verifySettingsPassword(password);

  if (!result.verified) {
    return res.status(401).json({ success: false, message: "Invalid settings password" });
  }

  return res.json({
    success: true,
    data: {
      verified: true,
      source: result.source,
    },
  });
});

router.get("/central/auth/status", async (req, res) => {
  const status = await getAccessAuthStatus(
    getCentralSessionToken(req),
    getCentralDeviceId(req),
    getCentralRequestMeta(req)
  );
  return res.json({ success: true, data: status });
});

router.post("/central/auth/bootstrap", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const user = await bootstrapOwner(email);
    const result = await requestLoginOtp(user.email, getCentralRequestMeta(req));
    return res.json({
      success: true,
      data: {
        email: result.email,
        expiresAt: result.expiresAt,
        sessionDays: SESSION_TTL_DAYS,
        otpTtlMinutes: OTP_TTL_MINUTES,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to configure owner access";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/request-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const result = await requestLoginOtp(email, getCentralRequestMeta(req));
    return res.json({
      success: true,
      data: {
        email: result.email,
        expiresAt: result.expiresAt,
        sessionDays: SESSION_TTL_DAYS,
        otpTtlMinutes: OTP_TTL_MINUTES,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send OTP";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const result = await verifyLoginOtp(email, otp, getCentralRequestMeta(req));
    setCentralSessionCookie(res, req, result.token);
    return res.json({
      success: true,
      data: {
        expiresAt: result.expiresAt,
        user: result.user,
        sessionDays: SESSION_TTL_DAYS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify OTP";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/logout", requireCentralSessionAccess, async (req, res) => {
  await revokeSession(getCentralSessionToken(req), getCentralRequestMeta(req));
  clearCentralSessionCookie(res, req);
  return res.json({ success: true, message: "Logged out" });
});

router.get("/central/auth/me", requireCentralSessionAccess, async (req, res) => {
  return res.json({
    success: true,
    data: {
      user: req.centralAccessUser,
      session: req.centralAccessSession,
      sessionDays: SESSION_TTL_DAYS,
      masterUnlockMinutes: MASTER_UNLOCK_TTL_MINUTES,
    },
  });
});

router.get("/central/auth/security", requireCentralOwnerOrAdminAccess, async (req, res) => {
  const [userCount, activeSessionCount, deviceCount, masterDeviceCount] = await Promise.all([
    centralPrisma.accessUser.count(),
    centralPrisma.accessSession.count({
      where: {
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    }),
    centralPrisma.accessDevice.count(),
    centralPrisma.accessDevice.count({
      where: {
        active: true,
        canAccessMasterData: true,
      },
    }),
  ]);

  return res.json({
    success: true,
    data: {
      ownerEmail: req.centralAccessUser?.email || null,
      sessionDays: SESSION_TTL_DAYS,
      otpTtlMinutes: OTP_TTL_MINUTES,
      masterUnlockMinutes: MASTER_UNLOCK_TTL_MINUTES,
      userCount,
      activeSessionCount,
      deviceCount,
      masterDeviceCount,
    },
  });
});

router.put("/central/auth/security/owner-email", requireCentralSessionAccess, requireCentralOwner, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const updated = await updateOwnerEmail(req.centralAccessUser.id, email, req.centralAccessUser);
    return res.json({
      success: true,
      data: {
        ownerEmail: updated.email,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update owner email";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/security/revoke-all", requireCentralOwnerOrAdminAccess, async (req, res) => {
  const result = await revokeAllCentralSessions(req.centralAccessUser || { email: "central-admin" });
  if (req.centralAccessSession) {
    clearCentralSessionCookie(res, req);
  }
  return res.json({
    success: true,
    data: {
      ...result,
      message: "All central sessions were revoked. Everyone must login again.",
    },
  });
});

router.get("/central/auth/devices", requireCentralOwnerOrAdminAccess, async (req, res) => {
  const rows = await listCentralDevices();
  return res.json({ success: true, rows });
});

router.patch("/central/auth/devices/:id", requireCentralOwnerOrAdminAccess, async (req, res) => {
  try {
    const row = await updateCentralDeviceAccess(
      req.params.id,
      req.body || {},
      req.centralAccessUser?.email || "central-admin"
    );
    return res.json({ success: true, data: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update device";
    return res.status(400).json({ success: false, message });
  }
});

router.get("/central/auth/sessions", requireCentralOwnerOrAdminAccess, async (req, res) => {
  const rows = await listActiveCentralSessions();
  return res.json({ success: true, rows });
});

router.post("/central/auth/sessions/:id/revoke", requireCentralOwnerOrAdminAccess, async (req, res) => {
  try {
    const result = await revokeCentralSessionById(req.params.id, {
      id: req.centralAccessUser?.id || null,
      email: req.centralAccessUser?.email || "central-admin",
      deviceId: getCentralDeviceId(req),
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to revoke session";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/devices/:id/logout", requireCentralOwnerOrAdminAccess, async (req, res) => {
  try {
    const device = await centralPrisma.accessDevice.findUnique({
      where: { id: Number(req.params.id) || 0 },
    });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }
    const result = await revokeCentralSessionsByDevice(device.deviceId, {
      id: req.centralAccessUser?.id || null,
      email: req.centralAccessUser?.email || "central-admin",
      deviceId: getCentralDeviceId(req),
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to logout device";
    return res.status(400).json({ success: false, message });
  }
});

router.get("/central/auth/master-status", requireCentralSessionAccess, async (req, res) => {
  const status = await getMasterAccessStatus(
    req.centralAccessUser,
    req.centralAccessSession,
    getCentralDeviceId(req)
  );
  return res.json({ success: true, data: status });
});

router.post("/central/auth/master/request-otp", requireCentralSessionAccess, async (req, res) => {
  try {
    const result = await requestMasterAccessOtp(
      req.centralAccessUser,
      req.centralAccessSession,
      getCentralRequestMeta(req)
    );
    return res.json({
      success: true,
      data: {
        email: result.email,
        expiresAt: result.expiresAt,
        otpTtlMinutes: OTP_TTL_MINUTES,
        unlockTtlMinutes: MASTER_UNLOCK_TTL_MINUTES,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send master data OTP";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/master/verify-otp", requireCentralSessionAccess, async (req, res) => {
  try {
    const otp = String(req.body?.otp || "").trim();
    if (!otp) {
      return res.status(400).json({ success: false, message: "OTP is required" });
    }
    const result = await verifyMasterAccessOtp(
      req.centralAccessUser,
      req.centralAccessSession,
      otp,
      getCentralRequestMeta(req)
    );
    return res.json({
      success: true,
      data: {
        expiresAt: result.expiresAt,
        unlockTtlMinutes: MASTER_UNLOCK_TTL_MINUTES,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify master data OTP";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/central/auth/master/logout", requireCentralSessionAccess, async (req, res) => {
  await revokeMasterAccess(req.centralAccessSession.id, {
    ...req.centralAccessUser,
    deviceId: getCentralDeviceId(req),
  });
  return res.json({ success: true, message: "Master data access disabled" });
});

router.post("/central/admin-auth", async (req, res) => {
  const password = String(req.body?.password || "");
  const verification = verifyCentralAdminPassword(password);

  if (!verification.verified) {
    return res.status(401).json({ success: false, message: verification.message || "Invalid admin password" });
  }

  const session = issueCentralAdminToken();
  return res.json({
    success: true,
    data: {
      verified: true,
      token: session.token,
      expiresAt: session.expiresAt,
    },
  });
});

router.post("/push/send", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  const dryRun = Boolean(req.body?.dryRun);
  const data = req.body?.data;

  if (!token) {
    return res.status(400).json({ success: false, message: "token is required" });
  }

  if (data !== undefined && (typeof data !== "object" || data === null || Array.isArray(data))) {
    return res.status(400).json({ success: false, message: "data must be an object with key/value pairs" });
  }

  try {
    const result = await sendPushNotification({ token, title, body, data, dryRun });
    return res.json({
      success: true,
      data: {
        token,
        dryRun,
        messageId: result.messageId,
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    const message = error instanceof Error ? error.message : "Failed to send push notification";
    const clientErrorCodes = new Set([
      "messaging/invalid-registration-token",
      "messaging/invalid-argument",
      "messaging/registration-token-not-registered",
      "messaging/invalid-recipient",
    ]);
    const statusCode = code && clientErrorCodes.has(code) ? 400 : 500;
    return res.status(statusCode).json({
      success: false,
      message,
      code,
    });
  }
});

router.post("/push/register-token", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const phoneId = parseOptionalPositiveInt(req.body?.phoneId);
  const shopLocationId = parseOptionalPositiveInt(req.body?.shopLocationId);
  const active = parseOptionalBoolean(req.body?.active, true);

  if (!token) {
    return res.status(400).json({ success: false, message: "token is required" });
  }

  if (phoneId) {
    const phone = await prisma.phone.findUnique({ where: { id: phoneId } });
    if (!phone) {
      return res.status(404).json({ success: false, message: "Phone not found" });
    }
  }

  if (shopLocationId) {
    const location = await prisma.shopLocation.findUnique({ where: { id: shopLocationId } });
    if (!location) {
      return res.status(404).json({ success: false, message: "Shop location not found" });
    }
  }

  const row = await prisma.fcmDeviceToken.upsert({
    where: { token },
    create: {
      token,
      phoneId: phoneId || null,
      shopLocationId: shopLocationId || null,
      active,
      lastSeenAt: new Date(),
    },
    update: {
      phoneId: phoneId || null,
      shopLocationId: shopLocationId || null,
      active,
      lastSeenAt: new Date(),
    },
  });

  return res.json({ success: true, data: row });
});

router.get("/push/tokens", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  const activeOnly = parseOptionalBoolean(req.query.activeOnly, true);
  const connectedOnly = parseOptionalBoolean(req.query.connectedOnly, false);
  const activeDeviceCutoff = getActiveDeviceCutoff();

  const rows = await prisma.fcmDeviceToken.findMany({
    where: {
      ...(shopLocationId ? { shopLocationId } : {}),
      ...(activeOnly ? { active: true } : {}),
      ...(connectedOnly
        ? {
            active: true,
            lastSeenAt: {
              gte: activeDeviceCutoff,
            },
          }
        : {}),
    },
    orderBy: [{ id: "asc" }],
  });
  return res.json({
    success: true,
    count: rows.length,
    connectedOnly,
    activeWindowMs: getActiveDeviceWindowMs(),
    rows,
  });
});

router.post("/push/heartbeat", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const phoneId = parseOptionalPositiveInt(req.body?.phoneId);
  const shopLocationId = parseOptionalPositiveInt(req.body?.shopLocationId);
  const active = parseOptionalBoolean(req.body?.active, true);

  if (!token) {
    return res.status(400).json({ success: false, message: "token is required" });
  }

  const row = await prisma.fcmDeviceToken.findUnique({
    where: { token },
  });

  if (!row) {
    return res.status(404).json({ success: false, message: "Token not registered on this server" });
  }

  const updated = await prisma.fcmDeviceToken.update({
    where: { token },
    data: {
      phoneId: phoneId || row.phoneId || null,
      shopLocationId: shopLocationId || row.shopLocationId || null,
      active,
      lastSeenAt: new Date(),
    },
  });

  return res.json({
    success: true,
    activeWindowMs: getActiveDeviceWindowMs(),
    data: updated,
  });
});

router.get("/low-stock/settings/:shopLocationId", async (req, res) => {
  const shopLocationId = parseId(req.params.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "Invalid shop location id" });
  }

  try {
    const data = await getLocationLowStockSettings(shopLocationId);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load low stock settings";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    return res.status(statusCode).json({ success: false, message });
  }
});

router.get("/high-stock/settings/:shopLocationId", async (req, res) => {
  const shopLocationId = parseId(req.params.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "Invalid shop location id" });
  }

  try {
    const data = await getLocationHighStockSettings(shopLocationId);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load high stock settings";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    return res.status(statusCode).json({ success: false, message });
  }
});

router.put("/low-stock/settings/:shopLocationId", async (req, res) => {
  const shopLocationId = parseId(req.params.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "Invalid shop location id" });
  }

  const location = await prisma.shopLocation.findUnique({ where: { id: shopLocationId } });
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  try {
    await saveLocationLowStockSettings(shopLocationId, req.body || {});
    const notificationsEnabled = parseOptionalBoolean(
      req.body?.notificationsEnabled,
      location.lowStockNotificationsEnabled
    );

    const updatedLocation = await prisma.shopLocation.update({
      where: { id: shopLocationId },
      data: {
        lowStockNotificationsEnabled: notificationsEnabled,
      },
    });
    const latestSettings = await getLocationLowStockSettings(shopLocationId);

    return res.json({
      success: true,
      data: {
        ...latestSettings,
        notificationsEnabled: updatedLocation.lowStockNotificationsEnabled,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save low stock settings";
    return res.status(400).json({ success: false, message });
  }
});

router.put("/high-stock/settings/:shopLocationId", async (req, res) => {
  const shopLocationId = parseId(req.params.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "Invalid shop location id" });
  }

  const location = await prisma.shopLocation.findUnique({ where: { id: shopLocationId } });
  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  try {
    await saveLocationHighStockSettings(shopLocationId, req.body || {});
    const data = await getLocationHighStockSettings(shopLocationId);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save high stock settings";
    return res.status(400).json({ success: false, message });
  }
});

router.get("/low-stock/products", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const snapshot = await evaluateLowStock({
    shopLocationIds: [shopLocationId],
    onlyEnabledLocations: false,
    includeTokens: false,
  });
  const location = snapshot.locations[0];

  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  return res.json({
    success: true,
    generatedAt: snapshot.generatedAt,
    data: {
      shopLocationId: location.shopLocationId,
      locationName: location.locationName,
      locationCode: location.locationCode,
      sourceLocationId: location.sourceLocationId,
      sourceLocationCode: location.sourceLocationCode,
      sourceLocationName: location.sourceLocationName,
      notificationsEnabled: location.notificationsEnabled,
      generalThresholdBottles: location.generalThresholdBottles,
      lowCount: location.lowCount,
      rows: location.lowRows,
    },
  });
});

router.get("/high-stock/products", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const snapshot = await evaluateHighStock({
    shopLocationIds: [shopLocationId],
  });
  const location = snapshot.locations[0];

  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  return res.json({
    success: true,
    generatedAt: snapshot.generatedAt,
    data: {
      shopLocationId: location.shopLocationId,
      locationName: location.locationName,
      locationCode: location.locationCode,
      generalThresholdBottles: location.generalThresholdBottles,
      highCount: location.highCount,
      rows: location.highRows,
    },
  });
});

router.get("/nil-stock/settings/:shopLocationId", async (req, res) => {
  const shopLocationId = parseId(req.params.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "Invalid shop location id" });
  }

  try {
    const data = await getLocationNilStockSettings(shopLocationId);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load nil stock settings";
    const statusCode = message.toLowerCase().includes("not found") ? 404 : 500;
    return res.status(statusCode).json({ success: false, message });
  }
});

router.put("/nil-stock/settings/:shopLocationId", async (req, res) => {
  const shopLocationId = parseId(req.params.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "Invalid shop location id" });
  }

  try {
    const data = await saveLocationNilStockSettings(shopLocationId, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save nil stock settings";
    return res.status(400).json({ success: false, message });
  }
});

router.get("/nil-stock/products", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  if (!shopLocationId) {
    return res.status(400).json({ success: false, message: "shopLocationId is required" });
  }

  const snapshot = await evaluateNilStock({
    shopLocationIds: [shopLocationId],
    onlyEnabledLocations: false,
    includeTokens: false,
  });
  const location = snapshot.locations[0];

  if (!location) {
    return res.status(404).json({ success: false, message: "Shop location not found" });
  }

  return res.json({
    success: true,
    generatedAt: snapshot.generatedAt,
    data: {
      shopLocationId: location.shopLocationId,
      locationName: location.locationName,
      locationCode: location.locationCode,
      sourceLocationId: location.sourceLocationId,
      sourceLocationCode: location.sourceLocationCode,
      sourceLocationName: location.sourceLocationName,
      notificationsEnabled: location.notificationsEnabled,
      nilCount: location.nilCount,
      rows: location.nilRows,
    },
  });
});

router.get("/low-stock/overview", async (req, res) => {
  const snapshot = await evaluateLowStock({
    onlyEnabledLocations: false,
    includeTokens: false,
  });

  return res.json({
    success: true,
    generatedAt: snapshot.generatedAt,
    enabledLocationCount: snapshot.locationCount,
    locationsWithLowStock: snapshot.locationsWithLowStock,
    totalLowProducts: snapshot.totalLowProducts,
    rows: snapshot.locations.map((row) => ({
      shopLocationId: row.shopLocationId,
      locationCode: row.locationCode,
      locationName: row.locationName,
      generalThresholdBottles: row.generalThresholdBottles,
      lowCount: row.lowCount,
    })),
  });
});

router.get("/high-stock/overview", async (req, res) => {
  const snapshot = await evaluateHighStock();

  return res.json({
    success: true,
    generatedAt: snapshot.generatedAt,
    enabledLocationCount: snapshot.locationCount,
    locationsWithHighStock: snapshot.locationsWithHighStock,
    totalHighProducts: snapshot.totalHighProducts,
    rows: snapshot.locations.map((row) => ({
      shopLocationId: row.shopLocationId,
      locationCode: row.locationCode,
      locationName: row.locationName,
      generalThresholdBottles: row.generalThresholdBottles,
      highCount: row.highCount,
    })),
  });
});

router.post("/low-stock/check-now", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.body?.shopLocationId);
  const dryRun = parseOptionalBoolean(req.body?.dryRun, false);
  const forceResend = parseOptionalBoolean(req.body?.forceResend, false);

  const result = await runLowStockCheckAndNotify({
    shopLocationIds: shopLocationId ? [shopLocationId] : null,
    dryRun,
    trigger: "manual_api",
    enforceCsvVersionOnce: !forceResend,
  });

  return res.json(result);
});

router.post("/nil-stock/check-now", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.body?.shopLocationId);
  const dryRun = parseOptionalBoolean(req.body?.dryRun, false);
  const enforceState = parseOptionalBoolean(req.body?.enforceState, true);

  const result = await runNilStockCheckAndNotify({
    shopLocationIds: shopLocationId ? [shopLocationId] : null,
    trigger: dryRun ? "manual_dry_run" : "manual",
    dryRun,
    enforceState,
  });

  return res.json(result);
});

router.get("/low-stock/notifications", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  const statusFilter = String(req.query.status || "").trim().toLowerCase();
  const validStatuses = new Set(["pending", "sent", "failed", "skipped"]);
  const dateFromRaw = String(req.query.dateFrom || "").trim();
  const dateToRaw = String(req.query.dateTo || "").trim();
  const dateFrom = dateFromRaw ? parseDateBoundary(dateFromRaw, false) : null;
  const dateTo = dateToRaw ? parseDateBoundary(dateToRaw, true) : null;

  if (dateFromRaw && !dateFrom) {
    return res.status(400).json({ success: false, message: "Invalid dateFrom" });
  }
  if (dateToRaw && !dateTo) {
    return res.status(400).json({ success: false, message: "Invalid dateTo" });
  }
  if (dateFrom && dateTo && dateTo.getTime() < dateFrom.getTime()) {
    return res.status(400).json({
      success: false,
      message: "dateTo must be greater than or equal to dateFrom",
    });
  }
  if (statusFilter && statusFilter !== "all" && !validStatuses.has(statusFilter)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Use all, pending, sent, failed, or skipped",
    });
  }

  const where = {
    ...(shopLocationId ? { shopLocationId } : {}),
    ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
  };

  const rowsFromDb = await prisma.lowStockNotificationRun.findMany({
    where,
    include: {
      shopLocation: {
        select: {
          id: true,
          locationCode: true,
          locationName: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });

  const rows = rowsFromDb.map((row) => ({
    id: row.id,
    shopLocationId: row.shopLocationId,
    locationCode: row.shopLocation?.locationCode || "",
    locationName: row.shopLocation?.locationName || "",
    csvVersion: row.csvVersion,
    trigger: row.trigger || "",
    status: row.status,
    lowCount: Number(row.lowCount || 0),
    tokenCount: Number(row.tokenCount || 0),
    successCount: Number(row.successCount || 0),
    failureCount: Number(row.failureCount || 0),
    reason: row.reason || "",
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    notificationTime: (row.sentAt || row.createdAt || null)
      ? (row.sentAt || row.createdAt).toISOString()
      : null,
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.totalLowCount += Number(row.lowCount || 0);
      acc.totalSuccessCount += Number(row.successCount || 0);
      acc.totalFailureCount += Number(row.failureCount || 0);
      if (row.status === "sent") acc.sent += 1;
      if (row.status === "failed") acc.failed += 1;
      if (row.status === "skipped") acc.skipped += 1;
      if (row.status === "pending") acc.pending += 1;
      return acc;
    },
    {
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      totalLowCount: 0,
      totalSuccessCount: 0,
      totalFailureCount: 0,
    }
  );

  return res.json({
    success: true,
    filters: {
      shopLocationId: shopLocationId || null,
      status: statusFilter || "all",
      dateFrom: dateFromRaw || "",
      dateTo: dateToRaw || "",
    },
    summary,
    count: rows.length,
    rows,
  });
});

router.get("/nil-stock/notifications", async (req, res) => {
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  const status = String(req.query.status || "").trim().toLowerCase();
  const dateFrom = parseDateBoundary(req.query.dateFrom);
  const dateTo = parseDateBoundary(req.query.dateTo, true);

  const where = {
    ...(shopLocationId ? { shopLocationId } : {}),
    ...(status ? { status } : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
  };

  const rowsFromDb = await prisma.nilStockNotificationRun.findMany({
    where,
    include: {
      shopLocation: {
        select: {
          locationCode: true,
          locationName: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });

  const summary = rowsFromDb.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.totalNilCount += Number(row.nilCount || 0);
      acc.totalSuccessCount += Number(row.successCount || 0);
      acc.totalFailureCount += Number(row.failureCount || 0);
      if (row.status === "sent") acc.sent += 1;
      else if (row.status === "failed") acc.failed += 1;
      else if (row.status === "skipped") acc.skipped += 1;
      else acc.pending += 1;
      return acc;
    },
    {
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      totalNilCount: 0,
      totalSuccessCount: 0,
      totalFailureCount: 0,
    }
  );

  const rows = rowsFromDb.map((row) => ({
    id: row.id,
    shopLocationId: row.shopLocationId,
    locationCode: row.shopLocation?.locationCode || "",
    locationName: row.shopLocation?.locationName || "",
    csvVersion: row.csvVersion,
    trigger: row.trigger || "",
    status: row.status,
    nilCount: row.nilCount,
    tokenCount: row.tokenCount,
    successCount: row.successCount,
    failureCount: row.failureCount,
    reason: row.reason || "",
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    notificationTime: (row.sentAt || row.createdAt || null)
      ? (row.sentAt || row.createdAt).toISOString()
      : null,
  }));

  return res.json({
    success: true,
    filters: {
      shopLocationId: shopLocationId || null,
      status,
      dateFrom: dateFrom ? dateFrom.toISOString() : "",
      dateTo: dateTo ? dateTo.toISOString() : "",
    },
    summary,
    count: rows.length,
    rows,
  });
});

router.get("/setup", async (req, res) => {
  const [shop, locations, workers, phones, bestSelling, printers] = await Promise.all([
    prisma.shopInfo.findUnique({ where: { id: 1 } }),
    prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.worker.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.phone.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.bestSellingProduct.findMany({ orderBy: { id: "asc" } }),
    prisma.printer.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  return res.json({
    success: true,
    data: { shop, locations, workers, phones, bestSelling, printers },
  });
});

router.get("/central-sync", async (req, res) => {
  return res.json({
    success: true,
    data: getCentralSyncState(),
  });
});

router.post("/central-sync/run", async (req, res) => {
  try {
    const result = await syncCentralCatalog("manual_api");
    const [operatorPush, bestSellerPush, designationPush, workLocationPush] = await Promise.all([
      pushCentralCatalogToShops("operators", { trigger: "manual_api" }),
      pushCentralCatalogToShops("bestSellers", { trigger: "manual_api" }),
      pushCentralCatalogToShops("designations", { trigger: "manual_api" }),
      pushCentralCatalogToShops("workLocations", { trigger: "manual_api" }),
    ]);
    return res.json({
      ...result,
      reverseSync: {
        operators: operatorPush,
        bestSellers: bestSellerPush,
        designations: designationPush,
        workLocations: workLocationPush,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Central sync failed",
      data: getCentralSyncState(),
    });
  }
});

router.get("/sync-settings", async (req, res) => {
  const data = await getCatalogSyncSettings();
  return res.json({ success: true, data });
});

router.put("/sync-settings", async (req, res) => {
  const rawCentralBaseUrl = req.body?.centralBaseUrl;
  if (
    rawCentralBaseUrl !== undefined &&
    rawCentralBaseUrl !== null &&
    String(rawCentralBaseUrl).trim() !== "" &&
    !normalizeHttpUrl(rawCentralBaseUrl)
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid http/https centralBaseUrl is required",
    });
  }

  const data = await saveCatalogSyncSettings(req.body || {});
  return res.json({ success: true, data });
});

router.get("/central/reverse-sync-settings", async (req, res) => {
  const data = await getCentralReverseSyncSettings();
  return res.json({ success: true, data });
});

router.put("/central/reverse-sync-settings", async (req, res) => {
  const data = await saveCentralReverseSyncSettings(req.body || {});
  return res.json({ success: true, data });
});

router.post("/central-sync/apply", async (req, res) => {
  const settings = await getCatalogSyncSettings();
  const hasOperators = Array.isArray(req.body?.operators);
  const hasBestSellers = Array.isArray(req.body?.bestSellers);
  const hasDesignations = Array.isArray(req.body?.designations);
  const hasWorkLocations = Array.isArray(req.body?.workLocations);
  const applyOperators = hasOperators && settings.syncOperatorsWithCentral;
  const applyBestSellers = hasBestSellers && settings.syncBestSellingWithCentral;
  const applyDesignations = hasDesignations && settings.syncOperatorsWithCentral;
  const applyWorkLocations = hasWorkLocations && settings.syncOperatorsWithCentral;

  if (!applyOperators && !applyBestSellers && !applyDesignations && !applyWorkLocations) {
    return res.json({
      success: true,
      skipped: true,
      message: "Central sync disabled for requested resources on this shop",
      settings,
    });
  }

  const summary = await syncCatalogToLocal(
    {
      operators: hasOperators ? req.body.operators : [],
      bestSellers: hasBestSellers ? req.body.bestSellers : [],
      designations: hasDesignations ? req.body.designations : [],
      workLocations: hasWorkLocations ? req.body.workLocations : [],
    },
    {
      syncOperators: applyOperators,
      syncBestSellers: applyBestSellers,
      syncDesignations: applyDesignations,
      syncWorkLocations: applyWorkLocations,
    }
  );

  return res.json({
    success: true,
    skipped: false,
    settings,
    summary,
  });
});

router.get("/central/catalog", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const [data, shops] = await Promise.all([
    readCentralCatalog({ includeInactive }),
    centralPrisma.shopEndpoint.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: [{ shopName: "asc" }, { id: "asc" }],
    }),
  ]);
  return res.json({
    success: true,
    data: {
      ...data,
      shops,
      sync: getCentralSyncState(),
    },
  });
});

router.get("/central/shops", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await centralPrisma.shopEndpoint.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ shopName: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/central/shops", async (req, res) => {
  const shopName = String(req.body?.shopName || "").trim();
  const baseUrl = normalizeHttpUrl(req.body?.baseUrl);
  const active = req.body?.active === undefined ? true : Boolean(req.body.active);

  if (!shopName) {
    return res.status(400).json({ success: false, message: "shopName is required" });
  }
  if (!baseUrl) {
    return res.status(400).json({ success: false, message: "Valid http/https baseUrl is required" });
  }

  const [existingName, existingUrl] = await Promise.all([
    centralPrisma.shopEndpoint.findUnique({ where: { shopName } }),
    centralPrisma.shopEndpoint.findUnique({ where: { baseUrl } }),
  ]);
  if (existingName) {
    return res.status(409).json({ success: false, message: "Shop name already exists" });
  }
  if (existingUrl) {
    return res.status(409).json({ success: false, message: "Shop URL already exists" });
  }

  const row = await centralPrisma.shopEndpoint.create({
    data: { shopName, baseUrl, active },
  });
  return res.json({ success: true, data: row });
});

router.put("/central/shops/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid shop id" });
  }

  const existing = await centralPrisma.shopEndpoint.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Shop not found" });
  }

  const shopName = String(req.body?.shopName || existing.shopName).trim();
  const baseUrl = normalizeHttpUrl(req.body?.baseUrl ?? existing.baseUrl);
  const active = req.body?.active === undefined ? existing.active : Boolean(req.body.active);

  if (!shopName) {
    return res.status(400).json({ success: false, message: "shopName is required" });
  }
  if (!baseUrl) {
    return res.status(400).json({ success: false, message: "Valid http/https baseUrl is required" });
  }

  const [duplicateName, duplicateUrl] = await Promise.all([
    centralPrisma.shopEndpoint.findUnique({ where: { shopName } }),
    centralPrisma.shopEndpoint.findUnique({ where: { baseUrl } }),
  ]);
  if (duplicateName && duplicateName.id !== id) {
    return res.status(409).json({ success: false, message: "Shop name already exists" });
  }
  if (duplicateUrl && duplicateUrl.id !== id) {
    return res.status(409).json({ success: false, message: "Shop URL already exists" });
  }

  const row = await centralPrisma.shopEndpoint.update({
    where: { id },
    data: { shopName, baseUrl, active },
  });
  return res.json({ success: true, data: row });
});

router.delete("/central/shops/:id", requireCentralAdminAccess, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid shop id" });
  }

  try {
    await centralPrisma.shopEndpoint.delete({ where: { id } });
    return res.json({ success: true, message: "Shop deleted" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete shop" });
  }
});

router.get("/central/designations", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await centralPrisma.operatorDesignation.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/central/designations", async (req, res) => {
  const payload = mapLookupPayload(req.body || {});
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const existing = await centralPrisma.operatorDesignation.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Designation already exists" });
  }

  const row = await centralPrisma.operatorDesignation.create({ data: payload });
  const sync = await syncCentralCatalog("central_designation_create");
  const reverseSync = await pushCentralCatalogToShops("designations", {
    trigger: "central_designation_create",
  });
  return res.json({ success: true, data: row, sync: sync.summary, reverseSync });
});

router.put("/central/designations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid designation id" });
  }

  const existing = await centralPrisma.operatorDesignation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Designation not found" });
  }

  const payload = mapLookupPayload(req.body || {}, existing);
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const duplicate = await centralPrisma.operatorDesignation.findUnique({ where: { name: payload.name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Designation already exists" });
  }

  const row = await centralPrisma.operatorDesignation.update({ where: { id }, data: payload });
  const sync = await syncCentralCatalog("central_designation_update");
  const reverseSync = await pushCentralCatalogToShops("designations", {
    trigger: "central_designation_update",
  });
  return res.json({ success: true, data: row, sync: sync.summary, reverseSync });
});

router.delete("/central/designations/:id", requireCentralAdminAccess, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid designation id" });
  }

  try {
    await centralPrisma.operatorDesignation.delete({ where: { id } });
    const sync = await syncCentralCatalog("central_designation_delete");
    const reverseSync = await pushCentralCatalogToShops("designations", {
      trigger: "central_designation_delete",
    });
    return res.json({
      success: true,
      message: "Designation deleted",
      sync: sync.summary,
      reverseSync,
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete designation" });
  }
});

router.get("/central/work-locations", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await centralPrisma.operatorWorkLocation.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/central/work-locations", async (req, res) => {
  const payload = mapLookupPayload(req.body || {});
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const existing = await centralPrisma.operatorWorkLocation.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Work location already exists" });
  }

  const row = await centralPrisma.operatorWorkLocation.create({ data: payload });
  const sync = await syncCentralCatalog("central_work_location_create");
  const reverseSync = await pushCentralCatalogToShops("workLocations", {
    trigger: "central_work_location_create",
  });
  return res.json({ success: true, data: row, sync: sync.summary, reverseSync });
});

router.put("/central/work-locations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid work location id" });
  }

  const existing = await centralPrisma.operatorWorkLocation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Work location not found" });
  }

  const payload = mapLookupPayload(req.body || {}, existing);
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const duplicate = await centralPrisma.operatorWorkLocation.findUnique({ where: { name: payload.name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Work location already exists" });
  }

  const row = await centralPrisma.operatorWorkLocation.update({ where: { id }, data: payload });
  const sync = await syncCentralCatalog("central_work_location_update");
  const reverseSync = await pushCentralCatalogToShops("workLocations", {
    trigger: "central_work_location_update",
  });
  return res.json({ success: true, data: row, sync: sync.summary, reverseSync });
});

router.delete("/central/work-locations/:id", requireCentralAdminAccess, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid work location id" });
  }

  try {
    await centralPrisma.operatorWorkLocation.delete({ where: { id } });
    const sync = await syncCentralCatalog("central_work_location_delete");
    const reverseSync = await pushCentralCatalogToShops("workLocations", {
      trigger: "central_work_location_delete",
    });
    return res.json({
      success: true,
      message: "Work location deleted",
      sync: sync.summary,
      reverseSync,
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Work location not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete work location" });
  }
});

router.get("/central/master-products", requireCentralMasterAccess, async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const limit = Number(req.query.limit || 10000);
    const data = await readAggregatedCentralMasterProducts({ query, limit });
    return res.json({
      success: true,
      count: data.rows.length,
      rows: data.rows,
      sourceCount: data.sourceCount,
      successCount: data.successCount,
      failureCount: data.failureCount,
      failures: data.failures,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to load central master products",
    });
  }
});

router.get("/central/master-products/by-shop", requireCentralMasterAccess, async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const limit = Number(req.query.limit || 10000);
    const { activeEndpoints, remoteResponses } = await fetchCentralMasterProductsByShop({
      query,
      limit,
    });
    const rows = flattenCentralMasterProductsByShop(remoteResponses);
    const shops = summarizeCentralMasterProductShops(remoteResponses);

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      count: rows.length,
      uniqueItemCodeCount: new Set(rows.map((row) => toLowerTrimmed(row.itemCode)).filter(Boolean)).size,
      sourceCount: activeEndpoints.length,
      successCount: remoteResponses.filter((row) => row.success).length,
      failureCount: remoteResponses.filter((row) => !row.success).length,
      shops,
      rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load central master products by shop",
    });
  }
});

router.get("/central/dashboard", async (req, res) => {
  const cycleId = parseOptionalPositiveInt(req.query.cycleId);
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  const endpoints = await centralPrisma.shopEndpoint.findMany({
    where: { active: true },
    orderBy: [{ shopName: "asc" }, { id: "asc" }],
  });

  const shops = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const overviewUrl = buildRemoteApiUrl(endpoint.baseUrl, "/api/stock/overview", {
          cycleId,
          shopLocationId,
        });
        const overview = await fetchJsonWithTimeout(overviewUrl);
        return summarizeRemoteOverviewForDashboard(endpoint, overview);
      } catch (error) {
        return createOfflineDashboardShop(endpoint, error);
      }
    })
  );

  return res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    summary: aggregateDashboardShops(shops),
    shops,
  });
});

router.get("/central/dashboard/shops/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const cycleId = parseOptionalPositiveInt(req.query.cycleId);
  const shopLocationId = parseOptionalPositiveInt(req.query.shopLocationId);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid shop id" });
  }

  const endpoint = await centralPrisma.shopEndpoint.findUnique({ where: { id } });
  if (!endpoint) {
    return res.status(404).json({ success: false, message: "Shop not found" });
  }

  try {
    const [overview, operatorOverview, activityLogs] = await Promise.all([
      fetchJsonWithTimeout(
        buildRemoteApiUrl(endpoint.baseUrl, "/api/stock/overview", { cycleId, shopLocationId })
      ),
      fetchJsonWithTimeout(
        buildRemoteApiUrl(endpoint.baseUrl, "/api/stock/overview/operators", {
          cycleId,
          shopLocationId,
        })
      ),
      fetchJsonWithTimeout(
        buildRemoteApiUrl(endpoint.baseUrl, "/api/stock/overview/activity-logs", {
          cycleId,
          shopLocationId,
        })
      ),
    ]);

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      shop: {
        id: endpoint.id,
        registryName: endpoint.shopName,
        shopName: String(overview?.shopName || endpoint.shopName || "").trim() || endpoint.shopName,
        baseUrl: endpoint.baseUrl,
        active: endpoint.active,
      },
      status: "online",
      overview,
      operatorOverview,
      activityLogs,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      generatedAt: new Date().toISOString(),
      shop: {
        id: endpoint.id,
        registryName: endpoint.shopName,
        shopName: endpoint.shopName,
        baseUrl: endpoint.baseUrl,
        active: endpoint.active,
      },
      status: "offline",
      message: error instanceof Error ? error.message : "Unable to reach remote shop",
    });
  }
});

router.get("/central/workers", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await centralPrisma.operator.findMany({
    where: includeInactive ? undefined : { active: true },
    include: OPERATOR_RELATION_INCLUDE,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows: rows.map(mapOperatorRecord) });
});

router.post("/central/workers", async (req, res) => {
  const payload = parseOperatorPayload(req.body || {}, { defaultActive: true });
  const validationError = validateOperatorPayload(payload);

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const existing = await centralPrisma.operator.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Operator name already exists" });
  }

  const row = await createOperatorRow(
    centralPrisma,
    {
      personDelegate: "operator",
      designationDelegate: "operatorDesignation",
      workLocationDelegate: "operatorWorkLocation",
    },
    payload
  );
  const sync = await syncCentralCatalog("central_worker_create");
  const reverseSync = await pushCentralCatalogToShops("operators", {
    trigger: "central_worker_create",
  });
  return res.json({ success: true, data: mapOperatorRecord(row), sync: sync.summary, reverseSync });
});

router.put("/central/workers/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid operator id" });
  }

  const payload = parseOperatorPayload(req.body || {}, { defaultActive: true });
  const validationError = validateOperatorPayload(payload);

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const existing = await centralPrisma.operator.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Operator not found" });
  }

  const duplicate = await centralPrisma.operator.findUnique({ where: { name: payload.name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Operator name already exists" });
  }

  const row = await updateOperatorRow(
    centralPrisma,
    {
      personDelegate: "operator",
      designationDelegate: "operatorDesignation",
      workLocationDelegate: "operatorWorkLocation",
    },
    id,
    payload
  );
  const sync = await syncCentralCatalog("central_worker_update");
  const reverseSync = await pushCentralCatalogToShops("operators", {
    trigger: "central_worker_update",
  });
  return res.json({ success: true, data: mapOperatorRecord(row), sync: sync.summary, reverseSync });
});

router.delete("/central/workers/:id", requireCentralAdminAccess, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid operator id" });
  }

  try {
    const existing = await centralPrisma.operator.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Operator not found" });
    }

    const row = await centralPrisma.operator.update({
      where: { id },
      data: { active: false },
      include: OPERATOR_RELATION_INCLUDE,
    });
    const sync = await syncCentralCatalog("central_worker_deactivate");
    const reverseSync = await pushCentralCatalogToShops("operators", {
      trigger: "central_worker_deactivate",
    });
    return res.json({
      success: true,
      message: "Operator deactivated",
      data: mapOperatorRecord(row),
      sync: sync.summary,
      reverseSync,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to deactivate operator" });
  }
});

router.get("/central/best-selling", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await centralPrisma.bestSeller.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ itemCode: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/central/best-selling", async (req, res) => {
  const itemCode = String(req.body?.itemCode || "").trim();
  if (!itemCode) {
    return res.status(400).json({ success: false, message: "itemCode is required" });
  }

  const existing = await centralPrisma.bestSeller.findUnique({ where: { itemCode } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Item already in best selling" });
  }

  const master = await getMasterProductByCode(itemCode);
  const row = await centralPrisma.bestSeller.create({
    data: {
      itemCode,
      itemName: toNullableText(req.body?.itemName) || master?.itemName || null,
      brandName: toNullableText(req.body?.brandName) || master?.brandName || null,
      packValue: toNullableText(req.body?.packValue) || master?.packValue || null,
      active: req.body?.active === undefined ? true : Boolean(req.body.active),
    },
  });
  const sync = await syncCentralCatalog("central_best_seller_create");
  const reverseSync = await pushCentralCatalogToShops("bestSellers", {
    trigger: "central_best_seller_create",
  });
  return res.json({ success: true, data: row, sync: sync.summary, reverseSync });
});

router.put("/central/best-selling/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid best selling id" });
  }

  const existing = await centralPrisma.bestSeller.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Best selling item not found" });
  }

  const itemCode = String(req.body?.itemCode || existing.itemCode).trim();
  const duplicate = await centralPrisma.bestSeller.findUnique({ where: { itemCode } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Item code already exists in best selling" });
  }

  const master = await getMasterProductByCode(itemCode);
  const row = await centralPrisma.bestSeller.update({
    where: { id },
    data: {
      itemCode,
      itemName: toNullableText(req.body?.itemName) || master?.itemName || existing.itemName,
      brandName: toNullableText(req.body?.brandName) || master?.brandName || existing.brandName,
      packValue: toNullableText(req.body?.packValue) || master?.packValue || existing.packValue,
      active: req.body?.active === undefined ? existing.active : Boolean(req.body.active),
    },
  });
  const sync = await syncCentralCatalog("central_best_seller_update");
  const reverseSync = await pushCentralCatalogToShops("bestSellers", {
    trigger: "central_best_seller_update",
  });
  return res.json({ success: true, data: row, sync: sync.summary, reverseSync });
});

router.delete("/central/best-selling/:id", requireCentralAdminAccess, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid best selling id" });
  }

  try {
    await centralPrisma.bestSeller.delete({ where: { id } });
    const sync = await syncCentralCatalog("central_best_seller_delete");
    const reverseSync = await pushCentralCatalogToShops("bestSellers", {
      trigger: "central_best_seller_delete",
    });
    return res.json({
      success: true,
      message: "Best selling item deleted",
      sync: sync.summary,
      reverseSync,
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Best selling item not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete best selling item" });
  }
});

router.get("/shop", async (req, res) => {
  const info = await prisma.shopInfo.findUnique({ where: { id: 1 } });
  return res.json({ success: true, data: info });
});

router.post("/shop", async (req, res) => {
  const payload = mapShopPayload(req.body || {});
  if (!payload.shopCode || !payload.shopName) {
    return res.status(400).json({ success: false, message: "shopCode and shopName are required" });
  }

  const row = await prisma.shopInfo.upsert({
    where: { id: 1 },
    create: { id: 1, ...payload },
    update: payload,
  });

  return res.json({ success: true, data: row });
});

router.put("/shop", async (req, res) => {
  const payload = mapShopPayload(req.body || {});
  if (!payload.shopCode || !payload.shopName) {
    return res.status(400).json({ success: false, message: "shopCode and shopName are required" });
  }

  const existing = await prisma.shopInfo.findUnique({ where: { id: 1 } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Shop info not found" });
  }

  const row = await prisma.shopInfo.update({ where: { id: 1 }, data: payload });
  return res.json({ success: true, data: row });
});

router.delete("/shop", async (req, res) => {
  await prisma.shopInfo.deleteMany({ where: { id: 1 } });
  return res.json({ success: true, message: "Shop info deleted" });
});

router.get("/shop-locations", async (req, res) => {
  const rows = await prisma.shopLocation.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/shop-locations", async (req, res) => {
  const payload = mapLocationPayload(req.body || {});

  if (!payload.locationCode || !payload.locationName || !normalizeHexColor(req.body?.locationColor)) {
    return res.status(400).json({
      success: false,
      message: "locationCode, locationName and valid locationColor (#RRGGBB) are required",
    });
  }

  const exists = await prisma.shopLocation.findUnique({ where: { locationCode: payload.locationCode } });
  if (exists) {
    return res.status(409).json({ success: false, message: "Location code already exists" });
  }

  const row = await prisma.shopLocation.create({ data: payload });
  return res.json({ success: true, data: row });
});

router.put("/shop-locations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid location id" });
  }

  const payload = mapLocationPayload(req.body || {});
  if (!payload.locationCode || !payload.locationName || !normalizeHexColor(req.body?.locationColor)) {
    return res.status(400).json({
      success: false,
      message: "locationCode, locationName and valid locationColor (#RRGGBB) are required",
    });
  }

  const existing = await prisma.shopLocation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }

  if (req.body?.lowStockNotificationsEnabled === undefined) {
    payload.lowStockNotificationsEnabled = existing.lowStockNotificationsEnabled;
  }

  const duplicateCode = await prisma.shopLocation.findUnique({ where: { locationCode: payload.locationCode } });
  if (duplicateCode && duplicateCode.id !== id) {
    return res.status(409).json({ success: false, message: "Location code already exists" });
  }

  const row = await prisma.shopLocation.update({ where: { id }, data: payload });
  return res.json({ success: true, data: row });
});

router.delete("/shop-locations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid location id" });
  }

  try {
    await prisma.shopLocation.delete({ where: { id } });
    return res.json({ success: true, message: "Location deleted" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Location not found" });
    }
    return res
      .status(409)
      .json({ success: false, message: "Location is linked to records and cannot be deleted" });
  }
});

router.get("/designations", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await prisma.workerDesignation.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/designations", async (req, res) => {
  const payload = mapLookupPayload(req.body || {});
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(settings, "/api/meta/central/designations", "POST", payload);
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync designation with central",
      });
    }
  }

  const existing = await prisma.workerDesignation.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Designation already exists" });
  }
  const row = await prisma.workerDesignation.create({ data: payload });
  return res.json({ success: true, data: row, localOnly: true });
});

router.put("/designations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid designation id" });
  }
  const existing = await prisma.workerDesignation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Designation not found" });
  }

  const payload = mapLookupPayload(req.body || {}, existing);
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        `/api/meta/central/designations/${id}`,
        "PUT",
        payload
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync designation with central",
      });
    }
  }

  const duplicate = await prisma.workerDesignation.findUnique({ where: { name: payload.name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Designation already exists" });
  }
  const row = await prisma.workerDesignation.update({ where: { id }, data: payload });
  return res.json({ success: true, data: row, localOnly: true });
});

router.delete("/designations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid designation id" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(settings, `/api/meta/central/designations/${id}`, "DELETE");
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync designation with central",
      });
    }
  }

  try {
    await prisma.workerDesignation.delete({ where: { id } });
    return res.json({ success: true, message: "Designation deleted", localOnly: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete designation" });
  }
});

router.get("/work-locations", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await prisma.workerWorkLocation.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/work-locations", async (req, res) => {
  const payload = mapLookupPayload(req.body || {});
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        "/api/meta/central/work-locations",
        "POST",
        payload
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync work location with central",
      });
    }
  }

  const existing = await prisma.workerWorkLocation.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Work location already exists" });
  }
  const row = await prisma.workerWorkLocation.create({ data: payload });
  return res.json({ success: true, data: row, localOnly: true });
});

router.put("/work-locations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid work location id" });
  }
  const existing = await prisma.workerWorkLocation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Work location not found" });
  }

  const payload = mapLookupPayload(req.body || {}, existing);
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        `/api/meta/central/work-locations/${id}`,
        "PUT",
        payload
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync work location with central",
      });
    }
  }

  const duplicate = await prisma.workerWorkLocation.findUnique({ where: { name: payload.name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Work location already exists" });
  }
  const row = await prisma.workerWorkLocation.update({ where: { id }, data: payload });
  return res.json({ success: true, data: row, localOnly: true });
});

router.delete("/work-locations/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid work location id" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        `/api/meta/central/work-locations/${id}`,
        "DELETE"
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync work location with central",
      });
    }
  }

  try {
    await prisma.workerWorkLocation.delete({ where: { id } });
    return res.json({ success: true, message: "Work location deleted", localOnly: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Work location not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete work location" });
  }
});

router.get("/workers", async (req, res) => {
  const includeInactive = parseIncludeInactive(req.query.includeInactive);
  const rows = await prisma.worker.findMany({
    where: includeInactive ? undefined : { active: true },
    include: OPERATOR_RELATION_INCLUDE,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows: rows.map(mapOperatorRecord) });
});

router.post("/workers", async (req, res) => {
  const payload = parseOperatorPayload(req.body || {}, { defaultActive: true });
  const validationError = validateOperatorPayload(payload);

  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncOperatorsWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(settings, "/api/meta/central/workers", "POST", {
        ...payload,
      });
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync operator with central",
      });
    }
  }

  const existing = await prisma.worker.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Operator name already exists" });
  }

  const row = await createOperatorRow(
    prisma,
    {
      personDelegate: "worker",
      designationDelegate: "workerDesignation",
      workLocationDelegate: "workerWorkLocation",
    },
    payload
  );
  return res.json({ success: true, data: mapOperatorRecord(row), localOnly: true });
});

router.put("/workers/:id", async (req, res) => {
  return res.status(403).json({
    success: false,
    message: "Editing operators from StockLens is disabled. Use Central to update operators.",
  });
});

router.delete("/workers/:id", async (req, res) => {
  return res.status(403).json({
    success: false,
    message: "Deleting operators from StockLens is disabled. Use Central to delete operators.",
  });
});

router.get("/phones", async (req, res) => {
  const rows = await prisma.phone.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/phones", async (req, res) => {
  const payload = mapPhonePayload(req.body || {});
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const existing = await prisma.phone.findUnique({ where: { name: payload.name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Phone name already exists" });
  }

  const row = await prisma.phone.create({ data: payload });
  return res.json({ success: true, data: row });
});

router.put("/phones/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid phone id" });
  }

  const existing = await prisma.phone.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Phone not found" });
  }

  const payload = mapPhonePayload(req.body || {}, existing);
  if (!payload.name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const duplicate = await prisma.phone.findUnique({ where: { name: payload.name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Phone name already exists" });
  }

  const row = await prisma.phone.update({ where: { id }, data: payload });
  return res.json({ success: true, data: row });
});

router.delete("/phones/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid phone id" });
  }

  try {
    await prisma.phone.delete({ where: { id } });
    return res.json({ success: true, message: "Phone deleted" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Phone not found" });
    }
    return res.status(409).json({
      success: false,
      message: "Phone is linked to records and cannot be deleted",
    });
  }
});

router.get("/printers", async (req, res) => {
  const rows = await prisma.printer.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/printers", async (req, res) => {
  const payload = mapPrinterPayload(req.body || {});
  if (!payload.name || !payload.ipAddress) {
    return res.status(400).json({ success: false, message: "name and ipAddress are required" });
  }
  if (!isValidPrinterIp(payload.ipAddress)) {
    return res.status(400).json({ success: false, message: "Invalid printer IP address" });
  }
  if (!payload.port) {
    return res.status(400).json({ success: false, message: "Valid port is required (1-65535)" });
  }

  const duplicateName = await prisma.printer.findUnique({ where: { name: payload.name } });
  if (duplicateName) {
    return res.status(409).json({ success: false, message: "Printer name already exists" });
  }

  const duplicateIp = await prisma.printer.findUnique({ where: { ipAddress: payload.ipAddress } });
  if (duplicateIp) {
    return res.status(409).json({ success: false, message: "Printer IP already exists" });
  }

  const row = await prisma.$transaction(async (tx) => {
    if (payload.defaultPrinter) {
      await tx.printer.updateMany({
        where: { defaultPrinter: true },
        data: { defaultPrinter: false },
      });
    }
    return tx.printer.create({ data: payload });
  });
  return res.json({ success: true, data: row });
});

router.put("/printers/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid printer id" });
  }

  const existing = await prisma.printer.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Printer not found" });
  }

  const payload = mapPrinterPayload(req.body || {});
  if (!payload.name || !payload.ipAddress) {
    return res.status(400).json({ success: false, message: "name and ipAddress are required" });
  }
  if (!isValidPrinterIp(payload.ipAddress)) {
    return res.status(400).json({ success: false, message: "Invalid printer IP address" });
  }
  if (!payload.port) {
    return res.status(400).json({ success: false, message: "Valid port is required (1-65535)" });
  }

  const duplicateName = await prisma.printer.findUnique({ where: { name: payload.name } });
  if (duplicateName && duplicateName.id !== id) {
    return res.status(409).json({ success: false, message: "Printer name already exists" });
  }

  const duplicateIp = await prisma.printer.findUnique({ where: { ipAddress: payload.ipAddress } });
  if (duplicateIp && duplicateIp.id !== id) {
    return res.status(409).json({ success: false, message: "Printer IP already exists" });
  }

  const row = await prisma.$transaction(async (tx) => {
    if (payload.defaultPrinter) {
      await tx.printer.updateMany({
        where: { defaultPrinter: true, id: { not: id } },
        data: { defaultPrinter: false },
      });
    }
    return tx.printer.update({ where: { id }, data: payload });
  });
  return res.json({ success: true, data: row });
});

router.delete("/printers/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid printer id" });
  }

  try {
    await prisma.printer.delete({ where: { id } });
    return res.json({ success: true, message: "Printer deleted" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Printer not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete printer" });
  }
});

router.get("/master-products", async (req, res) => {
  try {
    const query = String(req.query.query || "");
    const limit = Number(req.query.limit || 50);
    const includeAll = String(req.query.includeAll || "").trim().toLowerCase() === "true";
    const rows = await searchMasterProducts(query, limit, { includeAll });
    return res.json({ success: true, count: rows.length, rows, sourceFile: masterFilePath });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: `Unable to read master products (${error.message})` });
  }
});

router.get("/master-status", async (req, res) => {
  try {
    if (!fs.existsSync(masterFilePath)) {
      return res.status(404).json({
        success: false,
        allowed: false,
        message: "Master brands.csv not found",
      });
    }

    const stats = fs.statSync(masterFilePath);
    const lastModified = stats.mtime;
    const now = new Date();
    const ageMs = now.getTime() - lastModified.getTime();
    const ageMinutes = Math.floor(ageMs / 60000);
    const maxAgeMinutes = getMasterMaxAgeMinutes();
    const maxAgeMs = maxAgeMinutes * 60 * 1000;
    const recent = ageMs <= maxAgeMs;

    return res.json({
      success: true,
      allowed: recent,
      recent,
      lastModified: lastModified.toISOString(),
      lastModifiedIST: formatTimestampIST(lastModified),
      checkedAt: now.toISOString(),
      checkedAtIST: formatTimestampIST(now),
      ageMs,
      ageMinutes,
      ageLabel: formatAgeLabel(ageMs),
      maxAgeMinutes,
      sourceFile: masterFilePath,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      allowed: false,
      message: "Unable to determine master CSV status",
      error: error.message,
    });
  }
});

router.get("/best-selling", async (req, res) => {
  const rows = await prisma.bestSellingProduct.findMany({ orderBy: [{ id: "asc" }] });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/best-selling", async (req, res) => {
  const itemCode = String(req.body?.itemCode || "").trim();
  if (!itemCode) {
    return res.status(400).json({ success: false, message: "itemCode is required" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncBestSellingWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        "/api/meta/central/best-selling",
        "POST",
        req.body || {}
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync best selling with central",
      });
    }
  }

  const existing = await prisma.bestSellingProduct.findUnique({ where: { itemCode } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Item already in best selling" });
  }

  const master = await getMasterProductByCode(itemCode);
  const payload = {
    itemCode,
    itemName: toNullableText(req.body?.itemName) || master?.itemName || null,
    brandName: toNullableText(req.body?.brandName) || master?.brandName || null,
    packValue: toNullableText(req.body?.packValue) || master?.packValue || null,
  };

  const row = await prisma.bestSellingProduct.create({ data: payload });
  return res.json({ success: true, data: row, localOnly: true });
});

router.put("/best-selling/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid best selling id" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncBestSellingWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        `/api/meta/central/best-selling/${id}`,
        "PUT",
        req.body || {}
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync best selling with central",
      });
    }
  }

  const existing = await prisma.bestSellingProduct.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Best selling item not found" });
  }

  const itemCode = String(req.body?.itemCode || existing.itemCode).trim();
  const duplicate = await prisma.bestSellingProduct.findUnique({ where: { itemCode } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Item code already exists in best selling" });
  }

  const master = await getMasterProductByCode(itemCode);
  const row = await prisma.bestSellingProduct.update({
    where: { id },
    data: {
      itemCode,
      itemName: toNullableText(req.body?.itemName) || master?.itemName || existing.itemName,
      brandName: toNullableText(req.body?.brandName) || master?.brandName || existing.brandName,
      packValue: toNullableText(req.body?.packValue) || master?.packValue || existing.packValue,
    },
  });
  return res.json({ success: true, data: row, localOnly: true });
});

router.delete("/best-selling/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid best selling id" });
  }

  const settings = await getCatalogSyncSettings();
  if (settings.syncBestSellingWithCentral && settings.centralBaseUrl) {
    try {
      const result = await forwardCatalogWriteToCentral(
        settings,
        `/api/meta/central/best-selling/${id}`,
        "DELETE"
      );
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to sync best selling with central",
      });
    }
  }

  try {
    await prisma.bestSellingProduct.delete({ where: { id } });
    return res.json({ success: true, message: "Best selling item deleted", localOnly: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Best selling item not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete best selling item" });
  }
});

// Legacy aliases for existing clients
router.get("/shop-info", async (req, res) => {
  const info = await prisma.shopInfo.findUnique({ where: { id: 1 } });
  return res.json({ success: true, data: info });
});

router.post("/shop-info", async (req, res) => {
  const payload = mapShopPayload(req.body || {});
  if (!payload.shopCode || !payload.shopName) {
    return res.status(400).json({ success: false, message: "shopCode and shopName are required" });
  }
  const row = await prisma.shopInfo.upsert({ where: { id: 1 }, create: { id: 1, ...payload }, update: payload });
  return res.json({ success: true, data: row });
});

router.get("/locations", async (req, res) => {
  const rows = await prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/locations", async (req, res) => {
  const payload = mapLocationPayload(req.body || {});
  if (!payload.locationCode || !payload.locationName || !normalizeHexColor(req.body?.locationColor)) {
    return res.status(400).json({
      success: false,
      message: "locationCode, locationName and valid locationColor (#RRGGBB) are required",
    });
  }
  const existing = await prisma.shopLocation.findUnique({ where: { locationCode: payload.locationCode } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Location code already exists" });
  }
  const row = await prisma.shopLocation.create({ data: payload });
  return res.json({ success: true, data: row });
});

module.exports = router;
