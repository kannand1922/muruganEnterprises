const fs = require("fs");
const { prisma } = require("../prisma");
const { loadMasterProducts, masterFilePath } = require("./masterProducts");
const { sendPushNotificationToMany } = require("./fcmPush");

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePackKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9.]/g, "");
}

function normalizeBrandKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCodeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function toPositiveInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const numeric = Math.trunc(parsed);
  if (numeric < 0) return fallback;
  return numeric;
}

function parseStockStringToBottles(stock, bpc) {
  const raw = String(stock || "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [packsPart = "0", bottlesPart = "0"] = unsigned.split(".");
  const packs = Math.max(0, Number.parseInt(packsPart, 10) || 0);
  const bottles = Math.max(0, Number.parseInt(bottlesPart, 10) || 0);
  const total = packs * Math.max(1, bpc || 1) + bottles;
  return negative ? -total : total;
}

function isGodownLike(value) {
  const normalized = normalizeKey(value);
  return (
    normalized.includes("godown") ||
    normalized.includes("goddown") ||
    normalized.includes("godwn") ||
    normalized.includes("warehouse")
  );
}

function getMasterStockBottles(product, location) {
  const safeBpc = Number(product?.bpc) || 12;
  const codeKey = normalizeKey(location?.locationCode);
  const stocks = product?.locationStocks || {};

  const mappedByCode = codeKey ? String(stocks[codeKey] ?? "").trim() : "";
  const value =
    mappedByCode ||
    (isGodownLike(codeKey) ? product?.godownStock : "") ||
    (codeKey === "shop" ? product?.shopStock : "") ||
    product?.shopStock ||
    product?.godownStock ||
    "0";

  return parseStockStringToBottles(value, safeBpc);
}

function buildDisplayName(row) {
  const brand = String(row.brandName || row.itemName || row.itemCode || "").trim();
  const pack = String(row.packValue || "").trim();
  return `${brand}${pack ? ` ${pack}` : ""}`.trim();
}

function buildRuleMaps(packRules, productRules) {
  const packRuleMap = new Map();
  const productRuleMap = new Map();

  for (const row of packRules) {
    const key = normalizePackKey(row.normalizedPack || row.packValue);
    const threshold = toPositiveInt(row.thresholdBottles, null);
    if (!key || threshold === null) continue;
    packRuleMap.set(key, threshold);
  }
  for (const row of productRules) {
    const key = normalizeCodeKey(row.normalizedCode || row.itemCode);
    const threshold = toPositiveInt(row.thresholdBottles, null);
    if (!key || threshold === null) continue;
    productRuleMap.set(key, threshold);
  }

  return { packRuleMap, productRuleMap };
}

function resolveThreshold(row, maps) {
  const codeKey = normalizeCodeKey(row.itemCode);
  if (codeKey && maps.productRuleMap.has(codeKey)) {
    return { threshold: maps.productRuleMap.get(codeKey), ruleType: "product" };
  }

  const packKey = normalizePackKey(row.packValue);
  if (packKey && maps.packRuleMap.has(packKey)) {
    return { threshold: maps.packRuleMap.get(packKey), ruleType: "pack" };
  }

  return { threshold: null, ruleType: null };
}

function sanitizeRuleRows(list, type) {
  const rows = Array.isArray(list) ? list : [];
  const unique = new Map();

  for (const row of rows) {
    const threshold = toPositiveInt(row?.thresholdBottles, null);
    if (threshold === null) continue;

    if (type === "pack") {
      const packValue = String(row?.packValue || "").trim();
      const normalized = normalizePackKey(packValue);
      if (!packValue || !normalized) continue;
      unique.set(normalized, {
        packValue,
        normalizedPack: normalized,
        thresholdBottles: threshold,
      });
      continue;
    }

    if (type === "brand") {
      const brandName = String(row?.brandName || "").trim();
      const normalized = normalizeBrandKey(brandName);
      if (!brandName || !normalized) continue;
      unique.set(normalized, {
        brandName,
        normalizedBrand: normalized,
        thresholdBottles: threshold,
      });
      continue;
    }

    const itemCode = String(row?.itemCode || "").trim();
    const normalized = normalizeCodeKey(itemCode);
    if (!itemCode || !normalized) continue;
    unique.set(normalized, {
      itemCode,
      normalizedCode: normalized,
      thresholdBottles: threshold,
    });
  }

  return Array.from(unique.values());
}

function getDefaultLocationSnapshot(location) {
  return {
    shopLocationId: location.id,
    locationCode: location.locationCode,
    locationName: location.locationName,
    notificationsEnabled: Boolean(location.lowStockNotificationsEnabled),
    generalThresholdBottles: 0,
    lowCount: 0,
    lowRows: [],
    tokens: [],
  };
}

async function getMasterCsvVersionMeta() {
  const stat = await fs.promises.stat(masterFilePath);
  const csvModifiedAt = new Date(stat.mtimeMs).toISOString();
  const csvVersion = `mtime:${Math.trunc(stat.mtimeMs)}:size:${Number(stat.size || 0)}`;
  return { csvVersion, csvModifiedAt };
}

function getCurrentUtcDayWindow() {
  const dayKey = new Date().toISOString().slice(0, 10);
  return {
    dayKey,
    dayStart: new Date(`${dayKey}T00:00:00.000Z`),
    dayEnd: new Date(`${dayKey}T23:59:59.999Z`),
  };
}

function maskToken(token) {
  const value = String(token || "").trim();
  if (!value) return "unknown";
  if (value.length <= 16) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function summarizePushResponses(responses) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return "none";
  }
  return responses
    .map((entry) => {
      const status = entry?.success ? "ok" : entry?.errorCode || "failed";
      return `${maskToken(entry?.token)}:${status}`;
    })
    .join(" | ");
}

