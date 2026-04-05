const { prisma } = require("../prisma");
const { centralPrisma } = require("../centralPrisma");

const MANAGED_WORKER_NAMES_KEY = "central_sync_managed_worker_names";
const MANAGED_BEST_SELLER_CODES_KEY = "central_sync_managed_best_seller_codes";

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

let syncPromise = null;
let lastSnapshotSignature = null;

const syncState = {
  running: false,
  mode: "manual",
  lastTrigger: null,
  lastCheckedAt: null,
  lastChangeDetectedAt: null,
  lastSyncedAt: null,
  lastError: null,
  lastSummary: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeOperators(rows) {
  return rows
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name || "").trim(),
      fatherName: row.fatherName == null ? null : String(row.fatherName || "").trim(),
      designationName:
        row.designation?.name != null
          ? String(row.designation.name || "").trim()
          : row.designationName == null
            ? null
            : String(row.designationName || "").trim(),
      dateOfBirth: row.dateOfBirth instanceof Date ? row.dateOfBirth.toISOString() : row.dateOfBirth,
      dateOfJoining: row.dateOfJoining instanceof Date ? row.dateOfJoining.toISOString() : row.dateOfJoining,
      dateOfResignation:
        row.dateOfResignation instanceof Date ? row.dateOfResignation.toISOString() : row.dateOfResignation,
      permanentAddress: row.permanentAddress == null ? null : String(row.permanentAddress),
      temporaryAddress: row.temporaryAddress == null ? null : String(row.temporaryAddress),
      aadhaarNumber: row.aadhaarNumber == null ? null : String(row.aadhaarNumber),
      email: row.email == null ? null : String(row.email),
      bankAccountNumber: row.bankAccountNumber == null ? null : String(row.bankAccountNumber),
      ifscCode: row.ifscCode == null ? null : String(row.ifscCode),
      recommendedBy: row.recommendedBy == null ? "Direct" : String(row.recommendedBy),
      workLocationName:
        row.workLocation?.name != null
          ? String(row.workLocation.name || "").trim()
          : row.workLocationName == null
            ? null
            : String(row.workLocationName || "").trim(),
      profileImageBase64: row.profileImageBase64 == null ? null : String(row.profileImageBase64),
      profileImageMimeType: row.profileImageMimeType == null ? null : String(row.profileImageMimeType),
      profileImageFileName: row.profileImageFileName == null ? null : String(row.profileImageFileName),
      resumeFileBase64: row.resumeFileBase64 == null ? null : String(row.resumeFileBase64),
      resumeFileMimeType: row.resumeFileMimeType == null ? null : String(row.resumeFileMimeType),
      resumeFileName: row.resumeFileName == null ? null : String(row.resumeFileName),
      aadhaarImageBase64: row.aadhaarImageBase64 == null ? null : String(row.aadhaarImageBase64),
      aadhaarImageMimeType: row.aadhaarImageMimeType == null ? null : String(row.aadhaarImageMimeType),
      aadhaarImageFileName: row.aadhaarImageFileName == null ? null : String(row.aadhaarImageFileName),
      phone: row.phone == null ? null : String(row.phone),
      phoneNumbers: Array.isArray(row.phoneNumbers)
        ? row.phoneNumbers.map((phoneRow) => ({
            label: phoneRow.label == null ? null : String(phoneRow.label),
            phoneNumber: String(phoneRow.phoneNumber || "").trim(),
            isPrimary: Boolean(phoneRow.isPrimary),
          }))
        : [],
      documents: Array.isArray(row.documents)
        ? row.documents.map((documentRow) => ({
            category: String(documentRow.category || "").trim(),
            label: documentRow.label == null ? null : String(documentRow.label),
            textValue: documentRow.textValue == null ? null : String(documentRow.textValue),
            fileName: documentRow.fileName == null ? null : String(documentRow.fileName),
            mimeType: documentRow.mimeType == null ? null : String(documentRow.mimeType),
            fileDataBase64: documentRow.fileDataBase64 == null ? null : String(documentRow.fileDataBase64),
            sortOrder: Number(documentRow.sortOrder || 0),
            active: Boolean(documentRow.active),
          }))
        : [],
      active: Boolean(row.active),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

function normalizeBestSellers(rows) {
  return rows
    .map((row) => ({
      id: Number(row.id),
      itemCode: String(row.itemCode || "").trim(),
      itemName: row.itemName == null ? null : String(row.itemName),
      brandName: row.brandName == null ? null : String(row.brandName),
      packValue: row.packValue == null ? null : String(row.packValue),
      active: Boolean(row.active),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    }))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.id - b.id);
}

