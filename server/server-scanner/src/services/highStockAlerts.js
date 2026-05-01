const { prisma } = require("../prisma");
const { loadMasterProducts } = require("./masterProducts");

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
    generalThresholdBottles: 0,
    highCount: 0,
    highRows: [],
  };
}

async function evaluateHighStock(options = {}) {
  const { shopLocationIds = null } = options;

  const requestedIds = Array.isArray(shopLocationIds)
    ? Array.from(new Set(shopLocationIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)))
    : [];

  const where = requestedIds.length > 0 ? { id: { in: requestedIds } } : {};

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
      locationsWithHighStock: 0,
      totalHighProducts: 0,
      locations: [],
    };
  }

  const locationIds = locations.map((row) => row.id);
  const [configs, packRules, productRules] = await Promise.all([
    prisma.highStockLocationConfig.findMany({ where: { shopLocationId: { in: locationIds } } }),
    prisma.highStockPackRule.findMany({ where: { shopLocationId: { in: locationIds } } }),
    prisma.highStockProductRule.findMany({ where: { shopLocationId: { in: locationIds } } }),
  ]);

  const packsByLocationId = new Map();
  const productsByLocationId = new Map();
  const configsByLocationId = new Map();

  for (const row of configs) {
    configsByLocationId.set(row.shopLocationId, row);
  }
  for (const row of packRules) {
    if (!packsByLocationId.has(row.shopLocationId)) packsByLocationId.set(row.shopLocationId, []);
    packsByLocationId.get(row.shopLocationId).push(row);
  }
  for (const row of productRules) {
    if (!productsByLocationId.has(row.shopLocationId)) productsByLocationId.set(row.shopLocationId, []);
    productsByLocationId.get(row.shopLocationId).push(row);
  }

  const snapshots = locations.map((location) => {
    const snapshot = getDefaultLocationSnapshot(location);
    const locationConfig = configsByLocationId.get(location.id) || null;
    snapshot.generalThresholdBottles = toPositiveInt(locationConfig?.generalThresholdBottles, 0) || 0;

    const maps = buildRuleMaps(
      packsByLocationId.get(location.id) || [],
      productsByLocationId.get(location.id) || []
    );

    const highRows = [];
    for (const row of masterRows) {
      const currentBottles = getMasterStockBottles(row, location);
      const { threshold, ruleType } = resolveThreshold(row, maps);
      const safeThreshold = toPositiveInt(threshold, 0);
      if (safeThreshold <= 0) continue;
      if (!ruleType) continue;
      if (currentBottles <= safeThreshold) continue;

      highRows.push({
        itemCode: String(row.itemCode || "").trim(),
        itemName: String(row.itemName || "").trim(),
        brandName: String(row.brandName || "").trim(),
        packValue: String(row.packValue || "").trim(),
        displayName: buildDisplayName(row),
        thresholdBottles: safeThreshold,
        currentBottles,
        excessBottles: currentBottles - safeThreshold,
        ruleType,
      });
    }

    highRows.sort((a, b) => {
      if (a.excessBottles !== b.excessBottles) {
        return b.excessBottles - a.excessBottles;
      }
      if (a.currentBottles !== b.currentBottles) {
        return b.currentBottles - a.currentBottles;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    snapshot.highRows = highRows;
    snapshot.highCount = highRows.length;

    return snapshot;
  });

  const locationsWithHighStock = snapshots.filter((row) => row.highCount > 0).length;
  const totalHighProducts = snapshots.reduce((sum, row) => sum + row.highCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    locationCount: snapshots.length,
    locationsWithHighStock,
    totalHighProducts,
    locations: snapshots,
  };
}

async function saveLocationHighStockSettings(shopLocationId, payload) {
  const normalizedLocationId = Number(shopLocationId);
  if (!Number.isFinite(normalizedLocationId) || normalizedLocationId <= 0) {
    throw new Error("Valid shopLocationId is required");
  }

  const generalThresholdBottles = 0;
  const packRules = sanitizeRuleRows(payload?.packRules, "pack");
  const productRules = sanitizeRuleRows(payload?.productRules, "product");

  await prisma.$transaction(async (tx) => {
    await tx.highStockLocationConfig.upsert({
      where: { shopLocationId: normalizedLocationId },
      create: {
        shopLocationId: normalizedLocationId,
        generalThresholdBottles,
      },
      update: {
        generalThresholdBottles,
      },
    });

    await tx.highStockPackRule.deleteMany({ where: { shopLocationId: normalizedLocationId } });
    await tx.highStockBrandRule.deleteMany({ where: { shopLocationId: normalizedLocationId } });
    await tx.highStockProductRule.deleteMany({ where: { shopLocationId: normalizedLocationId } });

    if (packRules.length > 0) {
      await tx.highStockPackRule.createMany({
        data: packRules.map((row) => ({
          shopLocationId: normalizedLocationId,
          packValue: row.packValue,
          normalizedPack: row.normalizedPack,
          thresholdBottles: row.thresholdBottles,
        })),
      });
    }

    if (productRules.length > 0) {
      await tx.highStockProductRule.createMany({
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

async function getLocationHighStockSettings(shopLocationId) {
  const normalizedLocationId = Number(shopLocationId);
  if (!Number.isFinite(normalizedLocationId) || normalizedLocationId <= 0) {
    throw new Error("Valid shopLocationId is required");
  }

  const [location, config, packRules, productRules] = await Promise.all([
    prisma.shopLocation.findUnique({ where: { id: normalizedLocationId } }),
    prisma.highStockLocationConfig.findUnique({ where: { shopLocationId: normalizedLocationId } }),
    prisma.highStockPackRule.findMany({ where: { shopLocationId: normalizedLocationId }, orderBy: [{ id: "asc" }] }),
    prisma.highStockProductRule.findMany({
      where: { shopLocationId: normalizedLocationId },
      orderBy: [{ id: "asc" }],
    }),
  ]);

  if (!location) {
    throw new Error("Shop location not found");
  }

  return {
    shopLocationId: normalizedLocationId,
    locationCode: location.locationCode,
    locationName: location.locationName,
    generalThresholdBottles: toPositiveInt(config?.generalThresholdBottles, 0) || 0,
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

module.exports = {
  normalizePackKey,
  normalizeCodeKey,
  sanitizeRuleRows,
  evaluateHighStock,
  saveLocationHighStockSettings,
  getLocationHighStockSettings,
};
