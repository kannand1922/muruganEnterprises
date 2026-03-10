import {
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
import { useLocation } from "react-router-dom";
import { getCurrentCycle } from "../api/cyclesApi";
import { getWorkers } from "../api/metaApi";
import {
  getVerifyMismatchedFinished,
  type VerifyMismatchedFinishedRow,
} from "../api/stockApi";
import { getCurrentLocationIdFromStorage } from "../config/location";
import { AppTopBar } from "../components/common/AppTopBar";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_OPERATOR_NAME_KEY = "stocklens_current_operator_name";

function parsePositiveInt(rawValue: string | null) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
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

  return (
    <IonPage>
      <AppTopBar title="Shop Verification" showBack backPath="/stock" showSettings={false} showLocationSwitcher={false} />
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
              ? `${filteredRows.length} of ${rows.length} products have mismatched values`
              : `${rows.length} products have mismatched values`}
          </div>

          {operatorId ? (
            <div className="verify-subtitle">
              Operator: {operatorName || `#${operatorId}`}
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
              {searchText || itemFilter !== "all" || packFilter !== "all"
                ? "No products found for the selected search or filters."
                : "No mismatched finished products."}
            </div>
          ) : (
            <div className="verify-list">
              {filteredRows.map((row) => (
                <div
                  key={`${row.shopLocationId}_${row.itemCode}_${row.id}`}
                  className="verify-row"
                >
                  <div className="verify-row-title">{row.brandName || row.itemName}</div>
                  <div className="verify-row-meta">
                    {row.packValue || "-"} • {row.itemName || "-"} • Code: {row.itemCode}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
