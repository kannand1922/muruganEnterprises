const express = require("express");
const { prisma } = require("../prisma");
const { verifySettingsPassword } = require("../services/settingsPassword");

const router = express.Router();

const TABLES = {
  cycleFinishedStock: {
    key: "cycleFinishedStock",
    label: "Finished Table",
    group: "primary",
    delegate: "cycleFinishedStock",
    cycleField: "cycleId",
    locationField: "shopLocationId",
    matchField: "isMatched",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue", "barcode", "phoneName"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  cycleUnfinishedStock: {
    key: "cycleUnfinishedStock",
    label: "Unfinished Table",
    group: "primary",
    delegate: "cycleUnfinishedStock",
    cycleField: "cycleId",
    locationField: "shopLocationId",
    matchField: "isMatched",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue", "barcode", "phoneName"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  cycleProductEvent: {
    key: "cycleProductEvent",
    label: "Event Log",
    group: "secondary",
    delegate: "cycleProductEvent",
    cycleField: "cycleId",
    locationField: "shopLocationId",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue", "eventScope", "eventAction", "phoneName", "shopName"],
    orderBy: [{ eventTime: "desc" }, { id: "desc" }],
    clearable: true,
  },
  diffBatch: {
    key: "diffBatch",
    label: "Diff Batches",
    group: "secondary",
    delegate: "diffBatch",
    cycleField: "cycleId",
    locationField: "shopLocationId",
    searchableFields: ["proofImageName", "proofImagePath"],
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  diffItem: {
    key: "diffItem",
    label: "Diff Items",
    group: "secondary",
    delegate: "diffItem",
    cycleField: "cycleId",
    locationField: "shopLocationId",
    matchField: "isMatched",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue", "barcode", "phoneName", "sourceScope"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  cycle: {
    key: "cycle",
    label: "Cycles",
    group: "secondary",
    delegate: "cycle",
    searchableFields: ["status"],
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    clearable: true,
  },
  operatorDailyMismatchSummary: {
    key: "operatorDailyMismatchSummary",
    label: "Operator Mismatch Summary",
    group: "secondary",
    delegate: "operatorDailyMismatchSummary",
    cycleField: "cycleId",
    searchableFields: [],
    orderBy: [{ activityDate: "desc" }, { id: "desc" }],
    clearable: true,
  },
  bestSellingProduct: {
    key: "bestSellingProduct",
    label: "Best Selling",
    group: "secondary",
    delegate: "bestSellingProduct",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue"],
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  shopLocation: {
    key: "shopLocation",
    label: "Shop Locations",
    group: "secondary",
    delegate: "shopLocation",
    searchableFields: ["locationCode", "locationName", "locationType"],
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    clearable: true,
  },
  worker: {
    key: "worker",
    label: "Operators",
    group: "secondary",
    delegate: "worker",
    searchableFields: ["name", "phone"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  device: {
    key: "device",
    label: "Devices",
    group: "secondary",
    delegate: "device",
    searchableFields: ["uuid", "model", "platform"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  phone: {
    key: "phone",
    label: "Phones",
    group: "secondary",
    delegate: "phone",
    searchableFields: ["name"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  printer: {
    key: "printer",
    label: "Printers",
    group: "secondary",
    delegate: "printer",
    searchableFields: ["name", "ipAddress"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  appSetting: {
    key: "appSetting",
    label: "App Settings",
    group: "secondary",
    delegate: "appSetting",
    searchableFields: ["key", "value"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  shopInfo: {
    key: "shopInfo",
    label: "Shop Info",
    group: "secondary",
    delegate: "shopInfo",
    searchableFields: ["shopCode", "shopName", "areaName", "city", "state", "pincode"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  lowStockLocationConfig: {
    key: "lowStockLocationConfig",
    label: "Low Stock Config",
    group: "secondary",
    delegate: "lowStockLocationConfig",
    locationField: "shopLocationId",
    searchableFields: [],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  lowStockPackRule: {
    key: "lowStockPackRule",
    label: "Low Stock Pack Rules",
    group: "secondary",
    delegate: "lowStockPackRule",
    locationField: "shopLocationId",
    searchableFields: ["packValue", "normalizedPack"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  lowStockBrandRule: {
    key: "lowStockBrandRule",
    label: "Low Stock Brand Rules",
    group: "secondary",
    delegate: "lowStockBrandRule",
    locationField: "shopLocationId",
    searchableFields: ["brandName", "normalizedBrand"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  lowStockProductRule: {
    key: "lowStockProductRule",
    label: "Low Stock Product Rules",
    group: "secondary",
    delegate: "lowStockProductRule",
    locationField: "shopLocationId",
    searchableFields: ["itemCode", "normalizedCode"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  lowStockNotificationRun: {
    key: "lowStockNotificationRun",
    label: "Low Stock Notifications",
    group: "secondary",
    delegate: "lowStockNotificationRun",
    locationField: "shopLocationId",
    searchableFields: ["csvVersion", "trigger", "status", "reason"],
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  lowStockProductNotificationState: {
    key: "lowStockProductNotificationState",
    label: "Low Stock Product States",
    group: "secondary",
    delegate: "lowStockProductNotificationState",
    locationField: "shopLocationId",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue", "displayName"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  highStockLocationConfig: {
    key: "highStockLocationConfig",
    label: "High Stock Config",
    group: "secondary",
    delegate: "highStockLocationConfig",
    locationField: "shopLocationId",
    searchableFields: [],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  highStockPackRule: {
    key: "highStockPackRule",
    label: "High Stock Pack Rules",
    group: "secondary",
    delegate: "highStockPackRule",
    locationField: "shopLocationId",
    searchableFields: ["packValue", "normalizedPack"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  highStockBrandRule: {
    key: "highStockBrandRule",
    label: "High Stock Brand Rules",
    group: "secondary",
    delegate: "highStockBrandRule",
    locationField: "shopLocationId",
    searchableFields: ["brandName", "normalizedBrand"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  highStockProductRule: {
    key: "highStockProductRule",
    label: "High Stock Product Rules",
    group: "secondary",
    delegate: "highStockProductRule",
    locationField: "shopLocationId",
    searchableFields: ["itemCode", "normalizedCode"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  nilStockLocationConfig: {
    key: "nilStockLocationConfig",
    label: "Nil Stock Config",
    group: "secondary",
    delegate: "nilStockLocationConfig",
    locationField: "shopLocationId",
    searchableFields: [],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  nilStockNotificationRun: {
    key: "nilStockNotificationRun",
    label: "Nil Stock Notifications",
    group: "secondary",
    delegate: "nilStockNotificationRun",
    locationField: "shopLocationId",
    searchableFields: ["csvVersion", "trigger", "status", "reason"],
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  nilStockProductNotificationState: {
    key: "nilStockProductNotificationState",
    label: "Nil Stock Product States",
    group: "secondary",
    delegate: "nilStockProductNotificationState",
    locationField: "shopLocationId",
    searchableFields: ["itemCode", "itemName", "brandName", "packValue", "displayName"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
  fcmDeviceToken: {
    key: "fcmDeviceToken",
    label: "FCM Tokens",
    group: "secondary",
    delegate: "fcmDeviceToken",
    locationField: "shopLocationId",
    searchableFields: ["token"],
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    clearable: true,
  },
};

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parsePositiveIntWithin(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeMatchState(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (normalized === "matched" || normalized === "unmatched") {
    return normalized;
  }
  return "all";
}

function normalizeStatus(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (normalized === "active" || normalized === "inactive") {
    return normalized;
  }
  return "all";
}

function buildWhere(config, source) {
  const clauses = [];
  const cycleId = parseOptionalPositiveInt(source?.cycleId);
  const shopLocationId = parseOptionalPositiveInt(source?.shopLocationId);
  const search = String(source?.search || "").trim();
  const matchState = normalizeMatchState(source?.matchState);
  const status = normalizeStatus(source?.status);

  if (config.cycleField && cycleId) {
    clauses.push({ [config.cycleField]: cycleId });
  }
  if (config.locationField && shopLocationId) {
    clauses.push({ [config.locationField]: shopLocationId });
  }
  if (config.matchField && matchState !== "all") {
    clauses.push({ [config.matchField]: matchState === "matched" });
  }
  if (config.delegate === "cycle" && status !== "all") {
    clauses.push({ status });
  }
  if (search && config.searchableFields.length > 0) {
    clauses.push({
      OR: config.searchableFields.map((field) => ({
        [field]: { contains: search },
      })),
    });
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { AND: clauses };
}

function getTableConfig(tableKey) {
  if (!tableKey || !Object.prototype.hasOwnProperty.call(TABLES, tableKey)) {
    return null;
  }
  return TABLES[tableKey];
}

function serializeTable(config) {
  return {
    key: config.key,
    label: config.label,
    group: config.group,
    clearable: config.clearable,
    supportsCycleFilter: Boolean(config.cycleField),
    supportsLocationFilter: Boolean(config.locationField),
    supportsMatchFilter: Boolean(config.matchField),
  };
}

router.get("/tables", async (req, res) => {
  const tables = Object.values(TABLES).map(serializeTable);
  return res.json({
    success: true,
    count: tables.length,
    tables,
  });
});

router.get("/rows", async (req, res) => {
  const config = getTableConfig(String(req.query.table || ""));
  if (!config) {
    return res.status(400).json({ success: false, message: "Invalid table" });
  }

  const limit = parsePositiveIntWithin(req.query.limit, 100, 10, 500);
  const where = buildWhere(config, req.query);
  const delegate = prisma[config.delegate];

  const [totalCount, filteredCount, rows] = await Promise.all([
    delegate.count(),
    delegate.count({ where }),
    delegate.findMany({
      where,
      orderBy: config.orderBy,
      take: limit,
    }),
  ]);

  return res.json({
    success: true,
    table: serializeTable(config),
    limit,
    totalCount,
    filteredCount,
    rows,
  });
});

router.post("/clear", async (req, res) => {
  const config = getTableConfig(String(req.body?.table || ""));
  if (!config) {
    return res.status(400).json({ success: false, message: "Invalid table" });
  }

  const passwordResult = verifySettingsPassword(String(req.body?.password || ""));
  if (!passwordResult.verified) {
    return res.status(401).json({ success: false, message: "Invalid DB viewer password" });
  }

  const cycleId = parseOptionalPositiveInt(req.body?.cycleId);
  if (config.cycleField && !cycleId) {
    return res.status(400).json({ success: false, message: "cycleId is required for this table" });
  }

  const where = buildWhere(config, req.body);
  const deleteArgs = where && Object.keys(where).length > 0 ? { where } : {};

  try {
    const result = await prisma[config.delegate].deleteMany(deleteArgs);
    return res.json({
      success: true,
      table: serializeTable(config),
      deletedCount: result.count,
      cycleId: cycleId || null,
      shopLocationId: parseOptionalPositiveInt(req.body?.shopLocationId),
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "P2003") {
      return res.status(409).json({
        success: false,
        message: "Cannot clear this table until dependent rows are cleared first",
      });
    }
    throw error;
  }
});

module.exports = router;
