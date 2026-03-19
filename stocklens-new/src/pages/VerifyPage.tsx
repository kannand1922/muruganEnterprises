import {
  IonButton,
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
  useIonToast,
} from "@ionic/react";
import { addOutline, closeOutline, cubeOutline, removeOutline, wineOutline } from "ionicons/icons";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentCycle } from "../api/cyclesApi";
import { getWorkers } from "../api/metaApi";
import {
  finishUnfinishedStock,
  getVerifyMismatchedFinished,
  upsertUnfinishedStock,
  type VerifyMismatchedFinishedRow,
} from "../api/stockApi";
import { getCurrentLocationIdFromStorage } from "../config/location";
import { getCurrentPhoneIdFromStorage } from "../config/phone";
import { AppTopBar } from "../components/common/AppTopBar";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_OPERATOR_NAME_KEY = "stocklens_current_operator_name";

function parsePositiveInt(rawValue: string | null) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function getActivityDateKey(isoDateTime: string) {
  return String(isoDateTime || "").slice(0, 10);
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

export function VerifyPage() {
  const [presentToast] = useIonToast();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<VerifyMismatchedFinishedRow[]>([]);
  const [searchText, setSearchText] = useState("");
  const [itemFilter, setItemFilter] = useState("all");
  const [packFilter, setPackFilter] = useState("all");
  const [operatorId, setOperatorId] = useState<number | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [errorText, setErrorText] = useState("");
  const [selectedRow, setSelectedRow] = useState<VerifyMismatchedFinishedRow | null>(null);
  const [showStockModal, setShowStockModal] = useState(false);
  const [packQty, setPackQty] = useState("");
  const [bottleQty, setBottleQty] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadVerificationRows() {
    setLoading(true);
    setErrorText("");
    try {
      const queryParams = new URLSearchParams(location.search);
      const queryOperatorId = parsePositiveInt(queryParams.get("operatorId"));
      const storedOperatorId = parsePositiveInt(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
      const resolvedOperatorId = queryOperatorId || storedOperatorId;
      if (!resolvedOperatorId) {
        setRows([]);
        setErrorText("Select operator first in stock entry page.");
        return;
      }

      const [workers, cycleResult] = await Promise.all([getWorkers(), getCurrentCycle()]);
      if (!cycleResult.active || !cycleResult.cycle?.id) {
        setRows([]);
        setErrorText("No active cycle. Start a cycle first.");
        return;
      }

      const worker = workers.find((row) => row.id === resolvedOperatorId) || null;
      const resolvedOperatorName =
        worker?.name || localStorage.getItem(CURRENT_OPERATOR_NAME_KEY) || "";
      setOperatorName(resolvedOperatorName);
      setOperatorId(resolvedOperatorId);

      const currentLocationId = getCurrentLocationIdFromStorage();
      const result = await getVerifyMismatchedFinished({
        operatorId: resolvedOperatorId,
        cycleId: cycleResult.cycle.id,
        shopLocationId: currentLocationId || undefined,
      });
      setRows(result.rows || []);
    } catch (error) {
      setRows([]);
      const message = error instanceof Error ? error.message : "Failed to load verification rows";
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
    void loadVerificationRows();
  }, [location.search]);

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
  }, [rows, searchText, itemFilter, packFilter]);

  const selectedProductBpc = Number(selectedRow?.bpc) || 12;
  const enteredCases = Number.parseInt(packQty || "0", 10) || 0;
  const enteredBottles = Number.parseInt(bottleQty || "0", 10) || 0;
  const enteredTotalBottles = enteredCases * selectedProductBpc + enteredBottles;
  const currentStockBottles = Number(selectedRow?.currentStockBottles || 0);
  const diffBottles = enteredTotalBottles - currentStockBottles;
  const stockValueDisplay = `${enteredCases}.${String(enteredBottles).padStart(2, "0")}`;

  function openRowEditor(row: VerifyMismatchedFinishedRow) {
    const safeBpc = Number(row.bpc) || 12;
    const starting = bottlesToPackBottle(Number(row.enteredBottles || 0), safeBpc);
    setSelectedRow(row);
    setPackQty(starting.packs ? String(starting.packs) : "");
    setBottleQty(starting.bottles ? String(starting.bottles) : "");
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

  async function saveVerifiedStock() {
    if (!selectedRow) return;
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

    const activityDate = getActivityDateKey(selectedRow.activityDate);
    const quantityBottles = enteredTotalBottles;
    const currentStockValue = Number(selectedRow.currentStockBottles || 0);

    setSaving(true);
    try {
      await upsertUnfinishedStock({
        cycleId: selectedRow.cycleId,
        itemCode: selectedRow.itemCode,
        itemName: selectedRow.itemName,
        brandName: selectedRow.brandName || selectedRow.itemCode,
        packValue: selectedRow.packValue,
        bpc: selectedRow.bpc ?? null,
        mrp: selectedRow.mrp ?? null,
        shopLocationId: selectedRow.shopLocationId,
        activityDate,
        quantityBottles,
        currentStockBottles: currentStockValue,
        phoneId: currentPhoneId,
        lastUpdatedByWorkerId: operatorId,
        recheckShown: false,
      });

      await finishUnfinishedStock({
        cycleId: selectedRow.cycleId,
        itemCode: selectedRow.itemCode,
        shopLocationId: selectedRow.shopLocationId,
        activityDate,
        finishedByWorkerId: operatorId,
      });

      await loadVerificationRows();
      setShowStockModal(false);
      setSelectedRow(null);
      presentToast({
        message:
          quantityBottles === currentStockValue
            ? "Stock updated. Item cleared from unmatched list."
            : "Stock updated. Item is still unmatched.",
        color: quantityBottles === currentStockValue ? "success" : "warning",
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

  return (
    <IonPage>
      <AppTopBar
        title="Unmatched Products"
        endContent={
          operatorId ? (
            <span className="toolbar-title-tag unchecked">{operatorName || `#${operatorId}`}</span>
          ) : undefined
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
              disabled={itemFilter === "all" && packFilter === "all" && !searchText.trim()}
              onClick={() => {
                setItemFilter("all");
                setPackFilter("all");
                setSearchText("");
              }}
            >
              Clear
            </IonButton>
          </div>

          <div className="verify-summary-box">
            {searchText || itemFilter !== "all" || packFilter !== "all"
              ? `${filteredRows.length} of ${rows.length} products are unmatched`
              : `${rows.length} products are unmatched`}
          </div>

          {loading ? (
            <div className="stock-loading-wrap">
              <IonSpinner name="crescent" />
            </div>
          ) : errorText ? (
            <div className="operator-required-box">{errorText}</div>
          ) : filteredRows.length === 0 ? (
            <div className="stock-empty">
              {searchText || itemFilter !== "all" || packFilter !== "all"
                ? "No products found for the selected search or filters."
                : "No unmatched products."}
            </div>
          ) : (
            <div className="verify-list">
              {filteredRows.map((row) => (
                <div
                  key={`${row.shopLocationId}_${row.itemCode}_${row.id}`}
                  className="verify-row is-selectable"
                  onClick={() => openRowEditor(row)}
                >
                  <div className="verify-row-body">
                    <div className="verify-row-title">{row.brandName || row.itemName}</div>
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
              onClick={() => void saveVerifiedStock()}
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
    </IonPage>
  );
}