async function readCentralCatalog(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const [operators, bestSellers] = await Promise.all([
    centralPrisma.operator.findMany({
      where: includeInactive ? undefined : { active: true },
      include: OPERATOR_RELATION_INCLUDE,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    centralPrisma.bestSeller.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: [{ itemCode: "asc" }, { id: "asc" }],
    }),
  ]);

  return {
    operators: normalizeOperators(operators),
    bestSellers: normalizeBestSellers(bestSellers),
  };
}

async function seedCentralCatalogFromLocalIfEmpty() {
  const [centralWorkerCount, centralBestSellerCount] = await Promise.all([
    centralPrisma.operator.count(),
    centralPrisma.bestSeller.count(),
  ]);

  if (centralWorkerCount === 0) {
    const localWorkers = await prisma.worker.findMany({
      include: OPERATOR_RELATION_INCLUDE,
      orderBy: [{ id: "asc" }],
    });
    for (const row of localWorkers) {
      const designation =
        row.designation?.name
          ? await centralPrisma.operatorDesignation.upsert({
              where: { name: row.designation.name },
              update: { active: true },
              create: { name: row.designation.name, active: true },
            })
          : null;
      const workLocation =
        row.workLocation?.name
          ? await centralPrisma.operatorWorkLocation.upsert({
              where: { name: row.workLocation.name },
              update: { active: true },
              create: { name: row.workLocation.name, active: true },
            })
          : null;
      await centralPrisma.operator.create({
        data: {
          id: row.id,
          name: row.name,
          fatherName: row.fatherName,
          designationId: designation?.id || null,
          dateOfBirth: row.dateOfBirth,
          dateOfJoining: row.dateOfJoining,
          dateOfResignation: row.dateOfResignation,
          permanentAddress: row.permanentAddress,
          temporaryAddress: row.temporaryAddress,
          aadhaarNumber: row.aadhaarNumber,
          email: row.email,
          bankAccountNumber: row.bankAccountNumber,
          ifscCode: row.ifscCode,
          recommendedBy: row.recommendedBy,
          workLocationId: workLocation?.id || null,
          profileImageBase64: row.profileImageBase64,
          profileImageMimeType: row.profileImageMimeType,
          profileImageFileName: row.profileImageFileName,
          resumeFileBase64: row.resumeFileBase64,
          resumeFileMimeType: row.resumeFileMimeType,
          resumeFileName: row.resumeFileName,
          aadhaarImageBase64: row.aadhaarImageBase64,
          aadhaarImageMimeType: row.aadhaarImageMimeType,
          aadhaarImageFileName: row.aadhaarImageFileName,
          phone: row.phone,
          active: row.active,
          phoneNumbers: {
            create: (row.phoneNumbers || []).map((phoneRow) => ({
              label: phoneRow.label,
              phoneNumber: phoneRow.phoneNumber,
              isPrimary: phoneRow.isPrimary,
            })),
          },
          documents: {
            create: (row.documents || []).map((documentRow) => ({
              category: documentRow.category,
              label: documentRow.label,
              textValue: documentRow.textValue,
              fileName: documentRow.fileName,
              mimeType: documentRow.mimeType,
              fileDataBase64: documentRow.fileDataBase64,
              sortOrder: documentRow.sortOrder,
              active: documentRow.active,
            })),
          },
        },
      });
    }
  }

  if (centralBestSellerCount === 0) {
    const localBestSellers = await prisma.bestSellingProduct.findMany({ orderBy: [{ id: "asc" }] });
    for (const row of localBestSellers) {
      await centralPrisma.bestSeller.create({
        data: {
          id: row.id,
          itemCode: row.itemCode,
          itemName: row.itemName,
          brandName: row.brandName,
          packValue: row.packValue,
          active: true,
        },
      });
    }
  }
}

