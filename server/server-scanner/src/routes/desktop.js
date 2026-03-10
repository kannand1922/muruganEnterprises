const express = require("express");
const { prisma } = require("../prisma");
const { verifySettingsPassword } = require("../services/settingsPassword");
const { printerServerPort } = require("../../../../shared/config/ports");
const {
  getLocationsWithDefault,
  resolveLocationFromRows,
  resolveCycleByDate,
  toLegacyCycle,
  toDateKey,
  buildComparePayload,
  buildBestSellingPayload,
  buildCycleLogsPayload,
  buildMissingBarcodesPayload,
  buildNilStockPayload,
  getLegacyBrandsPayload,
  getLegacyPrintersPayload,
  getLegacyOperatorsPayload,
  getBrandsStatusPayload,
  generateLegacyVerificationReportHTML,
  sendHtmlToPrinterByIp,
} = require("../services/desktopCompat");
const { evaluateLowStock, runLowStockCheckAndNotify } = require("../services/lowStockAlerts");

const router = express.Router();

function parsePreviewFlag(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes"].includes(normalized);
}

function parseDateOrNow(value) {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
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

async function resolveLocationOrError(req, res, options = {}) {
  const { rows, defaultLocationCode } = await getLocationsWithDefault();
  if (!rows.length) {
    res.status(400).json({
      success: false,
      message: "No shop locations configured",
    });
    return null;
  }

  const requestedCode = String(options.locationCode || "").trim();
  const selectedLocation =
    resolveLocationFromRows(rows, requestedCode) ||
    resolveLocationFromRows(rows, defaultLocationCode) ||
    rows[0];

  if (requestedCode && !resolveLocationFromRows(rows, requestedCode)) {
    res.status(400).json({
      success: false,
      message: `Invalid location code: ${requestedCode}`,
    });
    return null;
  }

  return {
    rows,
    defaultLocationCode,
    selectedLocation,
  };
}

async function buildPendingMatchesPreview(cycle) {
  const locationBundle = await getLocationsWithDefault();
  const selectedLocation =
    resolveLocationFromRows(locationBundle.rows, locationBundle.defaultLocationCode) ||
    locationBundle.rows[0] ||
    null;

  if (!selectedLocation) {
    return [];
  }

  const compare = await buildComparePayload({
    cycle,
    location: selectedLocation,
  });

  const unmatched = (compare.unmatched || []).map((item) => ({
    brand: item.brand,
    pack: item.pack,
    difference: item.difference?.total || 0,
  }));

  const nonScanned = (compare.nonScanned || []).map((item) => ({
    brand: item.brand,
    pack: item.pack,
    masterExists: true,
    difference: 0,
  }));

  return [...unmatched, ...nonScanned].slice(0, 100);
}

async function resolveCycleForRequest(cycleDate, cycleIdCandidate) {
  const cycleId = parsePositiveInt(cycleIdCandidate);
  if (cycleId) {
    return prisma.cycle.findUnique({ where: { id: cycleId } });
  }
  return resolveCycleByDate(cycleDate);
}

router.get("/api/locations", async (req, res) => {
  const { rows, defaultLocationCode } = await getLocationsWithDefault();
  return res.json({
    success: true,
    count: rows.length,
    defaultLocationCode,
    rows: rows.map((row) => ({
      id: row.id,
      locationCode: row.locationCode,
      locationName: row.locationName,
      sortOrder: row.sortOrder,
      locationType: row.locationType,
    })),
  });
});

router.get("/api/cycle/current", async (req, res) => {
  const active = await prisma.cycle.findFirst({
    where: { status: "active" },
    orderBy: [{ startDate: "desc" }],
  });

  return res.json(toLegacyCycle(active, Boolean(active)));
});

router.get("/api/cycle/all", async (req, res) => {
  const cycles = await prisma.cycle.findMany({
    orderBy: [{ startDate: "desc" }],
  });

  const rows = cycles.map((cycle) => ({
    id: cycle.id,
    cycleId: cycle.id,
    sno: cycle.sno,
    startDate: toDateKey(cycle.startDate),
    endDate: cycle.endDate ? toDateKey(cycle.endDate) : null,
    status: cycle.status,
    active: cycle.status === "active",
  }));

  return res.json({
    success: true,
    count: rows.length,
    cycles: rows,
  });
});

router.post("/api/cycle/start", async (req, res) => {
  const active = await prisma.cycle.findFirst({ where: { status: "active" } });
  if (active) {
    return res.json({
      success: false,
      message: "An active cycle already exists",
      cycle: toLegacyCycle(active, true),
    });
  }

  const startDate = parseDateOrNow(req.body?.startDate);
  if (!startDate) {
    return res.json({ success: false, message: "Invalid startDate" });
  }

  const maxSno = await prisma.cycle.aggregate({ _max: { sno: true } });
  const sno = (maxSno?._max?.sno || 0) + 1;

  const cycle = await prisma.cycle.create({
    data: {
      sno,
      startDate,
      status: "active",
    },
  });

  return res.json({
    success: true,
    message: "Cycle started",
    cycle: {
      id: cycle.id,
      cycleId: cycle.id,
      sno: cycle.sno,
      startDate: toDateKey(cycle.startDate),
      endDate: cycle.endDate ? toDateKey(cycle.endDate) : null,
      status: cycle.status,
      active: true,
    },
  });
});

router.post("/api/cycle/stop", async (req, res) => {
  const active = await prisma.cycle.findFirst({
    where: { status: "active" },
    orderBy: [{ startDate: "desc" }],
  });

  if (!active) {
    return res.json({ success: false, message: "No active cycle found" });
  }

  const unresolved = await Promise.all([
    prisma.cycleUnfinishedStock.count({ where: { cycleId: active.id } }),
    prisma.cycleFinishedStock.count({ where: { cycleId: active.id, isMatched: false } }),
  ]);
  const unfinishedCount = unresolved[0];
  const unmatchedFinishedCount = unresolved[1];

  const forcePassword = String(req.body?.forcePassword || "").trim();
  const requiresForce = unfinishedCount > 0 || unmatchedFinishedCount > 0;

  if (requiresForce && !forcePassword) {
    const pendingMatches = await buildPendingMatchesPreview(active);
    return res.json({
      success: false,
      requiresForcePassword: true,
      pendingMatches,
      message: `Cannot stop cycle. Unfinished: ${unfinishedCount}, Unmatched finished: ${unmatchedFinishedCount}`,
    });
  }

  if (requiresForce && forcePassword) {
    const verification = verifySettingsPassword(forcePassword);
    if (!verification.verified) {
      return res.json({
        success: false,
        requiresForcePassword: true,
        message: "Invalid force close password",
      });
    }
  }

  const endDate = parseDateOrNow(req.body?.endDate);
  if (!endDate) {
    return res.json({ success: false, message: "Invalid endDate" });
  }

  const updated = await prisma.cycle.update({
    where: { id: active.id },
    data: {
      status: "inactive",
      endDate,
    },
  });

  return res.json({
    success: true,
    message: requiresForce ? "Cycle force closed" : "Cycle stopped",
    cycle: {
      id: updated.id,
      cycleId: updated.id,
      sno: updated.sno,
      startDate: toDateKey(updated.startDate),
      endDate: updated.endDate ? toDateKey(updated.endDate) : null,
      status: updated.status,
      active: false,
    },
  });
});

router.get("/api/cycle/:cycleDate/compare", async (req, res) => {
  const cycle = await resolveCycleForRequest(req.params.cycleDate, req.query.cycleId);
  if (!cycle) {
    return res.status(404).json({
      success: false,
      message: `Cycle not found for date ${req.params.cycleDate}`,
    });
  }

  const locationBundle = await resolveLocationOrError(req, res, {
    locationCode: req.query.location,
  });
  if (!locationBundle) return;

  const analysisDate = String(req.query.analysisDate || "").trim();
  const payload = await buildComparePayload({
    cycle,
    location: locationBundle.selectedLocation,
    analysisDate,
  });

  return res.json(payload);
});

router.get("/api/cycle/:cycleDate/bestselling", async (req, res) => {
  const cycle = await resolveCycleForRequest(req.params.cycleDate, req.query.cycleId);
  if (!cycle) {
    return res.status(404).json({
      success: false,
      message: `Cycle not found for date ${req.params.cycleDate}`,
    });
  }

  const locationBundle = await resolveLocationOrError(req, res, {
    locationCode: req.query.location,
  });
  if (!locationBundle) return;

  const analysisDate = String(req.query.analysisDate || "").trim();
  const payload = await buildBestSellingPayload({
    cycle,
    location: locationBundle.selectedLocation,
    analysisDate,
  });

  return res.json(payload);
});

router.get("/api/cycle/:cycleDate", async (req, res) => {
  const cycle = await resolveCycleForRequest(req.params.cycleDate, req.query.cycleId);
  if (!cycle) {
    return res.status(404).json({
      success: false,
      message: `Cycle not found for date ${req.params.cycleDate}`,
    });
  }

  const payload = await buildCycleLogsPayload({ cycle });
  return res.json(payload);
});

router.get("/api/brands", async (req, res) => {
  const payload = await getLegacyBrandsPayload();
  return res.json(payload);
});

router.get("/api/brands/missing-barcodes", async (req, res) => {
  const payload = await buildMissingBarcodesPayload();
  return res.json(payload);
});

router.get("/api/brands/nil", async (req, res) => {
  const requestedLocationCode = String(req.query.location || "").trim();
  if (requestedLocationCode) {
    const { rows } = await getLocationsWithDefault();
    const requested = resolveLocationFromRows(rows, requestedLocationCode);
    if (!requested) {
      return res.status(400).json({
        success: false,
        message: `Invalid location code: ${requestedLocationCode}`,
      });
    }
  }

  const payload = await buildNilStockPayload(requestedLocationCode);
  return res.json(payload);
});

router.get("/api/brands/status", async (req, res) => {
  const payload = getBrandsStatusPayload();
  return res.json(payload);
});

router.get("/api/allprinters", async (req, res) => {
  const payload = await getLegacyPrintersPayload();
  return res.json(payload);
});

router.get("/api/operators", async (req, res) => {
  const payload = await getLegacyOperatorsPayload();
  return res.json(payload);
});

router.get("/api/low-stock/list", async (req, res) => {
  const requestedLocationCode = String(req.query.location || "").trim();
  const notificationsOnly = parseBoolean(req.query.notificationsOnly, false);
  const search = String(req.query.search || "").trim().toLowerCase();
  const ruleTypeFilter = String(req.query.ruleType || "").trim().toLowerCase();
  const packFilter = String(req.query.pack || "").trim().toLowerCase();

  const { rows } = await getLocationsWithDefault();
  const locationByCode = new Map(rows.map((row) => [String(row.locationCode || "").trim().toLowerCase(), row]));
  const requestedLocation = requestedLocationCode
    ? locationByCode.get(requestedLocationCode.toLowerCase()) || null
    : null;

  if (requestedLocationCode && !requestedLocation) {
    return res.status(400).json({
      success: false,
      message: `Invalid location code: ${requestedLocationCode}`,
    });
  }

  const snapshot = await evaluateLowStock({
    shopLocationIds: requestedLocation ? [requestedLocation.id] : null,
    onlyEnabledLocations: notificationsOnly,
    includeTokens: false,
  });

  const flattenedRows = [];
  for (const location of snapshot.locations || []) {
    for (const row of location.lowRows || []) {
      flattenedRows.push({
        shopLocationId: location.shopLocationId,
        locationCode: location.locationCode,
        locationName: location.locationName,
        sourceLocationId: location.sourceLocationId,
        sourceLocationCode: location.sourceLocationCode,
        sourceLocationName: location.sourceLocationName,
        itemCode: row.itemCode,
        itemName: row.itemName,
        brandName: row.brandName,
        packValue: row.packValue,
        displayName: row.displayName,
        thresholdBottles: row.thresholdBottles,
        currentBottles: row.currentBottles,
        sourceCurrentBottles: row.sourceCurrentBottles,
        ruleType: row.ruleType,
      });
    }
  }

  const filteredRows = flattenedRows.filter((row) => {
    if (ruleTypeFilter && String(row.ruleType || "").toLowerCase() !== ruleTypeFilter) {
      return false;
    }
    if (packFilter && String(row.packValue || "").trim().toLowerCase() !== packFilter) {
      return false;
    }
    if (!search) return true;
    const haystack = [
      row.locationCode,
      row.locationName,
      row.itemCode,
      row.itemName,
      row.brandName,
      row.packValue,
      row.displayName,
      row.ruleType,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    return search
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  });

  return res.json({
    success: true,
    generatedAt: snapshot.generatedAt,
    locationCount: snapshot.locationCount,
    locationsWithLowStock: snapshot.locationsWithLowStock,
    totalLowProducts: snapshot.totalLowProducts,
    count: filteredRows.length,
    filters: {
      location: requestedLocationCode || "",
      notificationsOnly,
      ruleType: ruleTypeFilter || "",
      pack: packFilter || "",
      search: search || "",
    },
    rows: filteredRows,
  });
});

router.post("/api/low-stock/check-now", async (req, res) => {
  const requestedLocationCode = String(req.body?.location || "").trim();
  const dryRun = parseBoolean(req.body?.dryRun, false);
  const forceResend = parseBoolean(req.body?.forceResend, false);

  let shopLocationIds = null;
  if (requestedLocationCode) {
    const { rows } = await getLocationsWithDefault();
    const selected = resolveLocationFromRows(rows, requestedLocationCode);
    if (!selected) {
      return res.status(400).json({
        success: false,
        message: `Invalid location code: ${requestedLocationCode}`,
      });
    }
    shopLocationIds = [selected.id];
  }

  const result = await runLowStockCheckAndNotify({
    shopLocationIds,
    dryRun,
    trigger: "desktop_manual",
    enforceCsvVersionOnce: !forceResend,
  });

  return res.json(result);
});

router.get("/api/low-stock/notifications", async (req, res) => {
  const requestedLocationCode = String(req.query.location || "").trim();
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

  const { rows } = await getLocationsWithDefault();
  const requestedLocation = requestedLocationCode
    ? resolveLocationFromRows(rows, requestedLocationCode)
    : null;
  if (requestedLocationCode && !requestedLocation) {
    return res.status(400).json({
      success: false,
      message: `Invalid location code: ${requestedLocationCode}`,
    });
  }

  const where = {
    ...(requestedLocation ? { shopLocationId: requestedLocation.id } : {}),
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

  const mappedRows = rowsFromDb.map((row) => ({
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

  const summary = mappedRows.reduce(
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
      location: requestedLocationCode || "",
      status: statusFilter || "all",
      dateFrom: dateFromRaw || "",
      dateTo: dateToRaw || "",
    },
    summary,
    count: mappedRows.length,
    rows: mappedRows,
  });
});

router.post("/api/settings-auth", async (req, res) => {
  const password = String(req.body?.password || "");
  const result = verifySettingsPassword(password);

  if (!result.verified) {
    return res.status(401).json({
      success: false,
      message: "Invalid settings password",
    });
  }

  return res.json({
    success: true,
    data: {
      verified: true,
      source: result.source,
    },
  });
});

router.post("/api/print/html", async (req, res) => {
  const printerIP = String(req.body?.printerIP || "").trim();
  const htmlContent = String(req.body?.htmlContent || "");
  const jobLabel = String(req.body?.jobLabel || "desktop_report").trim() || "desktop_report";
  const copies = parsePositiveInt(req.body?.copies) || 1;
  const port = parsePositiveInt(req.body?.port) || 9100;

  if (!printerIP) {
    return res.status(400).json({ success: false, message: "printerIP is required" });
  }
  if (!htmlContent) {
    return res.status(400).json({ success: false, message: "htmlContent is required" });
  }

  const printerServiceBaseUrl = String(
    process.env.PRINTER_SERVICE_URL || `http://localhost:${printerServerPort}`
  )
    .trim()
    .replace(/\/+$/, "");

  try {
    const result = await sendHtmlToPrinterByIp({
      printerIP,
      htmlContent,
      jobLabel,
      copies,
      port,
      printerServiceBaseUrl,
    });

    return res.json({
      success: true,
      message: "Report sent to printer",
      printerIP,
      port,
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to print report",
    });
  }
});

router.post("/api/print/verification-report/:cycleDate", async (req, res) => {
  const cycle = await resolveCycleForRequest(req.params.cycleDate, req.query.cycleId || req.body?.cycleId);
  if (!cycle) {
    return res.status(404).json({
      success: false,
      message: `Cycle not found for date ${req.params.cycleDate}`,
    });
  }

  const locationBundle = await resolveLocationOrError(req, res, {
    locationCode: req.query.location,
  });
  if (!locationBundle) return;

  const compare = await buildComparePayload({
    cycle,
    location: locationBundle.selectedLocation,
    analysisDate: String(req.query.analysisDate || "").trim(),
  });

  const html = generateLegacyVerificationReportHTML({
    cycleDate: toDateKey(cycle.startDate),
    location: locationBundle.selectedLocation.locationCode,
    locationLabel: locationBundle.selectedLocation.locationName,
    summary: compare.summary,
    unmatched: compare.unmatched,
    nonScanned: compare.nonScanned,
  });

  const preview = parsePreviewFlag(req.query.preview || req.body?.preview);
  if (preview) {
    return res.json({
      success: true,
      cycleDate: toDateKey(cycle.startDate),
      location: locationBundle.selectedLocation.locationCode,
      html,
    });
  }

  const printerIP = String(req.query.printer || req.body?.printerIP || "").trim();
  if (!printerIP) {
    return res.status(400).json({ success: false, message: "printer is required" });
  }

  const printerServiceBaseUrl = String(
    process.env.PRINTER_SERVICE_URL || `http://localhost:${printerServerPort}`
  )
    .trim()
    .replace(/\/+$/, "");

  try {
    const result = await sendHtmlToPrinterByIp({
      printerIP,
      htmlContent: html,
      jobLabel: `verification_report_${toDateKey(cycle.startDate)}_${locationBundle.selectedLocation.locationCode}`,
      copies: parsePositiveInt(req.body?.copies) || 1,
      port: parsePositiveInt(req.body?.port) || 9100,
      printerServiceBaseUrl,
    });

    return res.json({
      success: true,
      message: "Verification report printed successfully",
      cycleDate: toDateKey(cycle.startDate),
      location: locationBundle.selectedLocation.locationCode,
      printerIP,
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to print verification report",
    });
  }
});

module.exports = router;