async function evaluateLowStock(options = {}) {
  const {
    shopLocationIds = null,
    onlyEnabledLocations = false,
    includeTokens = false,
  } = options;

  const requestedIds = Array.isArray(shopLocationIds)
    ? Array.from(new Set(shopLocationIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : [];

  const where = {
    ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
    ...(onlyEnabledLocations ? { lowStockNotificationsEnabled: true } : {}),
  };

  const [locations, masterRows] = await Promise.all([
    prisma.shopLocation.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    loadMasterProducts(),
  ]);

  if (locations.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      locationCount: 0,
      locationsWithLowStock: 0,
      totalLowProducts: 0,
      locations: [],
    };
  }

  const locationIds = locations.map((row) => row.id);
  const [packRules, productRules, tokenRows] = await Promise.all([
    prisma.lowStockPackRule.findMany({ where: { shopLocationId: { in: locationIds } } }),
    prisma.lowStockProductRule.findMany({ where: { shopLocationId: { in: locationIds } } }),
    includeTokens
      ? prisma.fcmDeviceToken.findMany({
          where: {
            active: true,
            shopLocationId: { in: locationIds },
            phone: {
              is: {
                lowStockNotificationsEnabled: true,
              },
            },
          },
          orderBy: [{ id: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const packsByLocationId = new Map();
  const productsByLocationId = new Map();
  const tokensByLocationId = new Map();

  for (const row of packRules) {
    if (!packsByLocationId.has(row.shopLocationId)) packsByLocationId.set(row.shopLocationId, []);
    packsByLocationId.get(row.shopLocationId).push(row);
  }
  for (const row of productRules) {
    if (!productsByLocationId.has(row.shopLocationId)) productsByLocationId.set(row.shopLocationId, []);
    productsByLocationId.get(row.shopLocationId).push(row);
  }
  for (const row of tokenRows) {
    if (!row.shopLocationId) continue;
    if (!tokensByLocationId.has(row.shopLocationId)) tokensByLocationId.set(row.shopLocationId, []);
    tokensByLocationId.get(row.shopLocationId).push(row.token);
  }

  const snapshots = locations.map((location) => {
    const snapshot = getDefaultLocationSnapshot(location);

    const maps = buildRuleMaps(
      packsByLocationId.get(location.id) || [],
      productsByLocationId.get(location.id) || []
    );

    const lowRows = [];
    for (const row of masterRows) {
      const currentBottles = getMasterStockBottles(row, location);
      const { threshold, ruleType } = resolveThreshold(row, maps);
      const safeThreshold = toPositiveInt(threshold, 0);
      if (safeThreshold <= 0) continue;
      if (!ruleType) continue;
      if (currentBottles > safeThreshold) continue;

      lowRows.push({
        itemCode: String(row.itemCode || "").trim(),
        itemName: String(row.itemName || "").trim(),
        brandName: String(row.brandName || "").trim(),
        packValue: String(row.packValue || "").trim(),
        displayName: buildDisplayName(row),
        thresholdBottles: safeThreshold,
        currentBottles,
        ruleType,
      });
    }

    lowRows.sort((a, b) => {
      if (a.currentBottles !== b.currentBottles) {
        return a.currentBottles - b.currentBottles;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    snapshot.lowRows = lowRows;
    snapshot.lowCount = lowRows.length;
    snapshot.tokens = tokensByLocationId.get(location.id) || [];

    return snapshot;
  });

  const locationsWithLowStock = snapshots.filter((row) => row.lowCount > 0).length;
  const totalLowProducts = snapshots.reduce((sum, row) => sum + row.lowCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    locationCount: snapshots.length,
    locationsWithLowStock,
    totalLowProducts,
    locations: snapshots,
  };
}

async function saveLocationLowStockSettings(shopLocationId, payload) {
  const normalizedLocationId = Number(shopLocationId);
  if (!Number.isFinite(normalizedLocationId) || normalizedLocationId <= 0) {
    throw new Error("Valid shopLocationId is required");
  }

  const generalThresholdBottles = 0;
  const packRules = sanitizeRuleRows(payload?.packRules, "pack");
  const productRules = sanitizeRuleRows(payload?.productRules, "product");

  await prisma.$transaction(async (tx) => {
    await tx.lowStockLocationConfig.upsert({
      where: { shopLocationId: normalizedLocationId },
      create: {
        shopLocationId: normalizedLocationId,
        generalThresholdBottles,
      },
      update: {
        generalThresholdBottles,
      },
    });

    await tx.lowStockPackRule.deleteMany({ where: { shopLocationId: normalizedLocationId } });
    await tx.lowStockBrandRule.deleteMany({ where: { shopLocationId: normalizedLocationId } });
    await tx.lowStockProductRule.deleteMany({ where: { shopLocationId: normalizedLocationId } });

    if (packRules.length > 0) {
      await tx.lowStockPackRule.createMany({
        data: packRules.map((row) => ({
          shopLocationId: normalizedLocationId,
          packValue: row.packValue,
          normalizedPack: row.normalizedPack,
          thresholdBottles: row.thresholdBottles,
        })),
      });
    }

    if (productRules.length > 0) {
      await tx.lowStockProductRule.createMany({
        data: productRules.map((row) => ({
          shopLocationId: normalizedLocationId,
          itemCode: row.itemCode,
          normalizedCode: row.normalizedCode,
          thresholdBottles: row.thresholdBottles,
        })),
      });
    }
  });

  return {
    generalThresholdBottles,
    packRules,
    brandRules: [],
    productRules,
  };
}

async function getLocationLowStockSettings(shopLocationId) {
  const normalizedLocationId = Number(shopLocationId);
  if (!Number.isFinite(normalizedLocationId) || normalizedLocationId <= 0) {
    throw new Error("Valid shopLocationId is required");
  }

  const [location, packRules, productRules] = await Promise.all([
    prisma.shopLocation.findUnique({ where: { id: normalizedLocationId } }),
    prisma.lowStockPackRule.findMany({ where: { shopLocationId: normalizedLocationId }, orderBy: [{ id: "asc" }] }),
    prisma.lowStockProductRule.findMany({ where: { shopLocationId: normalizedLocationId }, orderBy: [{ id: "asc" }] }),
  ]);

  if (!location) {
    throw new Error("Shop location not found");
  }

  return {
    shopLocationId: normalizedLocationId,
    locationCode: location.locationCode,
    locationName: location.locationName,
    notificationsEnabled: Boolean(location.lowStockNotificationsEnabled),
    generalThresholdBottles: 0,
    packRules: packRules.map((row) => ({
      packValue: row.packValue,
      thresholdBottles: row.thresholdBottles,
    })),
    brandRules: [],
    productRules: productRules.map((row) => ({
      itemCode: row.itemCode,
      thresholdBottles: row.thresholdBottles,
    })),
  };
}

function collectInvalidTokens(pushResponse) {
  const invalidCodes = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-recipient",
  ]);
  const invalidTokens = [];
  for (const row of pushResponse?.responses || []) {
    if (!row || row.success) continue;
    if (!row.token) continue;
    if (!row.errorCode || !invalidCodes.has(String(row.errorCode))) continue;
    invalidTokens.push(row.token);
  }
  return invalidTokens;
}

async function runLowStockCheckAndNotify(options = {}) {
  const {
    shopLocationIds = null,
    dryRun = false,
    trigger = "manual",
    enforceDailyOnce = undefined,
    enforceCsvVersionOnce = true,
  } = options;
  const shouldEnforceDailyOnce =
    Boolean(
      enforceDailyOnce === undefined ? enforceCsvVersionOnce : enforceDailyOnce
    ) && !dryRun;
  const csvMeta = await getMasterCsvVersionMeta();
  const csvVersion = csvMeta.csvVersion;
  const csvModifiedAt = csvMeta.csvModifiedAt;
  const dayWindow = getCurrentUtcDayWindow();

  const snapshot = await evaluateLowStock({
    shopLocationIds,
    onlyEnabledLocations: false,
    includeTokens: true,
  });

  const notifyResults = [];
  for (const location of snapshot.locations) {
    let existingRun = null;
    const currentLowCount = Number(location.lowCount || 0);
    let previousLowCount = null;
    if (shouldEnforceDailyOnce) {
      existingRun = await prisma.lowStockNotificationRun.findFirst({
        where: {
          shopLocationId: location.shopLocationId,
          createdAt: {
            gte: dayWindow.dayStart,
            lte: dayWindow.dayEnd,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      previousLowCount = existingRun ? Number(existingRun.lowCount || 0) : null;
    }

    if (currentLowCount <= 0) {
      if (shouldEnforceDailyOnce) {
        if (existingRun && existingRun.status === "sent") {
          await prisma.lowStockNotificationRun.update({
            where: { id: existingRun.id },
            data: {
              csvVersion,
              trigger,
              lowCount: 0,
              tokenCount: location.tokens.length,
              reason: "already-sent-no-low-stock",
            },
          });
        } else if (existingRun) {
          await prisma.lowStockNotificationRun.update({
            where: { id: existingRun.id },
            data: {
              csvVersion,
              trigger,
              status: "skipped",
              lowCount: 0,
              tokenCount: location.tokens.length,
              successCount: 0,
              failureCount: 0,
              reason: "no-low-stock",
              sentAt: null,
            },
          });
        } else {
          await prisma.lowStockNotificationRun.create({
            data: {
              shopLocationId: location.shopLocationId,
              csvVersion,
              trigger,
              status: "skipped",
              lowCount: 0,
              tokenCount: location.tokens.length,
              successCount: 0,
              failureCount: 0,
              reason: "no-low-stock",
            },
          });
        }
      }

      notifyResults.push({
        shopLocationId: location.shopLocationId,
        locationName: location.locationName,
        csvVersion,
        lowCount: 0,
        tokenCount: location.tokens.length,
        sent: false,
        reason: "no-low-stock",
      });
      continue;
    }

    if (!Array.isArray(location.tokens) || location.tokens.length === 0) {
      if (shouldEnforceDailyOnce) {
        if (existingRun && existingRun.status === "sent") {
          await prisma.lowStockNotificationRun.update({
            where: { id: existingRun.id },
            data: {
              csvVersion,
              trigger,
              lowCount: currentLowCount,
              tokenCount: 0,
              reason: "already-sent-no-fcm-tokens",
            },
          });
        } else if (existingRun) {
          await prisma.lowStockNotificationRun.update({
            where: { id: existingRun.id },
            data: {
              csvVersion,
              trigger,
              status: "skipped",
              lowCount: currentLowCount,
              tokenCount: 0,
              successCount: 0,
              failureCount: 0,
              reason: "no-fcm-tokens",
              sentAt: null,
            },
          });
        } else {
          await prisma.lowStockNotificationRun.create({
            data: {
              shopLocationId: location.shopLocationId,
              csvVersion,
              trigger,
              status: "skipped",
              lowCount: currentLowCount,
              tokenCount: 0,
              successCount: 0,
              failureCount: 0,
              reason: "no-fcm-tokens",
            },
          });
        }
      }

      notifyResults.push({
        shopLocationId: location.shopLocationId,
        locationName: location.locationName,
        csvVersion,
        lowCount: location.lowCount,
        tokenCount: 0,
        sent: false,
        reason: "no-fcm-tokens",
      });
      continue;
    }

    if (shouldEnforceDailyOnce && existingRun?.status === "sent") {
      await prisma.lowStockNotificationRun.update({
        where: { id: existingRun.id },
        data: {
          csvVersion,
          trigger,
          lowCount: currentLowCount,
          tokenCount: location.tokens.length,
          reason: "already-sent-for-today",
        },
      });

      notifyResults.push({
        shopLocationId: location.shopLocationId,
        locationName: location.locationName,
        csvVersion,
        lowCount: currentLowCount,
        tokenCount: location.tokens.length,
        sent: false,
        reason: "already-sent-for-today",
        lastSentAt: existingRun.sentAt ? existingRun.sentAt.toISOString() : null,
      });
      continue;
    }

    let pendingRunId = null;
    if (shouldEnforceDailyOnce) {
      if (existingRun) {
        const updated = await prisma.lowStockNotificationRun.update({
          where: { id: existingRun.id },
          data: {
            csvVersion,
            trigger,
            status: "pending",
            lowCount: currentLowCount,
            tokenCount: location.tokens.length,
            successCount: 0,
            failureCount: 0,
            reason: "pending",
            sentAt: null,
          },
        });
        pendingRunId = updated.id;
      } else {
        const created = await prisma.lowStockNotificationRun.create({
          data: {
            shopLocationId: location.shopLocationId,
            csvVersion,
            trigger,
            status: "pending",
            lowCount: currentLowCount,
            tokenCount: location.tokens.length,
            successCount: 0,
            failureCount: 0,
            reason: "pending",
          },
        });
        pendingRunId = created.id;
      }
    }

    const pushResponse = await sendPushNotificationToMany({
      tokens: location.tokens,
      title: "Stock Low Alert",
      body: "Low stock found please check.",
      data: {
        type: "low_stock_alert",
        screen: "low_stock",
        tab: "low",
        redirectTab: "low",
        route: `/stock/low-stock?shopLocationId=${encodeURIComponent(String(location.shopLocationId))}`,
        trigger,
        shopLocationId: String(location.shopLocationId),
        lowCount: String(currentLowCount),
      },
      dryRun,
    });

    console.log(
      `Low stock push targets: location=${location.locationName}, shopLocationId=${location.shopLocationId}, tokens=${location.tokens
        .map(maskToken)
        .join(" | ")}`
    );
    console.log(
      `Low stock push response: location=${location.locationName}, success=${pushResponse.successCount}, failure=${pushResponse.failureCount}, responses=${summarizePushResponses(
        pushResponse.responses
      )}`
    );

    const invalidTokens = collectInvalidTokens(pushResponse);
    if (invalidTokens.length > 0 && !dryRun) {
      await prisma.fcmDeviceToken.updateMany({
        where: {
          token: { in: invalidTokens },
        },
        data: {
          active: false,
        },
      });
    }

    if (shouldEnforceDailyOnce && pendingRunId) {
      const successful = pushResponse.successCount > 0;
      await prisma.lowStockNotificationRun.update({
        where: { id: pendingRunId },
        data: {
          csvVersion,
          trigger,
          status: successful ? "sent" : "failed",
          lowCount: currentLowCount,
          tokenCount: location.tokens.length,
          successCount: pushResponse.successCount,
          failureCount: pushResponse.failureCount,
          reason: successful ? "sent" : "send-failed",
          sentAt: successful ? new Date() : null,
        },
      });
    }

    notifyResults.push({
      shopLocationId: location.shopLocationId,
      locationName: location.locationName,
      csvVersion,
      lowCount: currentLowCount,
      previousLowCount,
      tokenCount: location.tokens.length,
      sent: pushResponse.successCount > 0,
      successCount: pushResponse.successCount,
      failureCount: pushResponse.failureCount,
      invalidTokenCount: invalidTokens.length,
      reason: pushResponse.successCount > 0 ? "sent" : "send-failed",
    });
  }

  return {
    success: true,
    generatedAt: snapshot.generatedAt,
    csvVersion,
    csvModifiedAt,
    trigger,
    dryRun,
    enforceDailyOnce: shouldEnforceDailyOnce,
    enforceCsvVersionOnce: shouldEnforceDailyOnce,
    locationCount: snapshot.locationCount,
    locationsWithLowStock: snapshot.locationsWithLowStock,
    totalLowProducts: snapshot.totalLowProducts,
    locations: snapshot.locations,
    notifyResults,
  };
}

module.exports = {
  normalizePackKey,
  normalizeCodeKey,
  sanitizeRuleRows,
  evaluateLowStock,
  saveLocationLowStockSettings,
  getLocationLowStockSettings,
  runLowStockCheckAndNotify,
};