function buildSnapshotSignature(catalog) {
  return JSON.stringify({
    operators: catalog.operators.map((row) => ({
      id: row.id,
      name: row.name,
      fatherName: row.fatherName,
      designationName: row.designationName,
      dateOfBirth: row.dateOfBirth,
      dateOfJoining: row.dateOfJoining,
      dateOfResignation: row.dateOfResignation,
      permanentAddress: row.permanentAddress,
      temporaryAddress: row.temporaryAddress,
      aadhaarNumber: row.aadhaarNumber,
      email: row.email,
      bankAccountNumber: row.bankAccountNumber,
      ifscCode: row.ifscCode,
      recommendedBy: row.recommendedBy,
      workLocationName: row.workLocationName,
      profileImageBase64: row.profileImageBase64,
      profileImageMimeType: row.profileImageMimeType,
      profileImageFileName: row.profileImageFileName,
      resumeFileBase64: row.resumeFileBase64,
      resumeFileMimeType: row.resumeFileMimeType,
      resumeFileName: row.resumeFileName,
      aadhaarImageBase64: row.aadhaarImageBase64,
      aadhaarImageMimeType: row.aadhaarImageMimeType,
      aadhaarImageFileName: row.aadhaarImageFileName,
      phone: row.phone,
      phoneNumbers: row.phoneNumbers,
      documents: row.documents,
      active: row.active,
      updatedAt: row.updatedAt,
    })),
    bestSellers: catalog.bestSellers.map((row) => ({
      id: row.id,
      itemCode: row.itemCode,
      itemName: row.itemName,
      brandName: row.brandName,
      packValue: row.packValue,
      active: row.active,
      updatedAt: row.updatedAt,
    })),
  });
}

