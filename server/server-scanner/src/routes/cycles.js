const express = require("express");
const { prisma } = require("../prisma");
const { verifySettingsPassword } = require("../services/settingsPassword");
const stockRouter = require("./stock");
const { printFullCycleVerification } = stockRouter;

const router = express.Router();

function toValidDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function closeActiveCycle(tx, endDate = new Date()) {
  const active = await tx.cycle.findFirst({ where: { status: "active" } });
  if (!active) return { closed: null };

  const updated = await tx.cycle.update({
    where: { id: active.id },
    data: {
      status: "inactive",
      endDate,
    },
  });

  return { closed: updated };
}

async function getCycleCloseGuard(db, cycleId) {
  const [unfinishedCount, unmatchedFinishedCount] = await Promise.all([
    db.cycleUnfinishedStock.count({ where: { cycleId } }),
    db.cycleFinishedStock.count({ where: { cycleId, isMatched: false } }),
  ]);

  const closeAllowed = unfinishedCount === 0 && unmatchedFinishedCount === 0;

  return {
    closeAllowed,
    unfinishedCount,
    unmatchedFinishedCount,
  };
}

router.get("/current", async (req, res) => {
  const active = await prisma.cycle.findFirst({ where: { status: "active" } });
  if (!active) {
    return res.json({ success: true, active: false, cycle: null });
  }
  return res.json({ success: true, active: true, cycle: active });
});

router.get("/active-summary", async (req, res) => {
  const active = await prisma.cycle.findFirst({ where: { status: "active" } });
  if (!active) {
    return res.json({
      success: true,
      active: false,
      cycle: null,
      cycleSno: null,
      cycleStartDate: null,
      closeAllowed: false,
      closeGuard: {
        unfinishedCount: 0,
        unmatchedFinishedCount: 0,
      },
    });
  }

  const closeGuard = await getCycleCloseGuard(prisma, active.id);

  return res.json({
    success: true,
    active: true,
    cycle: active,
    cycleSno: active.sno ?? null,
    cycleStartDate: active.startDate,
    closeAllowed: closeGuard.closeAllowed,
    closeGuard: {
      unfinishedCount: closeGuard.unfinishedCount,
      unmatchedFinishedCount: closeGuard.unmatchedFinishedCount,
    },
  });
});

router.get("/all", async (req, res) => {
  const cycles = await prisma.cycle.findMany({ orderBy: { startDate: "desc" } });
  return res.json({ success: true, count: cycles.length, cycles });
});

router.post("/start", async (req, res) => {
  const active = await prisma.cycle.findFirst({ where: { status: "active" } });
  if (active) {
    return res.status(400).json({
      success: false,
      message: "An active cycle already exists",
      cycle: active,
    });
  }

  const startDate = toValidDate(req.body?.startDate, new Date());
  if (!startDate) {
    return res.status(400).json({ success: false, message: "Invalid startDate" });
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

  return res.json({ success: true, cycle });
});

router.post("/stop", async (req, res) => {
  const { cycleId, endDate } = req.body || {};
  let cycle = null;

  if (cycleId) {
    cycle = await prisma.cycle.findUnique({ where: { id: Number(cycleId) } });
  } else {
    cycle = await prisma.cycle.findFirst({ where: { status: "active" } });
  }

  if (!cycle) {
    return res.status(404).json({ success: false, message: "Cycle not found" });
  }

  const resolvedEnd = endDate ? new Date(endDate) : new Date();
  if (Number.isNaN(resolvedEnd.getTime())) {
    return res.status(400).json({ success: false, message: "Invalid endDate" });
  }

  const closeGuard = await getCycleCloseGuard(prisma, cycle.id);
  if (!closeGuard.closeAllowed) {
    return res.status(409).json({
      success: false,
      message: `Cannot close cycle. Unfinished: ${closeGuard.unfinishedCount}, Unmatched finished: ${closeGuard.unmatchedFinishedCount}`,
      closeAllowed: false,
      closeGuard: {
        unfinishedCount: closeGuard.unfinishedCount,
        unmatchedFinishedCount: closeGuard.unmatchedFinishedCount,
      },
    });
  }

  const updated = await prisma.cycle.update({
    where: { id: cycle.id },
    data: {
      status: "inactive",
      endDate: resolvedEnd,
    },
  });

  let print = null;
  try {
    print = await printFullCycleVerification({
      cycleId: updated.id,
      endDate: resolvedEnd,
    });
  } catch (error) {
    print = {
      success: false,
      skipped: false,
      message:
        error instanceof Error ? error.message : "Failed to print full-cycle verification",
    };
  }

  return res.json({ success: true, cycle: updated, print });
});

router.post("/force-close", async (req, res) => {
  const passwordCandidate = String(req.body?.password || "");
  const passwordResult = verifySettingsPassword(passwordCandidate);
  if (!passwordResult.verified) {
    return res.status(401).json({ success: false, message: "Invalid force close password" });
  }

  const startNew = Boolean(req.body?.startNew);
  const closeAt = toValidDate(req.body?.endDate, new Date());
  if (!closeAt) {
    return res.status(400).json({ success: false, message: "Invalid endDate" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const { closed } = await closeActiveCycle(tx, closeAt);
    if (!closed) {
      return { closed: null, started: null };
    }

    if (!startNew) {
      return { closed, started: null };
    }

    const nextStart = toValidDate(req.body?.startDate, new Date());
    if (!nextStart) {
      throw new Error("Invalid startDate");
    }

    const maxSno = await tx.cycle.aggregate({ _max: { sno: true } });
    const sno = (maxSno?._max?.sno || 0) + 1;

    const started = await tx.cycle.create({
      data: {
        sno,
        startDate: nextStart,
        status: "active",
      },
    });

    return { closed, started };
  });

  if (!result.closed) {
    return res.status(404).json({ success: false, message: "No active cycle to force close" });
  }

  return res.json({
    success: true,
    closedCycle: result.closed,
    startedCycle: result.started,
  });
});

module.exports = router;
