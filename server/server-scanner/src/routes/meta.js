const express = require("express");
const fs = require("fs");
const net = require("net");
const { prisma } = require("../prisma");
const {
  searchMasterProducts,
  getMasterProductByCode,
  masterFilePath,
} = require("../services/masterProducts");
const { verifySettingsPassword } = require("../services/settingsPassword");
const {
  getMasterMaxAgeMinutes,
  formatTimestampIST,
} = require("../services/masterStatus");
const { sendPushNotification } = require("../services/fcmPush");
const {
  evaluateLowStock,
  getLocationLowStockSettings,
  saveLocationLowStockSettings,
  runLowStockCheckAndNotify,
} = require("../services/lowStockAlerts");

const router = express.Router();

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

  const rows = await prisma.fcmDeviceToken.findMany({
    where: {
      ...(shopLocationId ? { shopLocationId } : {}),
      ...(activeOnly ? { active: true } : {}),
    },
    orderBy: [{ id: "asc" }],
  });
  return res.json({ success: true, count: rows.length, rows });
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
      notificationsEnabled: location.notificationsEnabled,
      generalThresholdBottles: location.generalThresholdBottles,
      lowCount: location.lowCount,
      rows: location.lowRows,
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

router.get("/setup", async (req, res) => {
  const [shop, locations, workers, phones, bestSelling, printers] = await Promise.all([
    prisma.shopInfo.findUnique({ where: { id: 1 } }),
    prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.worker.findMany({ orderBy: { name: "asc" } }),
    prisma.phone.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.bestSellingProduct.findMany({ orderBy: { id: "asc" } }),
    prisma.printer.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  return res.json({
    success: true,
    data: { shop, locations, workers, phones, bestSelling, printers },
  });
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

router.get("/workers", async (req, res) => {
  const rows = await prisma.worker.findMany({ orderBy: { name: "asc" } });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/workers", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const phone = toNullableText(req.body?.phone);
  const active = req.body?.active === undefined ? true : Boolean(req.body.active);

  if (!name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const existing = await prisma.worker.findUnique({ where: { name } });
  if (existing) {
    return res.status(409).json({ success: false, message: "Operator name already exists" });
  }

  const row = await prisma.worker.create({ data: { name, phone, active } });
  return res.json({ success: true, data: row });
});

router.put("/workers/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid operator id" });
  }

  const name = String(req.body?.name || "").trim();
  const phone = toNullableText(req.body?.phone);
  const active = req.body?.active === undefined ? true : Boolean(req.body.active);

  if (!name) {
    return res.status(400).json({ success: false, message: "name is required" });
  }

  const existing = await prisma.worker.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Operator not found" });
  }

  const duplicate = await prisma.worker.findUnique({ where: { name } });
  if (duplicate && duplicate.id !== id) {
    return res.status(409).json({ success: false, message: "Operator name already exists" });
  }

  const row = await prisma.worker.update({ where: { id }, data: { name, phone, active } });
  return res.json({ success: true, data: row });
});

router.delete("/workers/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid operator id" });
  }

  try {
    await prisma.worker.delete({ where: { id } });
    return res.json({ success: true, message: "Operator deleted" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "P2025") {
      return res.status(404).json({ success: false, message: "Operator not found" });
    }
    return res
      .status(409)
      .json({ success: false, message: "Operator is linked to records and cannot be deleted" });
  }
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
      ageMs,
      ageMinutes,
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
  const rows = await prisma.bestSellingProduct.findMany({ orderBy: { id: "asc" } });
  return res.json({ success: true, count: rows.length, rows });
});

router.post("/best-selling", async (req, res) => {
  const itemCode = String(req.body?.itemCode || "").trim();
  if (!itemCode) {
    return res.status(400).json({ success: false, message: "itemCode is required" });
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
  return res.json({ success: true, data: row });
});

router.put("/best-selling/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid best selling id" });
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

  return res.json({ success: true, data: row });
});

router.delete("/best-selling/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "Invalid best selling id" });
  }

  try {
    await prisma.bestSellingProduct.delete({ where: { id } });
    return res.json({ success: true, message: "Best selling item deleted" });
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
