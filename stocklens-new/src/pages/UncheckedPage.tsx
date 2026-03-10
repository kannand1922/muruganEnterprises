import {
  IonBadge,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonPage,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { getCurrentCycle } from "../api/cyclesApi";
import {
  getVerifyUncheckedFinished,
  getVerifyMismatchedFinished,
  type VerifyMismatchedFinishedRow,
  type VerifyUncheckedFinishedRow,
} from "../api/stockApi";
import { getCurrentLocationIdFromStorage } from "../config/location";
import { AppTopBar } from "../components/common/AppTopBar";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";

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

  async function loadUncheckedRows() {
    setLoading(true);
    setErrorText("");
    try {
      const currentLocationId = getCurrentLocationIdFromStorage();
      if (!currentLocationId) {
        setRows([]);
        setErrorText("Select location first in stock entry page.");
        return;
      }

      const cycleResult = await getCurrentCycle();
      if (!cycleResult.active || !cycleResult.cycle?.id) {
        setRows([]);
        setErrorText("No active cycle. Start a cycle first.");
        return;
      }

      const operatorId = parsePositiveInt(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
      const [uncheckedResult, mismatchedResult] = await Promise.all([
        getVerifyUncheckedFinished({
          cycleId: cycleResult.cycle.id,
          shopLocationId: currentLocationId,
        }),
        operatorId
          ? getVerifyMismatchedFinished({
              operatorId,
              cycleId: cycleResult.cycle.id,
              shopLocationId: currentLocationId,
            })
          : Promise.resolve({ rows: [] as VerifyMismatchedFinishedRow[] }),
      ]);

      setRows([
        ...(uncheckedResult.rows || []).map(mapUncheckedRow),
        ...(mismatchedResult.rows || []).map(mapMismatchedRow),
      ]);
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
                  className="verify-row"
                >
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
              ))}
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
