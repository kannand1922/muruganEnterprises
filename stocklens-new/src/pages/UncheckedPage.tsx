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
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import {
  addOutline,
  cloudUploadOutline,
  closeOutline,
  cubeOutline,
  printOutline,
  removeOutline,
  wineOutline,
} from "ionicons/icons";
import { useEffect, useMemo, useState } from "react";
import { getCurrentCycle } from "../api/cyclesApi";
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

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_PRINTER_ID_KEY = "stocklens_current_printer_id";

type RowFilter = "all" | "unchecked" | "mismatched";

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

function getMasterStockBottles(product: MasterProduct, location: ShopLocation | null) {
  const safeBpc = Number(product.bpc) || 12;
  const locationCodeKey = normalizeLocationKey(location?.locationCode);
  const locationNameKey = normalizeLocationKey(location?.locationName);
  const locationTypeKey = normalizeLocationKey(location?.locationType || "");
  const locationStocks = product.locationStocks || {};
  const source =
    (locationCodeKey && locationStocks[locationCodeKey]) ||
    (locationNameKey && locationStocks[locationNameKey]) ||
    (locationTypeKey && locationStocks[locationTypeKey]) ||
    product.shopStock;
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
  const [itemFilter, setItemFilter] = useState("all");
  const [packFilter, setPackFilter] = useState("all");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
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
  const [proofPathInput, setProofPathInput] = useState("");
  const [proofFileName, setProofFileName] = useState("");
  const [creatingDiff, setCreatingDiff] = useState(false);

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
        getAllMasterProducts(10000),
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

  useEffect(() => {
    if (itemFilter !== "all" && !itemOptions.includes(itemFilter)) {
      setItemFilter("all");
    }
  }, [itemFilter, itemOptions]);

  useEffect(() => {
    if (packFilter !== "all" && !packOptions.includes(packFilter)) {
      setPackFilter("all");
    }
  }, [packFilter, packOptions]);

  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      if (rowFilter !== "all" && row.rowType !== rowFilter) {
        return false;
      }
      if (itemFilter !== "all" && String(row.itemName || "").trim() !== itemFilter) {
        return false;
      }
      if (packFilter !== "all" && String(row.packValue || "").trim() !== packFilter) {
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
  }, [rows, searchText, itemFilter, packFilter, rowFilter]);

  const uncheckedCount = useMemo(
    () => rows.filter((row) => row.rowType === "unchecked").length,
    [rows]
  );
  const mismatchedCount = useMemo(
    () => rows.filter((row) => row.rowType === "mismatched").length,
    [rows]
  );
  const rowFilterLabel = useMemo(() => {
    if (rowFilter === "unchecked") {
      return `Unchecked (${uncheckedCount})`;
    }
    if (rowFilter === "mismatched") {
      return `Mismatched (${mismatchedCount})`;
    }
    return `All (${rows.length})`;
  }, [mismatchedCount, rowFilter, rows.length, uncheckedCount]);

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
        rowFilter === "mismatched" ? "unmatched" : rowFilter === "unchecked" ? "unchecked" : "unchecked";
      const filterLabel =
        rowFilter === "mismatched"
          ? "MISMATCHED"
          : rowFilter === "unchecked"
            ? "UNCHECKED"
            : "FILTERED UNCHECKED";

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
        proofImagePath: proofPathInput.trim() || undefined,
        proofImageName: proofFileName.trim() || undefined,
      });
      const printMessage = result.print?.message ? ` ${result.print.message}` : "";
      const toastColor = result.print && !result.print.success && !result.print.skipped ? "warning" : "success";
      presentToast({
        message: `${result.movedCount} item(s) moved to diff batch #${result.batch.id}.${printMessage}`,
        color: toastColor,
        duration: 2200,
      });
      setShowProofModal(false);
      setProofPathInput("");
      setProofFileName("");
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
            <IonItem lines="none" className="search-filter-item unchecked-filter-item">
              <IonLabel>Type</IonLabel>
              <IonSelect
                value={rowFilter}
                selectedText={rowFilterLabel}
                interface="popover"
                onIonChange={(event) => setRowFilter((event.detail.value as RowFilter) || "all")}
              >
                <IonSelectOption value="all">All ({rows.length})</IonSelectOption>
                <IonSelectOption value="unchecked">Unchecked ({uncheckedCount})</IonSelectOption>
                <IonSelectOption value="mismatched">Mismatched ({mismatchedCount})</IonSelectOption>
              </IonSelect>
            </IonItem>

            <IonItem lines="none" className="search-filter-item unchecked-filter-item">
              <IonLabel>Item</IonLabel>
              <IonSelect
                value={itemFilter}
                interface="popover"
                onIonChange={(event) => setItemFilter(String(event.detail.value || "all"))}
              >
                <IonSelectOption value="all">All Items</IonSelectOption>
                {itemOptions.map((itemName) => (
                  <IonSelectOption key={itemName} value={itemName}>
                    {itemName}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            <IonItem lines="none" className="search-filter-item unchecked-filter-item">
              <IonLabel>Pack</IonLabel>
              <IonSelect
                value={packFilter}
                interface="popover"
                onIonChange={(event) => setPackFilter(String(event.detail.value || "all"))}
              >
                <IonSelectOption value="all">All Packs</IonSelectOption>
                {packOptions.map((packValue) => (
                  <IonSelectOption key={packValue} value={packValue}>
                    {packValue}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            <IonButton
              fill="solid"
              className="search-filter-cancel-btn unchecked-filter-clear-btn"
              disabled={rowFilter === "all" && itemFilter === "all" && packFilter === "all" && !searchText.trim()}
              onClick={() => {
                setRowFilter("all");
                setItemFilter("all");
                setPackFilter("all");
                setSearchText("");
              }}
            >
              Clear
            </IonButton>
          </div>

          <div className="verify-summary-box">
            {searchText || rowFilter !== "all" || itemFilter !== "all" || packFilter !== "all"
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
              {searchText || rowFilter !== "all" || itemFilter !== "all" || packFilter !== "all"
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
                    {row.rowType === "mismatched" ? (
                      <div className="verify-row-meta">
                        Entered: {row.enteredFormatted || "-"} • Current: {row.currentStockFormatted || "-"} • Diff:{" "}
                        {row.diffFormatted || "-"}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </IonContent>

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
            setProofPathInput("");
            setProofFileName("");
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
            <IonItem lines="none" className="difference-proof-item">
              <IonLabel position="stacked">Select image file (optional)</IonLabel>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setProofFileName(file?.name || "");
                }}
              />
            </IonItem>

            <IonItem lines="none" className="difference-proof-item">
              <IonLabel position="stacked">Proof path override (optional)</IonLabel>
              <input
                type="text"
                value={proofPathInput}
                onChange={(event) => setProofPathInput(event.target.value)}
                placeholder="/image/diff/2026-03-16/diff_12_cycle_5.jpg"
              />
            </IonItem>

            <IonText color="medium" className="difference-proof-note">
              If no path is provided, the system generates one automatically.
            </IonText>

            <IonButton
              expand="block"
              className="difference-proof-submit"
              disabled={creatingDiff}
              onClick={() => void submitDiffBatch()}
            >
              <IonIcon icon={cloudUploadOutline} slot="start" />
              {creatingDiff ? "Saving..." : "Save Proof & Create"}
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </IonPage>
  );
}
