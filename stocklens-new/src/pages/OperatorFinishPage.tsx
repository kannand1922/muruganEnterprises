import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonItem,
  IonLabel,
  IonPage,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentCycle } from "../api/cyclesApi";
import { getShopLocations, getWorkers, type ShopLocation } from "../api/metaApi";
import {
  finishUnfinishedByOperator,
  getUnfinishedStockByOperator,
  type UnfinishedStockRow,
} from "../api/stockApi";
import { AppTopBar } from "../components/common/AppTopBar";
import { CURRENT_LOCATION_ID_KEY, LOCATION_CHANGED_EVENT, getCurrentLocationIdFromStorage } from "../config/location";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";
const CURRENT_OPERATOR_NAME_KEY = "stocklens_current_operator_name";

function parsePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function formatPackBottle(totalBottles: number, bpc: number | null | undefined) {
  const safeBpc = Math.max(1, Number(bpc) || 1);
  const safeTotal = Math.max(0, Number(totalBottles) || 0);
  const packs = Math.floor(safeTotal / safeBpc);
  const bottles = safeTotal % safeBpc;
  return `${packs}.${String(bottles).padStart(2, "0")}`;
}

function isNonZeroDiffRow(row: UnfinishedStockRow) {
  return Number(row.diffBottles || 0) !== 0;
}

