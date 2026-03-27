import {
  IonBadge,
  IonButton,
  IonCheckbox,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
  IonPage,
  IonSearchbar,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import {
  addOutline,
  cameraOutline,
  chevronForwardOutline,
  cloudUploadOutline,
  closeOutline,
  cubeOutline,
  printOutline,
  refreshOutline,
  removeOutline,
  wineOutline,
} from "ionicons/icons";
import { useEffect, useMemo, useState } from "react";
import { getCurrentCycle } from "../api/cyclesApi";
import {
  MultiSelectFilterPopover,
  type MultiSelectFilterOption,
} from "../components/common/MultiSelectFilterPopover";
import {
  getAllMasterProducts,
  getPrinters,
  getShopLocations,
  type MasterProduct,
  type ShopLocation,
} from "../api/metaApi";
import {
  createDiffBatch,
  finishUnfinishedStock,
  getVerifyUncheckedFinished,
  getVerifyMismatchedFinished,
  printVerificationList,
  upsertUnfinishedStock,
  type VerifyMismatchedFinishedRow,
  type VerifyUncheckedFinishedRow,
} from "../api/stockApi";
import { getCurrentLocationIdFromStorage } from "../config/location";
import { getCurrentPhoneIdFromStorage } from "../config/phone";
import { AppTopBar } from "../components/common/AppTopBar";
import { captureDiffProofPhoto, type DiffProofPhoto } from "../services/diffProofPhoto";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_PRINTER_ID_KEY = "stocklens_current_printer_id";

type RowFilter = "unchecked" | "mismatched";

function normalizeFilterValue(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function getUniqueFilterValues(values: string[]) {
  const seen = new Set<string>();
  const nextValues: string[] = [];

  values.forEach((value) => {
    const trimmed = String(value || "").trim();
    const normalized = normalizeFilterValue(trimmed);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    nextValues.push(trimmed);
  });

  return nextValues;
}

function areFilterArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => normalizeFilterValue(value) === normalizeFilterValue(right[index]))
  );
}

type CombinedVerifyRow = {
  rowType: "unchecked" | "mismatched";
  cycleId: number;
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  shopLocationId: number;
  shopLocationName: string;
  bpc?: number | null;
  mrp?: number | null;
  barcode?: string | null;
  id?: number;
  activityDate?: string;
  enteredBottles?: number;
  currentStockBottles?: number;
  diffBottles?: number;
  enteredFormatted?: string;
  currentStockFormatted?: string;
  diffFormatted?: string;
};

function parsePositiveInt(rawValue: string | null) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function getFieldValue(value: string | number | null | undefined) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeLocationKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeCodeValue(value: string) {
  return String(value || "").trim().toLowerCase();
}