function parseManagedList(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(String(rawValue));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => String(value || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function remapWorkerReferencesTx(tx, fromId, toId) {
  if (!fromId || !toId || fromId === toId) {
    return;
  }

  await Promise.all([
    tx.cycleUnfinishedStock.updateMany({
      where: { lastUpdatedByWorkerId: fromId },
      data: { lastUpdatedByWorkerId: toId },
    }),
    tx.cycleFinishedStock.updateMany({
      where: { lastUpdatedByWorkerId: fromId },
      data: { lastUpdatedByWorkerId: toId },
    }),
    tx.cycleFinishedStock.updateMany({
      where: { finishedByWorkerId: fromId },
      data: { finishedByWorkerId: toId },
    }),
    tx.cycleProductEvent.updateMany({
      where: { workerId: fromId },
      data: { workerId: toId },
    }),
    tx.diffBatch.updateMany({
      where: { createdByWorkerId: fromId },
      data: { createdByWorkerId: toId },
    }),
    tx.diffItem.updateMany({
      where: { lastUpdatedByWorkerId: fromId },
      data: { lastUpdatedByWorkerId: toId },
    }),
    tx.diffItem.updateMany({
      where: { finishedByWorkerId: fromId },
      data: { finishedByWorkerId: toId },
    }),
    tx.operatorDailyMismatchSummary.updateMany({
      where: { operatorId: fromId },
      data: { operatorId: toId },
    }),
  ]);
}

async function updateWorkerRowIdTx(tx, currentId, nextId, nextName) {
  await tx.$executeRawUnsafe(
    "UPDATE workers SET id = ?, name = ? WHERE id = ?",
    nextId,
    nextName,
    currentId
  );
}

async function syncWorkersToLocalTx(tx, centralWorkers) {
  const previousManagedWorkerNames = await getManagedValues(tx, MANAGED_WORKER_NAMES_KEY);
  const localWorkers = await tx.worker.findMany({ orderBy: [{ id: "asc" }] });
  const localById = new Map(localWorkers.map((row) => [row.id, row]));
  const localByName = new Map(localWorkers.map((row) => [row.name, row]));
  const stagedRows = new Map();
  const centralNameSet = new Set(centralWorkers.map((row) => row.name));
  const desiredIds = centralWorkers.map((row) => row.id);
  let tempIdCursor =
    Math.max(
      100000,
      ...localWorkers.map((row) => row.id),
      ...desiredIds
    ) + 1;

  async function stageWorker(row, options = {}) {
    const existing = stagedRows.get(row.id);
    if (existing) {
      return existing;
    }

    const tempId = tempIdCursor++;
    const tempName = options.rename
      ? `__central_sync__${tempId}`
      : row.name;

    await updateWorkerRowIdTx(tx, row.id, tempId, tempName);
    await remapWorkerReferencesTx(tx, row.id, tempId);

    const staged = {
      originalId: row.id,
      tempId,
      originalName: row.name,
      phone: row.phone,
      active: row.active,
    };
    stagedRows.set(row.id, staged);
    return staged;
  }

  const sourceByCentralId = new Map();
  for (const centralRow of centralWorkers) {
    const source = localByName.get(centralRow.name) || null;
    sourceByCentralId.set(centralRow.id, source);
  }

  for (const centralRow of centralWorkers) {
    const source = sourceByCentralId.get(centralRow.id);
    if (source && source.id !== centralRow.id) {
      await stageWorker(source, { rename: true });
    }

    const occupant = localById.get(centralRow.id);
    if (occupant && occupant.id !== source?.id) {
      await stageWorker(occupant, { rename: false });
    }
  }

  for (const centralRow of centralWorkers) {
    const source = sourceByCentralId.get(centralRow.id);
    const stagedSource = source ? stagedRows.get(source.id) : null;
    const currentTarget = await tx.worker.findUnique({ where: { id: centralRow.id } });
    const designation =
      centralRow.designationName
        ? await tx.workerDesignation.upsert({
            where: { name: centralRow.designationName },
            update: { active: true },
            create: { name: centralRow.designationName, active: true },
          })
        : null;
    const workLocation =
      centralRow.workLocationName
        ? await tx.workerWorkLocation.upsert({
            where: { name: centralRow.workLocationName },
            update: { active: true },
            create: { name: centralRow.workLocationName, active: true },
          })
        : null;
    const phoneNumberRows = Array.isArray(centralRow.phoneNumbers)
      ? centralRow.phoneNumbers.map((row) => ({
          label: row.label,
          phoneNumber: row.phoneNumber,
          isPrimary: Boolean(row.isPrimary),
        }))
      : [];
    const documentRows = Array.isArray(centralRow.documents)
      ? centralRow.documents.map((row) => ({
          category: row.category,
          label: row.label,
          textValue: row.textValue,
          fileName: row.fileName,
          mimeType: row.mimeType,
          fileDataBase64: row.fileDataBase64,
          sortOrder: row.sortOrder ?? 0,
          active: row.active !== false,
        }))
      : [];

    if (currentTarget) {
      await tx.worker.update({
        where: { id: centralRow.id },
        data: {
          name: centralRow.name,
          fatherName: centralRow.fatherName,
          designationId: designation?.id || null,
          dateOfBirth: centralRow.dateOfBirth ? new Date(centralRow.dateOfBirth) : null,
          dateOfJoining: centralRow.dateOfJoining ? new Date(centralRow.dateOfJoining) : null,
          dateOfResignation: centralRow.dateOfResignation ? new Date(centralRow.dateOfResignation) : null,
          permanentAddress: centralRow.permanentAddress,
          temporaryAddress: centralRow.temporaryAddress,
          aadhaarNumber: centralRow.aadhaarNumber,
          email: centralRow.email,
          bankAccountNumber: centralRow.bankAccountNumber,
          ifscCode: centralRow.ifscCode,
          recommendedBy: centralRow.recommendedBy || "Direct",
          workLocationId: workLocation?.id || null,
          profileImageBase64: centralRow.profileImageBase64,
          profileImageMimeType: centralRow.profileImageMimeType,
          profileImageFileName: centralRow.profileImageFileName,
          resumeFileBase64: centralRow.resumeFileBase64,
          resumeFileMimeType: centralRow.resumeFileMimeType,
          resumeFileName: centralRow.resumeFileName,
          aadhaarImageBase64: centralRow.aadhaarImageBase64,
          aadhaarImageMimeType: centralRow.aadhaarImageMimeType,
          aadhaarImageFileName: centralRow.aadhaarImageFileName,
          phone: centralRow.phone,
          active: centralRow.active,
          phoneNumbers: {
            deleteMany: {},
            create: phoneNumberRows,
          },
          documents: {
            deleteMany: {},
            create: documentRows,
          },
        },
      });
    } else {
      await tx.worker.create({
        data: {
          id: centralRow.id,
          name: centralRow.name,
          fatherName: centralRow.fatherName,
          designationId: designation?.id || null,
          dateOfBirth: centralRow.dateOfBirth ? new Date(centralRow.dateOfBirth) : null,
          dateOfJoining: centralRow.dateOfJoining ? new Date(centralRow.dateOfJoining) : null,
          dateOfResignation: centralRow.dateOfResignation ? new Date(centralRow.dateOfResignation) : null,
          permanentAddress: centralRow.permanentAddress,
          temporaryAddress: centralRow.temporaryAddress,
          aadhaarNumber: centralRow.aadhaarNumber,
          email: centralRow.email,
          bankAccountNumber: centralRow.bankAccountNumber,
          ifscCode: centralRow.ifscCode,
          recommendedBy: centralRow.recommendedBy || "Direct",
          workLocationId: workLocation?.id || null,
          profileImageBase64: centralRow.profileImageBase64,
          profileImageMimeType: centralRow.profileImageMimeType,
          profileImageFileName: centralRow.profileImageFileName,
          resumeFileBase64: centralRow.resumeFileBase64,
          resumeFileMimeType: centralRow.resumeFileMimeType,
          resumeFileName: centralRow.resumeFileName,
          aadhaarImageBase64: centralRow.aadhaarImageBase64,
          aadhaarImageMimeType: centralRow.aadhaarImageMimeType,
          aadhaarImageFileName: centralRow.aadhaarImageFileName,
          phone: centralRow.phone,
          active: centralRow.active,
          phoneNumbers: {
            create: phoneNumberRows,
          },
          documents: {
            create: documentRows,
          },
        },
      });
    }

    if (stagedSource) {
      await remapWorkerReferencesTx(tx, stagedSource.tempId, centralRow.id);
      await tx.worker.delete({ where: { id: stagedSource.tempId } });
    }
  }

  const currentManagedWorkerNames = centralWorkers.map((row) => row.name);
  const removedManagedNames = previousManagedWorkerNames.filter(
    (name) => !centralNameSet.has(name)
  );

  if (removedManagedNames.length) {
    await tx.worker.updateMany({
      where: { name: { in: removedManagedNames } },
      data: { active: false },
    });
  }

  await saveManagedValues(tx, MANAGED_WORKER_NAMES_KEY, currentManagedWorkerNames);

  return {
    workerCount: centralWorkers.length,
    activeWorkerCount: centralWorkers.filter((row) => row.active).length,
    deactivatedWorkerCount: removedManagedNames.length,
  };
}

async function syncBestSellersToLocalTx(tx, centralBestSellers) {
  const rows = centralBestSellers.filter((row) => row.active);

  await tx.bestSellingProduct.deleteMany({});

  for (const row of rows) {
    await tx.bestSellingProduct.create({
      data: {
        id: row.id,
        itemCode: row.itemCode,
        itemName: row.itemName,
        brandName: row.brandName,
        packValue: row.packValue,
      },
    });
  }

  await saveManagedValues(
    tx,
    MANAGED_BEST_SELLER_CODES_KEY,
    rows.map((row) => row.itemCode)
  );

  return {
    bestSellerCount: rows.length,
    removedBestSellerCount: 0,
  };
}

async function getManagedValues(tx, key) {
  const row = await tx.appSetting.findUnique({ where: { key } });
  return parseManagedList(row?.value);
}

async function saveManagedValues(tx, key, values) {
  await tx.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(values) },
    update: { value: JSON.stringify(values) },
  });
}