export function OperatorFinishPage() {
  const [presentToast] = useIonToast();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [activeCycleId, setActiveCycleId] = useState<number | null>(null);
  const [activeCycleSno, setActiveCycleSno] = useState<number | null>(null);
  const [currentLocationId, setCurrentLocationId] = useState<number | null>(null);
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);
  const [selectedOperatorName, setSelectedOperatorName] = useState("");
  const [unfinishedRows, setUnfinishedRows] = useState<UnfinishedStockRow[]>([]);
  const [locations, setLocations] = useState<ShopLocation[]>([]);

  const locationById = useMemo(
    () => new Map<number, ShopLocation>(locations.map((row) => [row.id, row])),
    [locations]
  );
  const currentLocation = currentLocationId ? locationById.get(currentLocationId) || null : null;

  async function loadOperatorUnfinished(
    cycleId: number,
    operatorId: number,
    shopLocationId: number
  ) {
    const rows = await getUnfinishedStockByOperator(cycleId, operatorId, shopLocationId);
    setUnfinishedRows(rows.filter(isNonZeroDiffRow));
  }

  async function loadPageData() {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams(location.search);
      const queryOperatorId = parsePositiveInt(queryParams.get("operatorId"));
      const storedOperatorId = parsePositiveInt(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
      const operatorId = queryOperatorId || storedOperatorId;
      setSelectedOperatorId(operatorId);

      const [cycleResult, workerRows, locationRows] = await Promise.all([
        getCurrentCycle(),
        getWorkers(),
        getShopLocations(),
      ]);

      setLocations(locationRows);
      const storedLocationId = getCurrentLocationIdFromStorage();
      const validLocationId =
        (storedLocationId &&
          locationRows.some((row) => row.id === storedLocationId) &&
          storedLocationId) ||
        locationRows[0]?.id ||
        null;
      setCurrentLocationId(validLocationId);

      const selectedOperator =
        (operatorId && workerRows.find((row) => row.id === operatorId)) || null;
      const fallbackName = (localStorage.getItem(CURRENT_OPERATOR_NAME_KEY) || "").trim();
      setSelectedOperatorName(selectedOperator?.name || fallbackName || "");

      if (!operatorId || !validLocationId) {
        setUnfinishedRows([]);
        setActiveCycleId(null);
        setActiveCycleSno(null);
        return;
      }

      if (!cycleResult.active || !cycleResult.cycle) {
        setUnfinishedRows([]);
        setActiveCycleId(null);
        setActiveCycleSno(null);
        return;
      }

      setActiveCycleId(cycleResult.cycle.id);
      setActiveCycleSno(cycleResult.cycle.sno ?? null);
      await loadOperatorUnfinished(cycleResult.cycle.id, operatorId, validLocationId);
    } catch (error) {
      setUnfinishedRows([]);
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load operator unfinished list",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  async function finishAllForOperator() {
    if (!selectedOperatorId || !activeCycleId || !currentLocationId) {
      presentToast({
        message: "Select operator, location and active cycle first.",
        color: "warning",
        duration: 1400,
      });
      return;
    }

    if (unfinishedRows.length === 0) {
      presentToast({ message: "No diff rows to finish.", color: "medium", duration: 1300 });
      return;
    }

    setFinishing(true);
    try {
      const result = await finishUnfinishedByOperator({
        cycleId: activeCycleId,
        operatorId: selectedOperatorId,
        shopLocationId: currentLocationId,
        finishedByWorkerId: selectedOperatorId,
      });
      await loadOperatorUnfinished(activeCycleId, selectedOperatorId, currentLocationId);
      const movedMessage = `${result.finishedCount} item(s) moved to finished.`;
      const printMessage = result.print?.message ? ` ${result.print.message}` : "";
      const toastColor =
        result.print && !result.print.success && !result.print.skipped ? "warning" : "success";
      presentToast({
        message: `${movedMessage}${printMessage}`,
        color: toastColor,
        duration: 2200,
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to finish unfinished rows",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setFinishing(false);
    }
  }

  useEffect(() => {
    void loadPageData();
  }, [location.search]);

  useEffect(() => {
    function onLocationChanged(event: Event) {
      const custom = event as CustomEvent<ShopLocation>;
      const nextId = parsePositiveInt(custom.detail?.id);
      if (!nextId) return;
      setCurrentLocationId(nextId);
      localStorage.setItem(CURRENT_LOCATION_ID_KEY, String(nextId));
      if (activeCycleId && selectedOperatorId) {
        void loadOperatorUnfinished(activeCycleId, selectedOperatorId, nextId);
      }
    }
    window.addEventListener(LOCATION_CHANGED_EVENT, onLocationChanged as EventListener);
    return () => {
      window.removeEventListener(LOCATION_CHANGED_EVENT, onLocationChanged as EventListener);
    };
  }, [activeCycleId, selectedOperatorId]);

  const showMissingOperatorMessage = !loading && !selectedOperatorId;
  const hasActiveCycle = Boolean(activeCycleId);

  return (
    <IonPage>
      <AppTopBar title="Finish Unfinished" />
      <IonContent fullscreen className="main-page-content ion-padding stock-entry-content finish-operator-content">
        <IonCard className="control-card">
          <IonCardContent className="control-content">
            <div className="finish-summary-top">
              <div className="finish-summary-head">
                <div className="finish-operator-name">
                  {selectedOperatorName
                    ? `Operator: ${selectedOperatorName}`
                    : "Select operator in stock entry first"}
                </div>
              </div>
              <IonButton
                className="stock-finish-top-button"
                onClick={() => void finishAllForOperator()}
                disabled={
                  finishing ||
                  loading ||
                  !hasActiveCycle ||
                  !selectedOperatorId ||
                  !currentLocationId ||
                  unfinishedRows.length === 0
                }
              >
                {finishing ? "Finishing..." : "Finish"}
              </IonButton>
            </div>

            <div className="finish-summary-meta-row">
              <IonBadge className="finish-count-chip">{unfinishedRows.length} diff item(s)</IonBadge>
            </div>

            {loading ? (
              <div className="stock-loading-wrap">
                <IonSpinner name="crescent" />
                <IonText>Loading unfinished items...</IonText>
              </div>
            ) : showMissingOperatorMessage ? (
              <div className="operator-required-box">Select operator first in stock entry page.</div>
            ) : !hasActiveCycle ? (
              <div className="operator-required-box">No active cycle. Start a cycle first.</div>
            ) : unfinishedRows.length === 0 ? (
              <div className="stock-empty">No non-zero diff rows for this operator.</div>
            ) : (
              <div className="search-results-container finish-result-list">
                {unfinishedRows.map((row) => {
                  const locationName = locationById.get(row.shopLocationId)?.locationName || `#${row.shopLocationId}`;
                  return (
                    <IonItem key={row.id} lines="none" className="search-result-items finish-result-item">
                      <IonLabel>
                        <h3 className="result-brand">{row.itemName || row.itemCode}</h3>
                        <p className="result-details">
                          {(row.brandName || "Unknown")} | {row.packValue || "-"} | {locationName}
                        </p>
                        <p className="result-code-line">
                          Code: {row.itemCode} | Qty: {formatPackBottle(row.quantityBottles, row.bpc)}
                        </p>
                      </IonLabel>
                    </IonItem>
                  );
                })}
              </div>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
