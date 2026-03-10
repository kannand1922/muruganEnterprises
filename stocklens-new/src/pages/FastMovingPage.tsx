import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonContent,
  IonItem,
  IonLabel,
  IonPage,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { getCurrentCycle } from "../api/cyclesApi";
import { getShopLocations, type ShopLocation } from "../api/metaApi";
import { getFastMovingSummary, type FastMovingRow } from "../api/stockApi";
import { AppTopBar } from "../components/common/AppTopBar";
import { getCurrentLocationIdFromStorage } from "../config/location";

type FastTab = "scanned" | "unchecked";

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)}`;
}

export function FastMovingPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<FastTab>("unchecked");
  const [location, setLocation] = useState<ShopLocation | null>(null);
  const [checkedDate, setCheckedDate] = useState("");
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [scannedRows, setScannedRows] = useState<FastMovingRow[]>([]);
  const [uncheckedRows, setUncheckedRows] = useState<FastMovingRow[]>([]);
  const [searchText, setSearchText] = useState("");

  async function loadFastMovingData() {
    setLoading(true);
    try {
      const [cycleResult, locations] = await Promise.all([getCurrentCycle(), getShopLocations()]);
      const currentLocationId = getCurrentLocationIdFromStorage();
      const selectedLocation =
        (currentLocationId && locations.find((row) => row.id === currentLocationId)) ||
        locations[0] ||
        null;
      setLocation(selectedLocation);

      if (!selectedLocation) {
        setScannedRows([]);
        setUncheckedRows([]);
        setCheckedDate(new Date().toISOString().slice(0, 10));
        return;
      }

      const summary = await getFastMovingSummary({
        shopLocationId: selectedLocation.id,
        cycleId: cycleResult.active ? cycleResult.cycle?.id || undefined : undefined,
      });

      setCheckedDate(summary.checkedDate);
      setLastModified(summary.lastBestSellingModifiedAt);
      setScannedRows(summary.scannedRows);
      setUncheckedRows(summary.uncheckedRows);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load fast moving summary",
        color: "danger",
        duration: 1800,
      });
      setScannedRows([]);
      setUncheckedRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFastMovingData();
  }, []);

  const activeRows = useMemo(() => (tab === "scanned" ? scannedRows : uncheckedRows), [tab, scannedRows, uncheckedRows]);
  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return activeRows;
    return activeRows.filter((row) => {
      const code = String(row.itemCode || "").toLowerCase();
      const itemName = String(row.itemName || "").toLowerCase();
      const brandName = String(row.brandName || "").toLowerCase();
      const pack = String(row.packValue || "").toLowerCase();
      return (
        code.includes(query) ||
        itemName.includes(query) ||
        brandName.includes(query) ||
        pack.includes(query)
      );
    });
  }, [activeRows, searchText]);
  const totalCount = scannedRows.length + uncheckedRows.length;

  return (
    <IonPage>
      <AppTopBar
        title={`Fast Moving - ${location?.locationName || "Location"}`}
        showBack
        backPath="/dashboard"
        showLocationSwitcher={false}
      />
      <IonContent fullscreen className="main-page-content ion-padding stock-entry-content fast-moving-content">
        <IonCard className="control-card fast-moving-card">
          <IonCardContent className="control-content">
            <div className="fast-moving-summary-box">
              <div className="fast-moving-title">
                Fast Moving ({location?.locationName || "Location"}) {scannedRows.length}/{totalCount}
              </div>
              <div className="fast-moving-subtitle">Checked for {checkedDate || formatDate(new Date().toISOString())}</div>
              <div className="fast-moving-subtitle">Best selling last modified: {formatDate(lastModified)}</div>
            </div>

            <IonSegment value={tab} onIonChange={(event) => setTab((event.detail.value as FastTab) || "unchecked")} className="fast-moving-segment">
              <IonSegmentButton value="scanned" className="fast-moving-segment-button">
                <IonLabel>SCANNED ({scannedRows.length})</IonLabel>
              </IonSegmentButton>
              <IonSegmentButton value="unchecked" className="fast-moving-segment-button">
                <IonLabel>UNCHECKED ({uncheckedRows.length})</IonLabel>
              </IonSegmentButton>
            </IonSegment>

            <IonSearchbar
              className="fast-moving-searchbar"
              value={searchText}
              placeholder="Search code / name / brand"
              debounce={120}
              onIonInput={(event) => setSearchText(event.detail.value || "")}
            />

            {loading ? (
              <div className="stock-loading-wrap">
                <IonSpinner name="crescent" />
                <IonText>Loading fast moving data...</IonText>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="stock-empty">
                {tab === "scanned"
                  ? "No fast moving items scanned today."
                  : "All items checked today."}
              </div>
            ) : (
              <div className="fast-moving-list">
                {filteredRows.map((row) => (
                  <IonItem key={`${tab}_${row.itemCode}_${row.packValue}`} lines="none" className="fast-moving-row">
                    <IonLabel>
                      <h3 className="result-brand">{row.brandName || row.itemName}</h3>
                      <p className="result-details">{row.itemName}</p>
                      <p className="result-code-line">Pack: {row.packValue || "-"}</p>
                      <p className="result-code-line">Code: {row.itemCode}</p>
                      {tab === "scanned" ? (
                        <p className="result-code-line">Edited: {formatDateTime(row.scannedAt)}</p>
                      ) : null}
                    </IonLabel>
                    {tab === "scanned" ? (
                      <IonBadge className="fast-moving-scanned-badge">Scanned</IonBadge>
                    ) : (
                      <IonBadge className="fast-moving-unchecked-badge">Pending</IonBadge>
                    )}
                  </IonItem>
                ))}
              </div>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