async function applyCatalogToLocal(catalog) {
  return syncCatalogToLocal(catalog);
}

async function syncCatalogToLocal(catalog, options = {}) {
  const syncOperators = options.syncOperators !== false;
  const syncBestSellers = options.syncBestSellers !== false;
  const safeCatalog = {
    operators: Array.isArray(catalog?.operators) ? normalizeOperators(catalog.operators) : [],
    bestSellers: Array.isArray(catalog?.bestSellers) ? normalizeBestSellers(catalog.bestSellers) : [],
  };

  return prisma.$transaction(async (tx) => {
    const workerSummary = syncOperators
      ? await syncWorkersToLocalTx(tx, safeCatalog.operators)
      : {
          workerCount: 0,
          activeWorkerCount: 0,
          deactivatedWorkerCount: 0,
        };
    const bestSellerSummary = syncBestSellers
      ? await syncBestSellersToLocalTx(tx, safeCatalog.bestSellers)
      : {
          bestSellerCount: 0,
          removedBestSellerCount: 0,
        };

    return {
      ...workerSummary,
      ...bestSellerSummary,
      targetDatabases: ["stocklens_prisma.sqlite"],
      syncOperators,
      syncBestSellers,
    };
  });
}

async function syncCentralCatalog(trigger = "manual") {
  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = (async () => {
    syncState.lastTrigger = trigger;

    try {
      await seedCentralCatalogFromLocalIfEmpty();
      const catalog = await readCentralCatalog({ includeInactive: true });
      const snapshotSignature = buildSnapshotSignature(catalog);
      const changed = snapshotSignature !== lastSnapshotSignature;
      syncState.lastCheckedAt = new Date().toISOString();

      const summary = await applyCatalogToLocal(catalog);
      lastSnapshotSignature = snapshotSignature;
      syncState.lastError = null;
      syncState.lastSyncedAt = new Date().toISOString();
      syncState.lastSummary = summary;
      if (changed) {
        syncState.lastChangeDetectedAt = syncState.lastSyncedAt;
      }

      return {
        success: true,
        changed,
        skipped: false,
        summary,
        state: getCentralSyncState(),
      };
    } catch (error) {
      syncState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

async function startCentralCatalogSync() {
  if (syncState.running) return;

  syncState.running = true;
  try {
    await syncCentralCatalog("startup");
    console.log("Central catalog sync initialized.");
  } catch (error) {
    console.error("Central catalog startup sync failed:", error);
  }
}

function stopCentralCatalogSync() {
  syncState.running = false;
  console.log("Central catalog sync stopped.");
}

function getCentralSyncState() {
  return clone(syncState);
}

module.exports = {
  normalizeOperators,
  normalizeBestSellers,
  readCentralCatalog,
  syncCatalogToLocal,
  syncCentralCatalog,
  startCentralCatalogSync,
  stopCentralCatalogSync,
  getCentralSyncState,
};
