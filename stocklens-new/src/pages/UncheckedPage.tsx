import {
  IonBadge,
  IonButton,
  IonCheckbox,
  IonContent,
  IonIcon,
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
import { cloudUploadOutline, closeOutline, printOutline } from "ionicons/icons";
import { useEffect, useMemo, useState } from "react";
import { getCurrentCycle } from "../api/cyclesApi";
import { getPrinters } from "../api/metaApi";
import {
  createDiffBatch,
  getVerifyUncheckedFinished,
  getVerifyMismatchedFinished,
  printVerificationList,
  type VerifyMismatchedFinishedRow,
  type VerifyUncheckedFinishedRow,
} from "../api/stockApi";
import { getCurrentLocationIdFromStorage } from "../config/location";
import { AppTopBar } from "../components/common/AppTopBar";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_PRINTER_ID_KEY = "stocklens_current_printer_id";

type RowFilter = "all" | "unchecked" | "mismatched";

type CombinedVerifyRow = {
  rowType: "unchecked" | "mismatched";
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
  enteredFormatted?: string;
  currentStockFormatted?: string;
  diffFormatted?: string;
};

function parsePositiveInt(rawValue: string | null) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function mapUncheckedRow(row: VerifyUncheckedFinishedRow): CombinedVerifyRow {
  return {
    rowType: "unchecked",
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
    itemCode: row.itemCode,
    itemName: row.itemName,
    brandName: row.brandName,
    packValue: row.packValue,
    shopLocationId: row.shopLocationId,
    shopLocationName: row.shopLocationName,
    bpc: row.bpc,
    mrp: row.mrp,
    id: row.id,
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
  const [selectedMismatchIds, setSelectedMismatchIds] = useState<Set<number>>(new Set());
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

      const [uncheckedResult, mismatchedResult] = await Promise.all([
        getVerifyUncheckedFinished({
          cycleId: cycleResult.cycle.id,
          shopLocationId: currentLocationId,
        }),
        getVerifyMismatchedFinished({
          cycleId: cycleResult.cycle.id,
          shopLocationId: currentLocationId,
        }),
      ]);

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

  const mismatchedRows = useMemo(
    () => filteredRows.filter((row) => row.rowType === "mismatched" && row.id),
    [filteredRows]
  );
  const selectedMismatchCount = selectedMismatchIds.size;

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

          {mismatchedRows.length > 0 ? (
            <div className="verify-diff-summary">
              <IonBadge color="warning">Mismatched: {mismatchedRows.length}</IonBadge>
              <IonBadge color="medium">Selected: {selectedMismatchCount}</IonBadge>
            </div>
          ) : null}

          <IonButton
            expand="block"
            className="difference-create-btn"
            disabled={loading || creatingDiff || selectedMismatchCount === 0}
            onClick={() => void handleCreateDiff()}
          >
            {creatingDiff ? "Creating..." : "Create Diff"}
          </IonButton>

          {locationName ? <div className="verify-subtitle">Location: {locationName}</div> : null}

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
                  className={`verify-row ${row.rowType === "mismatched" ? "is-selectable" : ""}`}
                >
                  {row.rowType === "mismatched" ? (
                    <IonCheckbox
                      className="verify-row-checkbox"
                      checked={row.id ? selectedMismatchIds.has(row.id) : false}
                      onIonChange={() => toggleMismatchSelection(row)}
                    />
                  ) : null}
                  <div className="verify-row-body">
                    <div className="verify-row-title">
                      {row.brandName || row.itemName}
                      <IonBadge color={row.rowType === "unchecked" ? "medium" : "warning"} style={{ marginLeft: 8 }}>
                        {row.rowType === "unchecked" ? "Unchecked" : "Mismatched"}
                      </IonBadge>
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
