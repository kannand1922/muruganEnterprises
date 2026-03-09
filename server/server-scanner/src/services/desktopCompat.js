const fs = require("fs");
const path = require("path");
const { prisma } = require("../prisma");
const { loadMasterProducts } = require("./masterProducts");
const { getMasterMaxAgeMinutes, formatTimestampIST } = require("./masterStatus");
const { stockLensPaths } = require("../../../../shared/config/paths");

const DESKTOP_DEFAULT_LOCATION_SETTING_KEY = "desktop_default_location_code";

function normalizeLocationKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function getDayRange(dateKey) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return null;
  }
  const start = new Date(`${key}T00:00:00.000Z`);
  const end = new Date(`${key}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  return { dayKey: key, start, end };
}

function isGodownLike(value) {
  const normalized = normalizeLocationKey(value);
  return (
    normalized.includes("godown") ||
    normalized.includes("goddown") ||
    normalized.includes("godwn") ||
    normalized.includes("warehouse")
  );
}

function parseStockStringToBottles(stock, bpc) {
  const raw = String(stock || "").trim();
  if (!raw) return 0;

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [casesPart = "0", bottlesPart = "0"] = unsigned.split(".");
  const cases = Math.max(0, Number.parseInt(casesPart, 10) || 0);
  const bottles = Math.max(0, Number.parseInt(bottlesPart, 10) || 0);
  const safeBpc = Math.max(1, Number(bpc) || 1);
  const total = cases * safeBpc + bottles;
  return negative ? -total : total;
}

function toCasesBottles(totalBottles, bpc) {
  const safeBpc = Math.max(1, Number(bpc) || 1);
  const absolute = Math.abs(Math.trunc(Number(totalBottles) || 0));
  const cases = Math.floor(absolute / safeBpc);
  const bottles = absolute % safeBpc;
  return {
    total: Math.trunc(Number(totalBottles) || 0),
    cases,
    bottles,
  };
}

function getMasterStockBottles(master, location) {
  const safeBpc = Number(master?.bpc) || 12;
  const locationCodeKey = normalizeLocationKey(location?.locationCode);
  const locationNameKey = normalizeLocationKey(location?.locationName);
  const locationTypeKey = normalizeLocationKey(location?.locationType);
  const locationStocks = master?.locationStocks || {};

  const byLocationCode = locationCodeKey ? String(locationStocks[locationCodeKey] ?? "").trim() : "";
  const byLocationName = locationNameKey ? String(locationStocks[locationNameKey] ?? "").trim() : "";
  const byLocationType = locationTypeKey ? String(locationStocks[locationTypeKey] ?? "").trim() : "";

  const fallback =
    byLocationCode ||
    byLocationName ||
    byLocationType ||
    (isGodownLike(locationTypeKey) || isGodownLike(locationNameKey) || isGodownLike(locationCodeKey)
      ? master?.godownStock
      : "") ||
    (locationTypeKey === "shop" || locationNameKey === "shop" || locationCodeKey === "shop"
      ? master?.shopStock
      : "") ||
    master?.shopStock ||
    master?.godownStock ||
    "0";

  return parseStockStringToBottles(fallback, safeBpc);
}

function getRowTimeMs(row, scope) {
  if (!row) return 0;
  const candidates = [
    row.updatedAt,
    row.finishedAt,
    row.stateUpdatedAt,
    row.activityDate,
    row.createdAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = new Date(candidate).getTime();
    if (Number.isFinite(value)) {
      // Finished wins on tie by adding tiny priority value.
      return scope === "finished" ? value + 0.5 : value;
    }
  }

  return 0;
}

function toDateKeyFromMs(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function isRowEligibleForAnalysisDate(row, scope, dayRange) {
  if (!dayRange) return true;
  const timeMs = getRowTimeMs(row, scope);
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return false;
  }
  return timeMs <= dayRange.end.getTime();
}

function sortProductsByName(rows) {
  return [...rows].sort((a, b) => {
    const brandCompare = String(a.brand || "").localeCompare(String(b.brand || ""));
    if (brandCompare !== 0) return brandCompare;
    const packCompare = Number(a.pack || 0) - Number(b.pack || 0);
    if (packCompare !== 0) return packCompare;
    return String(a.code || "").localeCompare(String(b.code || ""));
  });
}

function formatMasterRowForLegacy(master, index = 0) {
  return {
    "Sl.": index + 1,
    Item: master.itemName || "",
    Brand: master.brandName || "",
    Pack: master.packValue || "",
    Code: master.itemCode || "",
    BPC: master.bpc ?? "",
    MRP: master.mrp ?? "",
    BarCode: master.barcode || "",
    Shop: master.shopStock || "0.000",
    Godown: master.godownStock || "0.000",
  };
}

function parseMasterMetadata() {
  try {
    const raw = fs.readFileSync(stockLensPaths.brandsCsv, "utf8");
    const lines = raw.split(/\r?\n/).slice(0, 3);

    const normalizeLine = (line) =>
      String(line || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ")
        .trim();

    const title = normalizeLine(lines[0]);
    const subtitle = normalizeLine(lines[1]);
    const dateText = normalizeLine(lines[2]).replace(/^As\s*on\s*:\s*/i, "");

    return {
      title: title || "",
      subtitle: subtitle || "",
      date: dateText || "",
      sourceFile: path.resolve(stockLensPaths.brandsCsv),
    };
  } catch {
    return {
      title: "",
      subtitle: "",
      date: "",
      sourceFile: path.resolve(stockLensPaths.brandsCsv),
    };
  }
}

async function getLocationsWithDefault() {
  const [locations, setting] = await Promise.all([
    prisma.shopLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.appSetting.findUnique({ where: { key: DESKTOP_DEFAULT_LOCATION_SETTING_KEY } }),
  ]);

  const normalizedRows = locations.map((row) => ({
    ...row,
    locationCode: String(row.locationCode || "").trim(),
  }));

  const validCodeSet = new Set(normalizedRows.map((row) => row.locationCode));
  const configuredCode = String(setting?.value || "").trim();
  const defaultLocationCode =
    configuredCode && validCodeSet.has(configuredCode)
      ? configuredCode
      : normalizedRows[0]?.locationCode || null;

  return {
    rows: normalizedRows,
    defaultLocationCode,
  };
}

function resolveLocationFromRows(rows, locationCode) {
  const requested = String(locationCode || "").trim();
  if (!requested) {
    return null;
  }
  return rows.find((row) => row.locationCode === requested) || null;
}

async function resolveCycleByDate(cycleDate) {
  const key = String(cycleDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return null;
  }

  const cycles = await prisma.cycle.findMany({
    orderBy: [{ startDate: "desc" }],
  });

  return cycles.find((row) => toDateKey(row.startDate) === key) || null;
}

function toLegacyCycle(cycle, active = false) {
  if (!cycle) {
    return {
      success: true,
      active: false,
      id: null,
      cycleId: null,
      sno: null,
      startDate: null,
      endDate: null,
      status: "inactive",
    };
  }

  return {
    success: true,
    active,
    id: cycle.id,
    cycleId: cycle.id,
    sno: cycle.sno,
    startDate: toDateKey(cycle.startDate),
    endDate: cycle.endDate ? toDateKey(cycle.endDate) : null,
    status: cycle.status,
    cycle,
  };
}

async function buildComparePayload({ cycle, location, analysisDate = "" }) {
  const dayRange = analysisDate ? getDayRange(analysisDate) : null;
  const [masterRows, finishedRows, unfinishedRows] = await Promise.all([
    loadMasterProducts(),
    prisma.cycleFinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId: location.id,
      },
      orderBy: [{ updatedAt: "desc" }, { finishedAt: "desc" }, { id: "desc" }],
    }),
    prisma.cycleUnfinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId: location.id,
      },
      orderBy: [{ stateUpdatedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const latestByCode = new Map();
  const latestFinishedByCode = new Map();

  const upsertLatest = (row, scope) => {
    const codeKey = String(row.itemCode || "").trim().toLowerCase();
    if (!codeKey) return;

    const current = latestByCode.get(codeKey);
    const nextTime = getRowTimeMs(row, scope);

    if (!current || nextTime >= current.timeMs) {
      latestByCode.set(codeKey, { row, scope, timeMs: nextTime });
    }
  };

  const upsertLatestFinished = (row) => {
    const codeKey = String(row.itemCode || "").trim().toLowerCase();
    if (!codeKey) return;

    const current = latestFinishedByCode.get(codeKey);
    const nextTime = getRowTimeMs(row, "finished");

    if (!current || nextTime >= current.timeMs) {
      latestFinishedByCode.set(codeKey, {
        row,
        scope: "finished",
        timeMs: nextTime,
      });
    }
  };

  finishedRows.forEach((row) => {
    if (isRowEligibleForAnalysisDate(row, "finished", dayRange)) {
      upsertLatest(row, "finished");
      upsertLatestFinished(row);
    }
  });
  unfinishedRows.forEach((row) => {
    if (isRowEligibleForAnalysisDate(row, "unfinished", dayRange)) {
      upsertLatest(row, "unfinished");
    }
  });

  const matched = [];
  const unmatched = [];
  const nonScanned = [];

  let totalMasterBottles = 0;
  let totalScannedBottles = 0;
  let totalDiffBottles = 0;

  for (const master of masterRows) {
    const code = String(master.itemCode || "").trim();
    if (!code) continue;

    const masterTotal = getMasterStockBottles(master, location);
    if (masterTotal <= 0) continue;

    totalMasterBottles += masterTotal;

    const bpc = Number(master.bpc) || 12;
    const codeKey = code.toLowerCase();
    const latest = latestByCode.get(codeKey) || null;
    const masterBreakdown = toCasesBottles(masterTotal, bpc);

    const baseProduct = {
      code,
      item: master.itemName || "",
      brand: master.brandName || "",
      pack: master.packValue || "",
      bpc,
      mrp: master.mrp ?? 0,
      barcode: master.barcode || "",
      master: masterBreakdown,
      masterExists: true,
    };

    if (!latest) {
      nonScanned.push(baseProduct);
      continue;
    }

    const toProductSnapshot = (snapshot) => {
      const scannedTotal = Math.trunc(Number(snapshot?.row?.quantityBottles || 0));
      const scanned = toCasesBottles(scannedTotal, bpc);
      const diffTotal = Math.trunc(Number(snapshot?.row?.diffBottles || 0));
      const diffBreakdown = toCasesBottles(diffTotal, bpc);

      return {
        ...baseProduct,
        scanned,
        difference: {
          ...diffBreakdown,
          sign: diffTotal > 0 ? "+" : diffTotal < 0 ? "-" : "",
        },
        updatedAt:
          snapshot.row.updatedAt ||
          snapshot.row.finishedAt ||
          snapshot.row.stateUpdatedAt ||
          snapshot.row.activityDate,
        source: snapshot.scope,
      };
    };

    const scannedTotal = Math.trunc(Number(latest.row.quantityBottles || 0));
    totalScannedBottles += scannedTotal;
    totalDiffBottles += Math.trunc(Number(latest.row.diffBottles || 0));
    const latestFinished = latestFinishedByCode.get(codeKey) || null;
    const latestFinishedProduct = latestFinished ? toProductSnapshot(latestFinished) : null;

    if (latestFinishedProduct && latestFinishedProduct.difference.total > 0) {
      unmatched.push(latestFinishedProduct);
      continue;
    }

    matched.push(toProductSnapshot(latest));
  }

  const totalMasterProducts = matched.length + unmatched.length + nonScanned.length;
  const unmatchedCount = unmatched.length;
  const nonScannedCount = nonScanned.length;
  const matchedCount = matched.length;
  const totalDifference = totalDiffBottles;

  return {
    success: true,
    cycleDate: toDateKey(cycle.startDate),
    location: location.locationCode,
    analysisDate: dayRange ? dayRange.dayKey : null,
    summary: {
      totalMasterProducts,
      matchedCount,
      unmatchedCount,
      nonScannedCount,
      accuracyPercentage:
        totalMasterProducts > 0
          ? Number(((matchedCount / totalMasterProducts) * 100).toFixed(2))
          : 0,
      totalMasterBottles,
      totalScannedBottles,
      totalDifference,
    },
    matched: sortProductsByName(matched),
    unmatched: sortProductsByName(unmatched),
    nonScanned: sortProductsByName(nonScanned),
  };
}

async function buildBestSellingPayload({ cycle, location, analysisDate = "" }) {
  const dayRange = analysisDate ? getDayRange(analysisDate) : null;

  const [bestSellingRows, masterRows, finishedRows, unfinishedRows, eventRows] = await Promise.all([
    prisma.bestSellingProduct.findMany({ orderBy: [{ id: "asc" }] }),
    loadMasterProducts(),
    prisma.cycleFinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId: location.id,
      },
      orderBy: [{ updatedAt: "desc" }, { finishedAt: "desc" }, { id: "desc" }],
    }),
    prisma.cycleUnfinishedStock.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId: location.id,
      },
      orderBy: [{ stateUpdatedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    }),
    prisma.cycleProductEvent.findMany({
      where: {
        cycleId: cycle.id,
        shopLocationId: location.id,
      },
      orderBy: [{ eventTime: "desc" }, { id: "desc" }],
    }),
  ]);

  const masterByCode = new Map(
    masterRows.map((row) => [String(row.itemCode || "").trim().toLowerCase(), row])
  );
  const eligibleBestSellingRows = bestSellingRows.filter((row) => {
    const code = String(row.itemCode || "").trim().toLowerCase();
    return code && masterByCode.has(code);
  });

  const rowsByCode = new Map();

  const pushRow = (row, scope) => {
    const codeKey = String(row.itemCode || "").trim().toLowerCase();
    if (!codeKey) return;
    if (!rowsByCode.has(codeKey)) {
      rowsByCode.set(codeKey, []);
    }
    rowsByCode.get(codeKey).push({ row, scope, timeMs: getRowTimeMs(row, scope) });
  };

  finishedRows.forEach((row) => pushRow(row, "finished"));
  unfinishedRows.forEach((row) => pushRow(row, "unfinished"));

  const distinctActivityDays = new Set();
  const trackedCodeSet = new Set(
    eligibleBestSellingRows
      .map((row) => String(row.itemCode || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const eventByCodeDay = new Map();
  eventRows.forEach((event) => {
    const codeKey = String(event.itemCode || "").trim().toLowerCase();
    if (!codeKey) return;
    if (!trackedCodeSet.has(codeKey)) return;
    const eventTimeMs = new Date(
      event.eventTime || event.createdAt || event.activityDate || Date.now()
    ).getTime();
    const dayKey = toDateKeyFromMs(eventTimeMs);
    if (!dayKey) return;

    distinctActivityDays.add(dayKey);
    if (!eventByCodeDay.has(codeKey)) {
      eventByCodeDay.set(codeKey, new Map());
    }
    const dailyMap = eventByCodeDay.get(codeKey);
    const current = dailyMap.get(dayKey);
    if (!current || eventTimeMs >= current.timeMs) {
      dailyMap.set(dayKey, {
        event,
        timeMs: eventTimeMs,
      });
    }
  });

  const products = [];

  for (const best of eligibleBestSellingRows) {
    const code = String(best.itemCode || "").trim();
    if (!code) continue;

    const codeKey = code.toLowerCase();
    const relatedRows = rowsByCode.get(codeKey) || [];
    const master = masterByCode.get(codeKey) || null;

    const bpc = Number(best.bpc || master?.bpc) || 12;
    const masterTotal = getMasterStockBottles(master, location);
    const masterBreakdown = toCasesBottles(masterTotal, bpc);

    const byDay = new Map();
    relatedRows.forEach((entry) => {
      const dayKey = toDateKeyFromMs(entry.timeMs);
      if (!dayKey) return;
      distinctActivityDays.add(dayKey);
      const current = byDay.get(dayKey);
      if (!current || entry.timeMs >= current.timeMs) {
        byDay.set(dayKey, entry);
      }
    });

    const eventsByDay = eventByCodeDay.get(codeKey) || new Map();
    const historyDaySet = new Set([...byDay.keys(), ...eventsByDay.keys()]);

    const history = Array.from(historyDaySet)
      .map((day) => {
        const rowEntry = byDay.get(day) || null;
        const eventEntry = eventsByDay.get(day) || null;
        const total = rowEntry
          ? Math.trunc(Number(rowEntry.row.quantityBottles || 0))
          : Math.trunc(Number(eventEntry?.event?.stockBottlesAfter || 0));
        const breakdown = toCasesBottles(total, bpc);
        return {
          date: day,
          total: breakdown.total,
          cases: breakdown.cases,
          bottles: breakdown.bottles,
          checked: Boolean(eventEntry),
          lastUpdated: rowEntry
            ? (
                rowEntry.row.updatedAt ||
                rowEntry.row.finishedAt ||
                rowEntry.row.stateUpdatedAt ||
                null
              )
            : eventEntry?.event?.eventTime
              ? new Date(eventEntry.event.eventTime).toISOString()
              : null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const latest = relatedRows.length
      ? [...relatedRows].sort((a, b) => b.timeMs - a.timeMs)[0]
      : null;

    const currentFromRows = dayRange ? byDay.get(dayRange.dayKey) || null : latest;
    const currentFromEvents = dayRange ? eventsByDay.get(dayRange.dayKey) || null : null;

    const currentTotal = currentFromRows
      ? Math.trunc(Number(currentFromRows.row.quantityBottles || 0))
      : currentFromEvents
        ? Math.trunc(Number(currentFromEvents.event?.stockBottlesAfter || 0))
        : 0;
    const latestTotal = latest ? Math.trunc(Number(latest.row.quantityBottles || 0)) : 0;
    const remainingTotal = masterTotal - currentTotal;
    const hasDailyCheck = dayRange
      ? eventsByDay.has(dayRange.dayKey)
      : eventsByDay.size > 0 || Boolean(latest);

    products.push({
      code,
      item: best.itemName || master?.itemName || "",
      brand: best.brandName || master?.brandName || "",
      pack: best.packValue || master?.packValue || "",
      bpc,
      mrp: master?.mrp || null,
      barcode: master?.barcode || "",
      master: masterBreakdown,
      current: currentFromRows || currentFromEvents
        ? {
            ...toCasesBottles(currentTotal, bpc),
            lastUpdated: currentFromRows
              ? (
                  currentFromRows.row.updatedAt ||
                  currentFromRows.row.finishedAt ||
                  currentFromRows.row.stateUpdatedAt ||
                  null
                )
              : currentFromEvents?.event?.eventTime
                ? new Date(currentFromEvents.event.eventTime).toISOString()
                : null,
          }
        : null,
      latest: latest
        ? {
            ...toCasesBottles(latestTotal, bpc),
            lastUpdated: latest.row.updatedAt
              ? new Date(latest.row.updatedAt).toISOString()
              : null,
          }
        : null,
      remaining: toCasesBottles(remainingTotal, bpc),
      status: hasDailyCheck ? "scanned" : "pending",
      history,
    });
  }

  const summary = products.reduce(
    (acc, product) => {
      acc.totalTrackedProducts += 1;
      if (product.status === "scanned") {
        acc.scannedProductCount += 1;
        acc.totalScannedBottles += product.current?.total || 0;
      }
      acc.totalRemainingBottles += Math.max(0, product.remaining.total);
      return acc;
    },
    {
      trackedProducts: 0,
      totalTrackedProducts: 0,
      scannedProductCount: 0,
      notScannedProductCount: 0,
      totalScannedBottles: 0,
      totalRemainingBottles: 0,
      distinctActivityDays: Array.from(distinctActivityDays).sort(),
    }
  );

  summary.trackedProducts = summary.totalTrackedProducts;
  summary.notScannedProductCount =
    summary.totalTrackedProducts - summary.scannedProductCount;

  return {
    success: true,
    cycleDate: toDateKey(cycle.startDate),
    location: location.locationCode,
    analysisDate: dayRange ? dayRange.dayKey : null,
    summary,
    trackedProducts: summary.totalTrackedProducts,
    products: sortProductsByName(products),
  };
}

function buildChangePayload(event, location) {
  const locationCode = String(location?.locationCode || "").trim() || "location";
  const currentValue = Number(event?.currentStockBottles ?? 0);
  const scannedValue = Number(event?.stockBottlesAfter ?? 0);
  const diffValue = Number(event?.diffBottles ?? 0);

  return {
    [locationCode]: {
      from: currentValue,
      to: scannedValue,
    },
    diff: diffValue,
  };
}

async function buildCycleLogsPayload({ cycle }) {
  const [events, masterRows, finishedRows, unfinishedRows] = await Promise.all([
    prisma.cycleProductEvent.findMany({
      where: { cycleId: cycle.id },
      include: {
        worker: true,
        phone: true,
        shopLocation: true,
      },
      orderBy: [{ eventTime: "asc" }, { id: "asc" }],
    }),
    loadMasterProducts(),
    prisma.cycleFinishedStock.findMany({
      where: { cycleId: cycle.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
    prisma.cycleUnfinishedStock.findMany({
      where: { cycleId: cycle.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const masterByCode = new Map(
    masterRows.map((row) => [String(row.itemCode || "").trim().toLowerCase(), row])
  );

  const rowByCode = new Map();
  const ensureRow = (rawCode) => {
    const code = String(rawCode || "").trim();
    if (!code) return null;
    const key = code.toLowerCase();
    if (!rowByCode.has(key)) {
      const master = masterByCode.get(key) || null;
      rowByCode.set(key, {
        Brand: master?.brandName || "",
        Item: master?.itemName || "",
        Pack: master?.packValue || "",
        Code: code,
        BPC: master?.bpc ?? "",
        MRP: master?.mrp ?? "",
        BarCode: master?.barcode || "",
        Shop: master?.shopStock || "0.000",
        Godown: master?.godownStock || "0.000",
        ChangeLogEntries: [],
        UnfinishedLogEntries: [],
      });
    }
    return rowByCode.get(key);
  };

  finishedRows.forEach((row) => {
    const target = ensureRow(row.itemCode);
    if (!target) return;
    if (!target.Brand && row.brandName) target.Brand = row.brandName;
    if (!target.Item && row.itemName) target.Item = row.itemName;
    if (!target.Pack && row.packValue) target.Pack = row.packValue;
    if (!target.BPC && row.bpc) target.BPC = row.bpc;
    if (!target.MRP && row.mrp) target.MRP = row.mrp;
    if (!target.BarCode && row.barcode) target.BarCode = row.barcode;
  });

  unfinishedRows.forEach((row) => {
    const target = ensureRow(row.itemCode);
    if (!target) return;
    if (!target.Brand && row.brandName) target.Brand = row.brandName;
    if (!target.Item && row.itemName) target.Item = row.itemName;
    if (!target.Pack && row.packValue) target.Pack = row.packValue;
    if (!target.BPC && row.bpc) target.BPC = row.bpc;
    if (!target.MRP && row.mrp) target.MRP = row.mrp;
    if (!target.BarCode && row.barcode) target.BarCode = row.barcode;
  });

  events.forEach((event) => {
    const target = ensureRow(event.itemCode);
    if (!target) return;

    const location = event.shopLocation;
    const entry = {
      time: (event.eventTime || event.createdAt || new Date()).toISOString(),
      date: toDateKey(event.activityDate || event.eventTime || event.createdAt),
      action: event.eventAction || "updated",
      operatorName: event.worker?.name || "Unknown",
      user: event.worker?.name || "Unknown",
      phoneName: event.phone?.name || event.phoneName || null,
      location: location?.locationName || location?.locationCode || "Unknown",
      matched: typeof event.matched === "boolean" ? event.matched : null,
      isMatch: typeof event.matched === "boolean" ? event.matched : null,
      changes: buildChangePayload(event, location),
    };

    if (String(event.eventScope || "").toLowerCase() === "unfinished") {
      target.UnfinishedLogEntries.push(entry);
    } else {
      target.ChangeLogEntries.push(entry);
    }
  });

  const rows = Array.from(rowByCode.values())
    .map((row) => {
      const unfinished = row.UnfinishedLogEntries;
      const unfinishedContainer =
        unfinished.length > 0
          ? [
              {
                date: toDateKey(cycle.startDate),
                data: {
                  logs: unfinished,
                },
              },
            ]
          : [];

      return {
        Brand: row.Brand,
        Item: row.Item,
        Pack: row.Pack,
        Code: row.Code,
        BPC: row.BPC,
        MRP: row.MRP,
        BarCode: row.BarCode,
        Shop: row.Shop,
        Godown: row.Godown,
        ChangeLog: row.ChangeLogEntries.length ? JSON.stringify(row.ChangeLogEntries) : "",
        UnfinishedChangeLog: unfinishedContainer.length
          ? JSON.stringify(unfinishedContainer)
          : "",
      };
    })
    .sort((a, b) => {
      const brandCompare = String(a.Brand || "").localeCompare(String(b.Brand || ""));
      if (brandCompare !== 0) return brandCompare;
      return String(a.Pack || "").localeCompare(String(b.Pack || ""));
    });

  return {
    success: true,
    cycleDate: toDateKey(cycle.startDate),
    count: rows.length,
    data: rows,
  };
}

async function buildMissingBarcodesPayload() {
  const masterRows = await loadMasterProducts();
  const metadata = parseMasterMetadata();
  const products = masterRows
    .filter((row) => !String(row.barcode || "").trim())
    .map((row, index) => formatMasterRowForLegacy(row, index));

  return {
    success: true,
    count: products.length,
    products,
    metadata,
  };
}

function formatStockForLegacy(totalBottles, bpc) {
  const safeBpc = Math.max(1, Number(bpc) || 1);
  const total = Math.trunc(Number(totalBottles) || 0);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const cases = Math.floor(abs / safeBpc);
  const bottles = abs % safeBpc;
  return `${sign}${cases}.${String(bottles).padStart(3, "0")}`;
}

async function buildNilStockPayload(locationCode = "") {
  const [masterRows, shopInfo, locationMeta] = await Promise.all([
    loadMasterProducts(),
    prisma.shopInfo.findUnique({ where: { id: 1 } }),
    getLocationsWithDefault(),
  ]);

  const locations = locationMeta.rows;
  if (!locations.length) {
    return {
      success: true,
      count: 0,
      products: [],
      metadata: {
        ...parseMasterMetadata(),
        sourceLocation: null,
        targetLocation: null,
      },
    };
  }

  const nilLocationId = Number(shopInfo?.nilLocation || 0);
  const sourceLocation = locations.find((row) => row.id === nilLocationId) || null;
  const targetCandidates = sourceLocation
    ? locations.filter((row) => row.id !== sourceLocation.id)
    : [];

  let targetLocation = null;
  if (locationCode) {
    const resolved = resolveLocationFromRows(locations, locationCode);
    if (resolved && (!sourceLocation || resolved.id !== sourceLocation.id)) {
      targetLocation = resolved;
    }
  }
  if (!targetLocation) {
    targetLocation = targetCandidates[0] || null;
  }

  if (!sourceLocation || !targetLocation || sourceLocation.id === targetLocation.id) {
    return {
      success: true,
      count: 0,
      products: [],
      metadata: {
        ...parseMasterMetadata(),
        sourceLocation: sourceLocation
          ? {
              id: sourceLocation.id,
              code: sourceLocation.locationCode,
              name: sourceLocation.locationName,
            }
          : null,
        targetLocation: targetLocation
          ? {
              id: targetLocation.id,
              code: targetLocation.locationCode,
              name: targetLocation.locationName,
            }
          : null,
      },
    };
  }

  const products = [];
  for (const master of masterRows) {
    const bpc = Number(master.bpc) || 12;
    const sourceBottles = getMasterStockBottles(master, sourceLocation);
    const targetBottles = getMasterStockBottles(master, targetLocation);

    if (sourceBottles > 0 && targetBottles <= 0) {
      products.push({
        brand: master.brandName || "",
        item: master.itemName || "",
        pack: master.packValue || "",
        code: master.itemCode || "",
        bpc,
        mrp: master.mrp || 0,
        barcode: master.barcode || "",
        source: {
          id: sourceLocation.id,
          code: sourceLocation.locationCode,
          name: sourceLocation.locationName,
          bottles: sourceBottles,
          formatted: formatStockForLegacy(sourceBottles, bpc),
        },
        target: {
          id: targetLocation.id,
          code: targetLocation.locationCode,
          name: targetLocation.locationName,
          bottles: targetBottles,
          formatted: formatStockForLegacy(targetBottles, bpc),
        },
        // Legacy keys kept for old desktop modal table.
        godown: {
          total: sourceBottles,
          formatted: formatStockForLegacy(sourceBottles, bpc),
        },
        shop: {
          total: targetBottles,
          formatted: formatStockForLegacy(targetBottles, bpc),
        },
      });
    }
  }

  return {
    success: true,
    count: products.length,
    products,
    metadata: {
      ...parseMasterMetadata(),
      sourceLocation: {
        id: sourceLocation.id,
        code: sourceLocation.locationCode,
        name: sourceLocation.locationName,
      },
      targetLocation: {
        id: targetLocation.id,
        code: targetLocation.locationCode,
        name: targetLocation.locationName,
      },
    },
  };
}

async function getLegacyBrandsPayload() {
  const masterRows = await loadMasterProducts();
  const data = masterRows.map((row, index) => formatMasterRowForLegacy(row, index));
  return {
    success: true,
    count: data.length,
    data,
  };
}

async function getLegacyPrintersPayload() {
  const rows = await prisma.printer.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] });
  const data = rows.map((row) => ({
    "PRINTER NAME": row.name,
    IP: row.ipAddress,
    PORT: row.port,
  }));
  return {
    success: true,
    count: data.length,
    data,
  };
}

async function getLegacyOperatorsPayload() {
  const workers = await prisma.worker.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] });
  const operators = workers
    .map((row) => String(row.name || "").trim())
    .filter(Boolean);

  return {
    success: true,
    count: operators.length,
    operators,
    data: operators.map((name) => ({ Name: name })),
  };
}

function getBrandsStatusPayload() {
  const sourceFile = path.resolve(stockLensPaths.brandsCsv);
  if (!fs.existsSync(sourceFile)) {
    return {
      success: false,
      allowed: false,
      message: "brands.csv not found",
      sourceFile,
    };
  }

  const stats = fs.statSync(sourceFile);
  const lastModified = stats.mtime;
  const now = new Date();
  const ageMs = now.getTime() - lastModified.getTime();
  const ageMinutes = Math.floor(ageMs / 60000);
  const maxAgeMinutes = getMasterMaxAgeMinutes();
  const recent = ageMs <= maxAgeMinutes * 60 * 1000;

  return {
    success: true,
    allowed: recent,
    recent,
    maxAgeMinutes,
    ageMinutes,
    ageMs,
    lastModified: lastModified.toISOString(),
    lastModifiedIST: formatTimestampIST(lastModified),
    sourceFile,
  };
}

function generateLegacyVerificationReportHTML({
  cycleDate,
  location,
  locationLabel,
  summary,
  unmatched,
  nonScanned,
}) {
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  const renderRows = (rows) =>
    rows
      .map(
        (row) => `
      <tr>
        <td>${row.brand} ${row.pack ? `${row.pack}ml` : ""}</td>
        <td>${row.code || ""}</td>
      </tr>
    `
      )
      .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Verification Report - ${cycleDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold; color: black; }
    body { font-family: 'Roboto Condensed', sans-serif; font-size: 13px; line-height: 1.1; padding: 6px; max-width: 296px; background: white; }
    .center { text-align: center; }
    .separator { border-bottom: 2px solid #000; margin: 3px 0; }
    .line { margin: 2px 0; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 3px 0; table-layout: fixed; }
    th { padding: 2px 1px; text-align: left; border-bottom: 1px solid #000; font-size: 12px; }
    td { padding: 1px 1px; text-align: left; border: none; word-wrap: break-word; word-break: break-word; white-space: normal; font-size: 11px; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-weight: 900; font-size: 16px;">VERIFICATION REPORT</div>
    <div>${cycleDate}</div>
  </div>
  <div class="separator"></div>

  <div class="line">Location: ${locationLabel}</div>
  <div class="line">Code: ${location}</div>
  <div class="line">Total Products: ${summary.totalMasterProducts}</div>
  <div class="line">Matched: ${summary.matchedCount}</div>
  <div class="line">Unmatched: ${summary.unmatchedCount}</div>
  <div class="line">Unchecked: ${summary.nonScannedCount}</div>
  <div class="line">Master Bottles: ${summary.totalMasterBottles}</div>
  <div class="line">Scanned Bottles: ${summary.totalScannedBottles}</div>
  <div class="line">Diff Bottles: ${summary.totalDifference >= 0 ? "+" : ""}${summary.totalDifference}</div>

  <div class="separator"></div>

  <div style="font-size: 13px; font-weight: 900; margin: 3px 0;">Not Matched (${unmatched.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 70%;">Name</th>
        <th style="width: 30%;">Code</th>
      </tr>
    </thead>
    <tbody>
      ${unmatched.length ? renderRows(unmatched) : '<tr><td colspan="2">No unmatched items</td></tr>'}
    </tbody>
  </table>

  <div class="separator"></div>

  <div style="font-size: 13px; font-weight: 900; margin: 3px 0;">Unchecked (${nonScanned.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 70%;">Name</th>
        <th style="width: 30%;">Code</th>
      </tr>
    </thead>
    <tbody>
      ${nonScanned.length ? renderRows(nonScanned) : '<tr><td colspan="2">No unchecked items</td></tr>'}
    </tbody>
  </table>

  <div class="separator"></div>

  <div class="center" style="font-size: 11px; margin-top: 3px;">
    Generated: ${generatedAt}
  </div>
</body>
</html>
`;
}

async function sendHtmlToPrinterByIp({ printerIP, htmlContent, jobLabel, copies = 1, port = 9100, printerServiceBaseUrl }) {
  const endpoint = `${String(printerServiceBaseUrl || "").replace(/\/+$/, "")}/api/print/html`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      printerIP,
      port,
      htmlContent,
      jobLabel,
      copies,
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || `Print failed (${response.status})`);
  }

  return payload;
}

module.exports = {
  DESKTOP_DEFAULT_LOCATION_SETTING_KEY,
  normalizeLocationKey,
  toDateKey,
  getDayRange,
  getLocationsWithDefault,
  resolveLocationFromRows,
  resolveCycleByDate,
  toLegacyCycle,
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
};
