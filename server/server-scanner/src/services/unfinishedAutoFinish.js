const { prisma } = require("../prisma");
const { loadMasterProducts } = require("./masterProducts");

let dailyTimerHandle = null;
let runInFlight = false;

function normalizeItemCode(value) {
  return String(value || "").trim().toLowerCase();
}

function formatTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString();
}

function getNextLocalMidnight() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next;
}

async function moveUnfinishedRowToFinishedTx(tx, unfinished, eventAction) {
  const finishedByWorkerId = unfinished.lastUpdatedByWorkerId || null;

  const finished = await tx.cycleFinishedStock.upsert({
    where: {
      cycleId_itemCode_shopLocationId_activityDate: {
        cycleId: unfinished.cycleId,
        itemCode: unfinished.itemCode,
        shopLocationId: unfinished.shopLocationId,
        activityDate: unfinished.activityDate,
      },
    },
    create: {
      cycleId: unfinished.cycleId,
      itemCode: unfinished.itemCode,
      itemName: unfinished.itemName,
      brandName: unfinished.brandName,
      packValue: unfinished.packValue,
      bpc: unfinished.bpc,
      mrp: unfinished.mrp,
      barcode: unfinished.barcode,
      phoneId: unfinished.phoneId,
      phoneName: unfinished.phoneName,
      shopLocationId: unfinished.shopLocationId,
      activityDate: unfinished.activityDate,
      quantityBottles: unfinished.quantityBottles,
      currentStockBottles: unfinished.currentStockBottles,
      diffBottles: unfinished.diffBottles,
      isMatched: unfinished.isMatched,
      matchedAt: unfinished.isMatched ? new Date() : null,
      lastUpdatedByWorkerId: unfinished.lastUpdatedByWorkerId,
      finishedByWorkerId,
      sourceUnfinishedId: unfinished.id,
    },
    update: {
      quantityBottles: unfinished.quantityBottles,
      currentStockBottles: unfinished.currentStockBottles,
      diffBottles: unfinished.diffBottles,
      isMatched: unfinished.isMatched,
      matchedAt: unfinished.isMatched ? new Date() : null,
      phoneId: unfinished.phoneId,
      phoneName: unfinished.phoneName,
      lastUpdatedByWorkerId: unfinished.lastUpdatedByWorkerId,
      finishedByWorkerId,
      sourceUnfinishedId: unfinished.id,
      finishedAt: new Date(),
    },
  });

  await tx.cycleProductEvent.create({
    data: {
      cycleId: unfinished.cycleId,
      itemCode: unfinished.itemCode,
      itemName: unfinished.itemName,
      brandName: unfinished.brandName,
      packValue: unfinished.packValue,
      shopLocationId: unfinished.shopLocationId,
      cycleUnfinishedId: unfinished.id,
      cycleFinishedId: finished.id,
      activityDate: unfinished.activityDate,
      eventScope: "finished",
      eventAction,
      matched: unfinished.isMatched,
      stockBottlesAfter: unfinished.quantityBottles,
      currentStockBottles: unfinished.currentStockBottles,
      diffBottles: unfinished.diffBottles,
      workerId: finishedByWorkerId,
      phoneId: unfinished.phoneId,
      phoneName: unfinished.phoneName,
      changesJson: JSON.stringify({ action: "auto_move_unfinished_to_finished" }),
    },
  });

  await tx.cycleUnfinishedStock.delete({ where: { id: unfinished.id } });
}

async function runUnfinishedAutoFinish(trigger = "manual") {
  if (runInFlight) {
    console.log(`Unfinished auto-finish: skipped trigger=${trigger} because a run is already in progress`);
    return { success: false, skipped: true, reason: "already-running" };
  }

  runInFlight = true;
  try {
    const activeCycle = await prisma.cycle.findFirst({
      where: { status: "active" },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
    });

    if (!activeCycle) {
      console.log(`Unfinished auto-finish: trigger=${trigger}, no active cycle`);
      return { success: true, skipped: true, reason: "no-active-cycle", movedCount: 0 };
    }

    const [masterRows, unfinishedRows] = await Promise.all([
      loadMasterProducts(),
      prisma.cycleUnfinishedStock.findMany({
        where: { cycleId: activeCycle.id },
        orderBy: [{ activityDate: "asc" }, { id: "asc" }],
      }),
    ]);

    const masterCodeSet = new Set(
      masterRows.map((row) => normalizeItemCode(row.itemCode)).filter(Boolean)
    );
    const eligibleRows = unfinishedRows.filter((row) =>
      masterCodeSet.has(normalizeItemCode(row.itemCode))
    );

    if (eligibleRows.length === 0) {
      console.log(
        `Unfinished auto-finish: trigger=${trigger}, cycleId=${activeCycle.id}, moved=0`
      );
      return {
        success: true,
        skipped: true,
        reason: "no-unfinished-rows",
        cycleId: activeCycle.id,
        movedCount: 0,
      };
    }

    const movedSummary = await prisma.$transaction(async (tx) => {
      const byLocation = new Map();
      for (const row of eligibleRows) {
        await moveUnfinishedRowToFinishedTx(tx, row, "auto_finish_daily");
        const nextCount = Number(byLocation.get(row.shopLocationId) || 0) + 1;
        byLocation.set(row.shopLocationId, nextCount);
      }
      return Array.from(byLocation.entries()).map(([shopLocationId, count]) => ({
        shopLocationId,
        count,
      }));
    });

    console.log(
      `Unfinished auto-finish: trigger=${trigger}, cycleId=${activeCycle.id}, moved=${eligibleRows.length}, byLocation=${movedSummary
        .map((row) => `${row.shopLocationId}:${row.count}`)
        .join(" | ")}`
    );

    return {
      success: true,
      cycleId: activeCycle.id,
      movedCount: eligibleRows.length,
      movedByLocation: movedSummary,
    };
  } catch (error) {
    console.error(`Unfinished auto-finish failed (${trigger}):`, error);
    return { success: false, skipped: false, reason: error.message || "unknown-error" };
  } finally {
    runInFlight = false;
  }
}

function scheduleNextMidnightRun() {
  const nextRunAt = getNextLocalMidnight();
  const delayMs = Math.max(1000, nextRunAt.getTime() - Date.now());
  dailyTimerHandle = setTimeout(async () => {
    await runUnfinishedAutoFinish("daily_midnight");
    scheduleNextMidnightRun();
  }, delayMs);
  if (typeof dailyTimerHandle.unref === "function") {
    dailyTimerHandle.unref();
  }
  console.log(
    `Unfinished auto-finish scheduled for ${formatTimestamp(nextRunAt)}`
  );
}

async function startUnfinishedAutoFinishService() {
  if (dailyTimerHandle) return;
  await runUnfinishedAutoFinish("service_startup");
  scheduleNextMidnightRun();
}

function stopUnfinishedAutoFinishService() {
  if (!dailyTimerHandle) return;
  clearTimeout(dailyTimerHandle);
  dailyTimerHandle = null;
  console.log("Unfinished auto-finish stopped.");
}

module.exports = {
  runUnfinishedAutoFinish,
  startUnfinishedAutoFinishService,
  stopUnfinishedAutoFinishService,
};