function parseStockStringToBottles(stock: string | null | undefined, bpc: number) {
  const raw = String(stock || "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [packsPart = "0", bottlesPart = "0"] = unsigned.split(".");
  const packs = Math.max(0, Number.parseInt(packsPart, 10) || 0);
  const bottles = Math.max(0, Number.parseInt(bottlesPart, 10) || 0);
  const total = packs * bpc + bottles;
  return negative ? -total : total;
}

function bottlesToPackBottle(totalBottles: number, bpc: number) {
  const safeBpc = Math.max(1, bpc || 1);
  const packs = Math.floor(Math.max(0, totalBottles) / safeBpc);
  const bottles = Math.max(0, totalBottles) % safeBpc;
  return { packs, bottles };
}

function formatBottleCount(totalBottles: number, bpc: number) {
  const safeBpc = Math.max(1, bpc || 1);
  const negative = totalBottles < 0;
  const absolute = bottlesToPackBottle(Math.abs(totalBottles), safeBpc);
  const formatted = `${absolute.packs}.${String(absolute.bottles).padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getActivityDateKey(isoDateTime: string) {
  return String(isoDateTime || "").slice(0, 10);
}

function getStrictLocationHeaderKey(location: ShopLocation | null) {
  return normalizeLocationKey(location?.locationName);
}

function getMasterStockBottles(product: MasterProduct, location: ShopLocation | null) {
  const safeBpc = Number(product.bpc) || 12;
  const locationKey = getStrictLocationHeaderKey(location);
  if (locationKey === "shop") {
    return parseStockStringToBottles(product.shopStock, safeBpc);
  }
  if (locationKey === "godown") {
    return parseStockStringToBottles(product.godownStock, safeBpc);
  }
  const locationStocks = product.locationStocks || {};
  const source = locationKey ? locationStocks[locationKey] : "";
  return parseStockStringToBottles(source, safeBpc);
}

function mapUncheckedRow(row: VerifyUncheckedFinishedRow): CombinedVerifyRow {
  return {
    rowType: "unchecked",
    cycleId: row.cycleId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    brandName: row.brandName,
    packValue: row.packValue,
    shopLocationId: row.shopLocationId,
    shopLocationName: row.shopLocationName,
    bpc: row.bpc,
    mrp: row.mrp,
    barcode: row.barcode,
  };
}

function mapMismatchedRow(row: VerifyMismatchedFinishedRow): CombinedVerifyRow {
  return {
    rowType: "mismatched",
    cycleId: row.cycleId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    brandName: row.brandName,
    packValue: row.packValue,
    shopLocationId: row.shopLocationId,
    shopLocationName: row.shopLocationName,
    bpc: row.bpc,
    mrp: row.mrp,
    id: row.id,
    activityDate: row.activityDate,
    enteredBottles: row.enteredBottles,
    currentStockBottles: row.currentStockBottles,
    diffBottles: row.diffBottles,
    enteredFormatted: row.enteredFormatted,
    currentStockFormatted: row.currentStockFormatted,
    diffFormatted: row.diffFormatted,
  };
}

export function UncheckedPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CombinedVerifyRow[]>([]);
  const [searchText, setSearchText] = useState("");
  const [itemFilters, setItemFilters] = useState<string[]>([]);
  const [packFilters, setPackFilters] = useState<string[]>([]);
  const [rowFilters, setRowFilters] = useState<RowFilter[]>([]);
  const [locationName, setLocationName] = useState("");
  const [errorText, setErrorText] = useState("");
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [activeCycleId, setActiveCycleId] = useState<number | null>(null);
  const [currentLocationId, setCurrentLocationId] = useState<number | null>(null);
  const [masterRows, setMasterRows] = useState<MasterProduct[]>([]);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedMismatchIds, setSelectedMismatchIds] = useState<Set<number>>(new Set());
  const [selectedRow, setSelectedRow] = useState<CombinedVerifyRow | null>(null);
  const [showStockModal, setShowStockModal] = useState(false);
  const [packQty, setPackQty] = useState("");
  const [bottleQty, setBottleQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
  const [capturingProof, setCapturingProof] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<DiffProofPhoto | null>(null);
  const [creatingDiff, setCreatingDiff] = useState(false);
  const [typeFilterPopoverOpen, setTypeFilterPopoverOpen] = useState(false);
  const [typeFilterPopoverEvent, setTypeFilterPopoverEvent] = useState<Event | undefined>(undefined);
  const [draftRowFilters, setDraftRowFilters] = useState<RowFilter[]>([]);
  const [itemFilterPopoverOpen, setItemFilterPopoverOpen] = useState(false);
  const [itemFilterPopoverEvent, setItemFilterPopoverEvent] = useState<Event | undefined>(undefined);
  const [draftItemFilters, setDraftItemFilters] = useState<string[]>([]);
  const [packFilterPopoverOpen, setPackFilterPopoverOpen] = useState(false);
  const [packFilterPopoverEvent, setPackFilterPopoverEvent] = useState<Event | undefined>(undefined);
  const [draftPackFilters, setDraftPackFilters] = useState<string[]>([]);

  useEffect(() => {
    const storedPrinterId = parsePositiveInt(localStorage.getItem(CURRENT_PRINTER_ID_KEY));
    if (storedPrinterId) {
      setSelectedPrinterId(storedPrinterId);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPrinter() {
      try {
        const printers = await getPrinters();
        if (cancelled) return;
        const storedPrinterId = parsePositiveInt(localStorage.getItem(CURRENT_PRINTER_ID_KEY));
        const validStored =
          storedPrinterId && printers.some((row) => row.id === storedPrinterId)
            ? storedPrinterId
            : null;
        const defaultPrinter = printers.find((row) => row.defaultPrinter) || null;
        const nextPrinterId = validStored || defaultPrinter?.id || null;
        setSelectedPrinterId(nextPrinterId);
        if (nextPrinterId) {
          localStorage.setItem(CURRENT_PRINTER_ID_KEY, String(nextPrinterId));
        }
      } catch {
        // Keep page usable if printer list fails. Print button will show a clear error when used.
      }
    }
    void loadPrinter();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadUncheckedRows() {
    setLoading(true);
    setErrorText("");
    try {
      const currentLocationId = getCurrentLocationIdFromStorage();
      if (!currentLocationId) {
        setRows([]);
        setCurrentLocationId(null);
        setErrorText("Select location first in stock entry page.");
        return;
      }
      setCurrentLocationId(currentLocationId);

      const cycleResult = await getCurrentCycle();
      if (!cycleResult.active || !cycleResult.cycle?.id) {
        setRows([]);
        setActiveCycleId(null);
        setErrorText("No active cycle. Start a cycle first.");
        return;
      }
      setActiveCycleId(cycleResult.cycle.id);

      const [uncheckedResult, mismatchedResult, masterProductRows, locationRows] = await Promise.all([
        getVerifyUncheckedFinished({
          cycleId: cycleResult.cycle.id,
          shopLocationId: currentLocationId,
        }),
        getVerifyMismatchedFinished({
          cycleId: cycleResult.cycle.id,
          shopLocationId: currentLocationId,
        }),
        getAllMasterProducts(10000, { includeAll: true }),
        getShopLocations(),
      ]);

      setMasterRows(masterProductRows);
      setLocations(locationRows);
      setRows([
        ...(uncheckedResult.rows || []).map(mapUncheckedRow),
        ...(mismatchedResult.rows || []).map(mapMismatchedRow),
      ]);
      setSelectedMismatchIds(new Set());
      setLocationName(uncheckedResult.shopLocationName || mismatchedResult.rows?.[0]?.shopLocationName || "");
    } catch (error) {
      setRows([]);
      const message = error instanceof Error ? error.message : "Failed to load unchecked products";
      setErrorText(message);
      presentToast({
        message,
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUncheckedRows();
  }, []);

  const itemOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => String(row.itemName || "").trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right));
  }, [rows]);

  const packOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => String(row.packValue || "").trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }, [rows]);

  const itemFilterOptionMap = useMemo(
    () => new Map(itemOptions.map((itemName) => [normalizeFilterValue(itemName), itemName])),
    [itemOptions]
  );
  const packFilterOptionMap = useMemo(
    () => new Map(packOptions.map((packValue) => [normalizeFilterValue(packValue), packValue])),
    [packOptions]
  );
  const normalizedItemFilterSet = useMemo(
    () => new Set(itemFilters.map((value) => normalizeFilterValue(value)).filter(Boolean)),
    [itemFilters]
  );
  const normalizedPackFilterSet = useMemo(
    () => new Set(packFilters.map((value) => normalizeFilterValue(value)).filter(Boolean)),
    [packFilters]
  );
  const normalizedRowFilterSet = useMemo(
    () => new Set(rowFilters.map((value) => normalizeFilterValue(value)).filter(Boolean)),
    [rowFilters]
  );
  const itemFilterOptions = useMemo<MultiSelectFilterOption[]>(
    () => itemOptions.map((itemName) => ({ value: itemName, label: itemName })),
    [itemOptions]
  );
  const packFilterOptions = useMemo<MultiSelectFilterOption[]>(
    () => packOptions.map((packValue) => ({ value: packValue, label: packValue })),
    [packOptions]
  );

  useEffect(() => {
    setItemFilters((previous) => {
      const nextValues = getUniqueFilterValues(
        previous
          .map((value) => itemFilterOptionMap.get(normalizeFilterValue(value)) || "")
          .filter(Boolean)
      );
      return areFilterArraysEqual(previous, nextValues) ? previous : nextValues;
    });
  }, [itemFilterOptionMap]);

  useEffect(() => {
    setPackFilters((previous) => {
      const nextValues = getUniqueFilterValues(
        previous
          .map((value) => packFilterOptionMap.get(normalizeFilterValue(value)) || "")
          .filter(Boolean)
      );
      return areFilterArraysEqual(previous, nextValues) ? previous : nextValues;
    });
  }, [packFilterOptionMap]);

  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        normalizedRowFilterSet.size > 0 &&
        !normalizedRowFilterSet.has(normalizeFilterValue(row.rowType))
      ) {
        return false;
      }
      if (
        normalizedItemFilterSet.size > 0 &&
        !normalizedItemFilterSet.has(normalizeFilterValue(row.itemName))
      ) {
        return false;
      }
      if (
        normalizedPackFilterSet.size > 0 &&
        !normalizedPackFilterSet.has(normalizeFilterValue(row.packValue))
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      const brand = String(row.brandName || "").toLowerCase();
      const item = String(row.itemName || "").toLowerCase();
      const pack = String(row.packValue || "").toLowerCase();
      const code = String(row.itemCode || "").toLowerCase();
      return (
        brand.includes(query) ||
        item.includes(query) ||
        pack.includes(query) ||
        code.includes(query)
      );
    });
  }, [rows, searchText, normalizedItemFilterSet, normalizedPackFilterSet, normalizedRowFilterSet]);

  const uncheckedCount = useMemo(
    () => rows.filter((row) => row.rowType === "unchecked").length,
    [rows]
  );
  const mismatchedCount = useMemo(
    () => rows.filter((row) => row.rowType === "mismatched").length,
    [rows]
  );
  const typeFilterOptions = useMemo<MultiSelectFilterOption[]>(
    () => [
      { value: "unchecked", label: `Unchecked (${uncheckedCount})` },
      { value: "mismatched", label: `Mismatched (${mismatchedCount})` },
    ],
    [mismatchedCount, uncheckedCount]
  );
  const selectedTypeFilterText = useMemo(() => {
    if (rowFilters.length === 0) {
      return `All (${rows.length})`;
    }
    if (rowFilters.length === 1) {
      return rowFilters[0] === "unchecked"
        ? `Unchecked (${uncheckedCount})`
        : `Mismatched (${mismatchedCount})`;
    }
    return `${rowFilters.length} selected`;
  }, [mismatchedCount, rowFilters, rows.length, uncheckedCount]);
  const selectedItemFilterText = useMemo(() => {
    if (itemFilters.length === 0) return "All Items";
    if (itemFilters.length === 1) return itemFilters[0];
    return `${itemFilters.length} selected`;
  }, [itemFilters]);
  const selectedPackFilterText = useMemo(() => {
    if (packFilters.length === 0) return "All Packs";
    if (packFilters.length === 1) return packFilters[0];
    return `${packFilters.length} selected`;
  }, [packFilters]);
  const hasMismatchedRowsSelected = normalizedRowFilterSet.has("mismatched");
  const hasUncheckedRowsSelected = normalizedRowFilterSet.has("unchecked");
  const printFilterLabel = useMemo(() => {
    if (normalizedRowFilterSet.size === 0) return "FILTERED REVIEW";
    if (hasUncheckedRowsSelected && hasMismatchedRowsSelected) return "UNCHECKED + MISMATCHED";
    if (hasMismatchedRowsSelected) return "MISMATCHED";
    if (hasUncheckedRowsSelected) return "UNCHECKED";
    return "FILTERED REVIEW";
  }, [hasMismatchedRowsSelected, hasUncheckedRowsSelected, normalizedRowFilterSet.size]);

  function applyRowFilters() {
    setRowFilters(getUniqueFilterValues(draftRowFilters) as RowFilter[]);
    setTypeFilterPopoverOpen(false);
  }

  function applyItemFilters() {
    setItemFilters(getUniqueFilterValues(draftItemFilters));
    setItemFilterPopoverOpen(false);
  }

  function applyPackFilters() {
    setPackFilters(getUniqueFilterValues(draftPackFilters));
    setPackFilterPopoverOpen(false);
  }

  async function handlePrintFilteredRows() {
    if (filteredRows.length === 0) {
      presentToast({
        message: "No rows available to print",
        color: "warning",
        duration: 1500,
      });
      return;
    }

    if (!selectedPrinterId) {
      presentToast({
        message: "Select printer first in Print page or set a default printer",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    setPrinting(true);
    try {
      const backendFilter =
        hasMismatchedRowsSelected && !hasUncheckedRowsSelected ? "unmatched" : "unchecked";
      const filterLabel = printFilterLabel;

      const result = await printVerificationList({
        printerId: selectedPrinterId,
        filter: backendFilter,
        filterLabel,
        filteredItems: filteredRows.map((row) => ({
          shopLocationId: row.shopLocationId,
          itemCode: row.itemCode,
          displayName: `${row.brandName || row.itemName} | ${row.packValue || "-"} | ${row.itemName || "-"} | ${row.itemCode}`,
        })),
      });

      presentToast({
        message: result.message || "Print sent",
        color: "success",
        duration: 1800,
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Print failed",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setPrinting(false);
    }
  }

  const todayKey = getTodayDateString();
  const currentLocation =
    locations.find((location) => location.id === currentLocationId) || null;

  function toggleMismatchSelection(row: CombinedVerifyRow) {
    if (row.rowType !== "mismatched" || !row.id) return;
    setSelectedMismatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.id!)) {
        next.delete(row.id!);
      } else {
        next.add(row.id!);
      }
      return next;
      });
  }

  function getCurrentStockForRow(row: CombinedVerifyRow) {
    if (typeof row.currentStockBottles === "number") {
      return row.currentStockBottles;
    }
    const normalizedCode = normalizeCodeValue(row.itemCode);
    const master = masterRows.find(
      (masterRow) => normalizeCodeValue(getFieldValue(masterRow.itemCode)) === normalizedCode
    );
    if (!master) return 0;
    return getMasterStockBottles(master, currentLocation);
  }

  function openRowEditor(row: CombinedVerifyRow) {
    const safeBpc = Number(row.bpc) || 12;
    if (row.rowType === "mismatched") {
      const starting = bottlesToPackBottle(Number(row.enteredBottles || 0), safeBpc);
      setPackQty(starting.packs ? String(starting.packs) : "");
      setBottleQty(starting.bottles ? String(starting.bottles) : "");
    } else {
      setPackQty("");
      setBottleQty("");
    }
    setSelectedRow(row);
    setShowStockModal(true);
  }

  function incrementCases() {
    const next = (Number.parseInt(packQty || "0", 10) || 0) + 1;
    setPackQty(String(next));
  }

  function decrementCases() {
    const current = Number.parseInt(packQty || "0", 10) || 0;
    const next = Math.max(0, current - 1);
    setPackQty(next > 0 ? String(next) : "");
  }

  function incrementBottles() {
    const next = (Number.parseInt(bottleQty || "0", 10) || 0) + 1;
    setBottleQty(String(next));
  }

  function decrementBottles() {
    const current = Number.parseInt(bottleQty || "0", 10) || 0;
    const next = Math.max(0, current - 1);
    setBottleQty(next > 0 ? String(next) : "");
  }

  const selectedProductBpc = Number(selectedRow?.bpc) || 12;
  const enteredCases = Number.parseInt(packQty || "0", 10) || 0;
  const enteredBottles = Number.parseInt(bottleQty || "0", 10) || 0;
  const enteredTotalBottles = enteredCases * selectedProductBpc + enteredBottles;
  const selectedCurrentStockBottles = selectedRow ? getCurrentStockForRow(selectedRow) : 0;
  const selectedCurrentStockFormatted = formatBottleCount(
    selectedCurrentStockBottles,
    selectedProductBpc
  );
  const selectedPreviousFormatted =
    selectedRow?.rowType === "mismatched" ? selectedRow.enteredFormatted || "0.00" : "-";
  const selectedStatusLabel =
    selectedRow?.rowType === "mismatched"
      ? selectedRow.diffFormatted || "0.00"
      : "Unchecked";
  const stockValueDisplay = `${enteredCases}.${String(enteredBottles).padStart(2, "0")}`;
  const currentDiffBottles = enteredTotalBottles - selectedCurrentStockBottles;

  async function saveStockEntry() {
    if (!selectedRow) return;

    const operatorId = parsePositiveInt(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
    if (!operatorId) {
      presentToast({
        message: "Select operator first in stock entry page.",
        color: "warning",
        duration: 1600,
      });
      return;
    }

    const currentPhoneId = getCurrentPhoneIdFromStorage();
    if (!currentPhoneId) {
      presentToast({
        message: "Select current phone in Settings -> Phones",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    const cycleId = selectedRow.cycleId || activeCycleId;
    if (!cycleId) {
      presentToast({
        message: "No active cycle. Start a cycle first.",
        color: "warning",
        duration: 1800,
      });
      return;
    }

    const activityDate =
      selectedRow.rowType === "mismatched" && selectedRow.activityDate
        ? getActivityDateKey(selectedRow.activityDate)
        : todayKey;

    setSaving(true);
    try {
      await upsertUnfinishedStock({
        cycleId,
        itemCode: selectedRow.itemCode,
        itemName: selectedRow.itemName,
        brandName: selectedRow.brandName || selectedRow.itemCode,
        packValue: selectedRow.packValue,
        bpc: selectedRow.bpc ?? null,
        mrp: selectedRow.mrp ?? null,
        barcode: selectedRow.barcode || undefined,
        shopLocationId: selectedRow.shopLocationId,
        activityDate,
        quantityBottles: enteredTotalBottles,
        currentStockBottles: selectedCurrentStockBottles,
        phoneId: currentPhoneId,
        lastUpdatedByWorkerId: operatorId,
        recheckShown: false,
      });

      await finishUnfinishedStock({
        cycleId,
        itemCode: selectedRow.itemCode,
        shopLocationId: selectedRow.shopLocationId,
        activityDate,
        finishedByWorkerId: operatorId,
      });

      await loadUncheckedRows();
      setShowStockModal(false);
      setSelectedRow(null);
      presentToast({
        message:
          enteredTotalBottles === selectedCurrentStockBottles
            ? "Stock updated. Item cleared from unchecked list."
            : "Stock updated. Item is now mismatched.",
        color: enteredTotalBottles === selectedCurrentStockBottles ? "success" : "warning",
        duration: 1800,
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save stock",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateDiff() {
    if (!activeCycleId || !currentLocationId) {
      presentToast({
        message: "Select an active cycle and shop location first.",
        color: "warning",
        duration: 1500,
      });
      return;
    }
    if (selectedMismatchIds.size === 0) {
      presentToast({ message: "Select mismatched rows to move.", color: "warning", duration: 1400 });
      return;
    }
    setShowProofModal(true);
  }

  async function submitDiffBatch() {
    if (!activeCycleId || !currentLocationId) return;
    const operatorId = parsePositiveInt(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
    setCreatingDiff(true);
    try {
      const result = await createDiffBatch({
        cycleId: activeCycleId,
        shopLocationId: currentLocationId,
        sourceScope: "finished",
        itemIds: Array.from(selectedMismatchIds),
        createdByWorkerId: operatorId,
        proofImageName: proofPhoto?.fileName,
        proofImageData: proofPhoto?.base64Data,
        proofImageMimeType: proofPhoto?.mimeType,
      });
      const printMessage = result.print?.message ? ` ${result.print.message}` : "";
      const toastColor = result.print && !result.print.success && !result.print.skipped ? "warning" : "success";
      presentToast({
        message: `${result.movedCount} item(s) moved to diff batch #${result.batch.id}.${printMessage}`,
        color: toastColor,
        duration: 2200,
      });
      setShowProofModal(false);
      setProofPhoto(null);
      await loadUncheckedRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to create diff batch",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setCreatingDiff(false);
    }
  }

  async function handleCaptureProofPhoto() {
    setCapturingProof(true);
    try {
      const nextPhoto = await captureDiffProofPhoto();
      setProofPhoto(nextPhoto);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to capture proof photo";
      if (!/cancel/i.test(message)) {
        presentToast({ message, color: "danger", duration: 1800 });
      }
    } finally {
      setCapturingProof(false);
    }
  }

  return (
    <IonPage>
      <AppTopBar
        title="Unchecked Products"
        endContent={
          <>
            <span className="toolbar-title-tag unchecked">({uncheckedCount})</span>
            <span className="toolbar-title-tag mismatched">({mismatchedCount})</span>
          </>
        }
        showBack
        backPath="/stock"
        showSettings={false}
        showLocationSwitcher={false}
      />
      <IonContent fullscreen className="verify-page-content ion-padding">
        <div className="verify-page-wrap">
          <IonSearchbar
            value={searchText}
            placeholder="Search by item, brand, pack or code..."
            debounce={120}
            className="verify-searchbar"
            onIonInput={(event) => setSearchText(event.detail.value || "")}
          />

          <div className="unchecked-filter-row">
            <IonItem
              lines="none"
              className="search-filter-item search-filter-item-button unchecked-filter-item"
              button={true}
              detail={false}
              onClick={(event) => {
                setTypeFilterPopoverEvent(event.nativeEvent);
                setDraftRowFilters(rowFilters);
                setTypeFilterPopoverOpen(true);
              }}
            >
              <IonLabel>Type</IonLabel>
              <span className="search-filter-item-value">{selectedTypeFilterText}</span>
              <IonIcon icon={chevronForwardOutline} className="search-filter-item-chevron" />
            </IonItem>

            <IonItem
              lines="none"
              className="search-filter-item search-filter-item-button unchecked-filter-item"
              button={true}
              detail={false}
              onClick={(event) => {
                setItemFilterPopoverEvent(event.nativeEvent);
                setDraftItemFilters(itemFilters);
                setItemFilterPopoverOpen(true);
              }}
            >
              <IonLabel>Item</IonLabel>
              <span className="search-filter-item-value">{selectedItemFilterText}</span>
              <IonIcon icon={chevronForwardOutline} className="search-filter-item-chevron" />
            </IonItem>

            <IonItem
              lines="none"
              className="search-filter-item search-filter-item-button unchecked-filter-item"
              button={true}
              detail={false}
              onClick={(event) => {
                setPackFilterPopoverEvent(event.nativeEvent);
                setDraftPackFilters(packFilters);
                setPackFilterPopoverOpen(true);
              }}
            >
              <IonLabel>Pack</IonLabel>
              <span className="search-filter-item-value">{selectedPackFilterText}</span>
              <IonIcon icon={chevronForwardOutline} className="search-filter-item-chevron" />
            </IonItem>

            <IonButton
              fill="solid"
              className="search-filter-cancel-btn unchecked-filter-clear-btn"
              disabled={rowFilters.length === 0 && itemFilters.length === 0 && packFilters.length === 0 && !searchText.trim()}
              onClick={() => {
                setRowFilters([]);
                setItemFilters([]);
                setPackFilters([]);
                setSearchText("");
              }}
            >
              Clear
            </IonButton>
          </div>

          <div className="verify-summary-box">
            {searchText || rowFilters.length > 0 || itemFilters.length > 0 || packFilters.length > 0
              ? `${filteredRows.length} of ${rows.length} products match the selected filters`
              : `${rows.length} products are pending review in this cycle`}
          </div>

          <IonButton
            expand="block"
            className="operator-print-nav-btn"
            disabled={loading || printing || filteredRows.length === 0}
            onClick={() => void handlePrintFilteredRows()}
          >
            {printing ? <IonSpinner name="crescent" /> : <IonIcon icon={printOutline} slot="start" />}
            {printing ? "Printing..." : "Print Unchecked"}
          </IonButton>

          {locationName ? (
            <div className="verify-subtitle">
              Location: {locationName} • Tap a product to enter stock
            </div>
          ) : null}

          {loading ? (
            <div className="stock-loading-wrap">
              <IonSpinner name="crescent" />
            </div>
          ) : errorText ? (
            <div className="operator-required-box">{errorText}</div>
          ) : filteredRows.length === 0 ? (
            <div className="stock-empty">
              {searchText || rowFilters.length > 0 || itemFilters.length > 0 || packFilters.length > 0
                ? "No products found for the selected search or filters."
                : "No unchecked or mismatched products."}
            </div>
          ) : (
            <div className="verify-list">
              {filteredRows.map((row) => (
                <div
                  key={`${row.rowType}_${row.shopLocationId}_${row.itemCode}_${row.packValue}_${row.id || "base"}`}
                  className="verify-row is-selectable"
                  onClick={() => openRowEditor(row)}
                >
                  {row.rowType === "mismatched" ? (
                    <IonCheckbox
                      className="verify-row-checkbox"
                      checked={row.id ? selectedMismatchIds.has(row.id) : false}
                      onClick={(event) => event.stopPropagation()}
                      onIonChange={() => toggleMismatchSelection(row)}
                    />
                  ) : null}
                    <div className="verify-row-body">
                      <div className="verify-row-title">
                        {row.brandName || row.itemName}
                        {row.rowType === "mismatched" ? (
                          <IonBadge color="warning" style={{ marginLeft: 8 }}>
                            Mismatched
                          </IonBadge>
                        ) : null}
                      </div>
                    <div className="verify-row-meta">
                      {row.packValue || "-"} • {row.itemName || "-"} • Code: {row.itemCode}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </IonContent>

      <MultiSelectFilterPopover
        isOpen={typeFilterPopoverOpen}
        event={typeFilterPopoverEvent}
        draftValues={draftRowFilters}
        options={typeFilterOptions}
        allLabel={`All (${rows.length})`}
        onDraftValuesChange={(values) => setDraftRowFilters(values as RowFilter[])}
        onApply={applyRowFilters}
        onDidDismiss={() => {
          setTypeFilterPopoverOpen(false);
          setDraftRowFilters(rowFilters);
        }}
      />

      <MultiSelectFilterPopover
        isOpen={itemFilterPopoverOpen}
        event={itemFilterPopoverEvent}
        draftValues={draftItemFilters}
        options={itemFilterOptions}
        allLabel="All Items"
        onDraftValuesChange={setDraftItemFilters}
        onApply={applyItemFilters}
        onDidDismiss={() => {
          setItemFilterPopoverOpen(false);
          setDraftItemFilters(itemFilters);
        }}
      />

      <MultiSelectFilterPopover
        isOpen={packFilterPopoverOpen}
        event={packFilterPopoverEvent}
        draftValues={draftPackFilters}
        options={packFilterOptions}
        allLabel="All Packs"
        onDraftValuesChange={setDraftPackFilters}
        onApply={applyPackFilters}
        onDidDismiss={() => {
          setPackFilterPopoverOpen(false);
          setDraftPackFilters(packFilters);
        }}
      />

      <IonModal
        isOpen={showStockModal}
        onDidDismiss={() => {
          setShowStockModal(false);
          setSelectedRow(null);
        }}
        className="stock-editor-modal"
        breakpoints={[0, 0.96]}
        initialBreakpoint={0.96}
        handle={true}
      >
        <IonContent fullscreen className="stock-editor-modal-content">
          <div className="stock-sheet-header">
            <h2>Enter Stock Quantity</h2>
            <IonButton
              fill="clear"
              onClick={() => {
                setShowStockModal(false);
                setSelectedRow(null);
              }}
            >
              <IonIcon icon={closeOutline} />
            </IonButton>
          </div>

          <div className="stock-sheet-product">
            <div>
              <h3>{selectedRow?.brandName || "-"}</h3>
              <div className="stock-sheet-pack-line">
                <strong>{String(selectedRow?.packValue || "-")}ml</strong>
              </div>
              <p className="stock-sheet-code">Code: {selectedRow?.itemCode || "-"}</p>
            </div>
            <IonButton
              className="stock-save-top-btn"
              color="success"
              onClick={() => void saveStockEntry()}
              disabled={saving || !selectedRow}
            >
              {saving ? "Saving..." : "Save"}
            </IonButton>
          </div>

          <div className="stock-step-card stock-step-card-cases">
            <div className="stock-step-title">
              <IonIcon icon={cubeOutline} />
              Cases
            </div>
            <div className="stock-stepper">
              <button type="button" onClick={decrementCases} className="stock-step-btn">
                <IonIcon icon={removeOutline} />
              </button>
              <IonInput
                className="stock-step-input"
                type="text"
                value={packQty}
                placeholder="0"
                inputMode="numeric"
                pattern="[0-9]*"
                onIonInput={(event) => setPackQty(String(event.detail.value || "").replace(/\D/g, ""))}
              />
              <button type="button" onClick={incrementCases} className="stock-step-btn">
                <IonIcon icon={addOutline} />
              </button>
            </div>
          </div>

          <div className="stock-step-card stock-step-card-bottles">
            <div className="stock-step-title">
              <IonIcon icon={wineOutline} />
              Bottle
            </div>
            <div className="stock-stepper">
              <button type="button" onClick={decrementBottles} className="stock-step-btn">
                <IonIcon icon={removeOutline} />
              </button>
              <IonInput
                className="stock-step-input"
                type="text"
                value={bottleQty}
                placeholder="0"
                inputMode="numeric"
                pattern="[0-9]*"
                onIonInput={(event) =>
                  setBottleQty(String(event.detail.value || "").replace(/\D/g, ""))
                }
              />
              <button type="button" onClick={incrementBottles} className="stock-step-btn">
                <IonIcon icon={addOutline} />
              </button>
            </div>
          </div>

          <div className="stock-summary-card stock-summary-card-total">
            <h4>New Stock Summary</h4>
            <div className="stock-summary-grid">
              <div>
                <span>CASES</span>
                <strong>{enteredCases}</strong>
              </div>
              <div>
                <span>BOTTLES</span>
                <strong>{enteredBottles}</strong>
              </div>
              <div>
                <span>TOTAL</span>
                <strong>{enteredTotalBottles}</strong>
              </div>
            </div>
            <div className="stock-value-box">
              <span>Stock Value</span>
              <strong>{stockValueDisplay}</strong>
            </div>
          </div>

          <IonButton
            expand="block"
            fill="outline"
            className="stock-cancel-btn"
            onClick={() => {
              setShowStockModal(false);
              setSelectedRow(null);
            }}
          >
            Cancel
          </IonButton>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={showProofModal}
        onDidDismiss={() => {
          if (!creatingDiff) {
            setShowProofModal(false);
            setProofPhoto(null);
          }
        }}
        className="difference-proof-modal"
      >
        <IonContent fullscreen className="difference-proof-content">
          <div className="stock-sheet-header">
            <h2>Upload Proof</h2>
            <IonButton fill="clear" onClick={() => setShowProofModal(false)}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </div>

          <div className="difference-proof-body">
            <IonButton
              expand="block"
              fill={proofPhoto ? "outline" : "solid"}
              className="difference-proof-submit"
              disabled={creatingDiff || capturingProof}
              onClick={() => void handleCaptureProofPhoto()}
            >
              <IonIcon icon={proofPhoto ? refreshOutline : cameraOutline} slot="start" />
              {capturingProof ? "Opening Camera..." : proofPhoto ? "Retake Proof Photo" : "Take Proof Photo"}
            </IonButton>

            {proofPhoto ? (
              <IonItem lines="none" className="difference-proof-item">
                <IonLabel>
                  <h3>{proofPhoto.fileName}</h3>
                  <p>Captured from live camera and saved automatically to the configured diff image path.</p>
                  <img
                    src={proofPhoto.dataUrl}
                    alt="Captured proof"
                    style={{
                      display: "block",
                      width: "100%",
                      borderRadius: "12px",
                      marginTop: "12px",
                      objectFit: "cover",
                    }}
                  />
                </IonLabel>
              </IonItem>
            ) : null}

            <IonText color="medium" className="difference-proof-note">
              No local file picker is used here. Tap the camera button to capture proof directly.
            </IonText>

            <IonButton
              expand="block"
              className="difference-proof-submit"
              disabled={creatingDiff || capturingProof}
              onClick={() => void submitDiffBatch()}
            >
              <IonIcon icon={cloudUploadOutline} slot="start" />
              {creatingDiff ? "Saving..." : proofPhoto ? "Save Proof & Create" : "Create Without Photo"}
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </IonPage>
  );
}
