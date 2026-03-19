import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonToggle,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  getLowStockSettings,
  getNilStockSettings,
  getShopLocations,
  saveLowStockSettings,
  saveNilStockSettings,
  type LowStockSettings,
  type NilStockSettings,
  type ShopLocation,
} from "../api/metaApi";
import { buildShopLocationSearch, parseShopLocationIdFromSearch } from "../components/low-stock/lowStockUtils";

function buildLowStockSettingsPayload(settings: LowStockSettings, nextSourceLocationId: number | null) {
  return {
    sourceLocationId: nextSourceLocationId,
    packRules: (settings.packRules || []).map((row) => ({
      packValue: String(row.packValue || "").trim(),
      thresholdBottles: Number(row.thresholdBottles || 0),
    })),
    productRules: (settings.productRules || []).map((row) => ({
      itemCode: String(row.itemCode || "").trim(),
      thresholdBottles: Number(row.thresholdBottles || 0),
    })),
  };
}

export function SettingsNotificationConfigPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const routeLocation = useLocation();

  const [loading, setLoading] = useState(false);
  const [lowSaving, setLowSaving] = useState(false);
  const [nilSaving, setNilSaving] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [lowStockSettings, setLowStockSettings] = useState<LowStockSettings | null>(null);
  const [nilStockSettings, setNilStockSettings] = useState<NilStockSettings | null>(null);

  const selectedLocation = useMemo(
    () => locations.find((row) => row.id === selectedLocationId) || null,
    [locations, selectedLocationId]
  );
  const sourceLocationOptions = useMemo(
    () => locations.filter((row) => row.id !== selectedLocationId),
    [locations, selectedLocationId]
  );
  const locationSearch = buildShopLocationSearch(routeLocation.search, selectedLocationId);

  function updateSelectedLocation(shopLocationId: number) {
    setSelectedLocationId(shopLocationId);
    history.replace({
      pathname: routeLocation.pathname,
      search: buildShopLocationSearch(routeLocation.search, shopLocationId),
    });
  }

  async function loadLocations() {
    const list = await getShopLocations();
    setLocations(list);

    const routeLocationId = parseShopLocationIdFromSearch(routeLocation.search);
    const validRoute = routeLocationId && list.some((row) => row.id === routeLocationId) ? routeLocationId : null;
    const fallback = validRoute || list[0]?.id || null;
    setSelectedLocationId((current) => {
      if (current && list.some((row) => row.id === current)) return current;
      return fallback;
    });
  }

  async function loadSettings(shopLocationId: number) {
    const [low, nil] = await Promise.all([
      getLowStockSettings(shopLocationId),
      getNilStockSettings(shopLocationId).catch(() => ({
        shopLocationId,
        locationCode: "",
        locationName: "",
        sourceLocationId: null,
        sourceLocationCode: "",
        sourceLocationName: "",
        notificationsEnabled: true,
      })),
    ]);
    setLowStockSettings(low);
    setNilStockSettings(nil);
  }

  async function initializePage() {
    setLoading(true);
    try {
      await loadLocations();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load notification config",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveLowSourceLocation(nextSourceLocationId: number | null) {
    if (!selectedLocationId || !lowStockSettings) return;

    setLowSaving(true);
    setLowStockSettings((current) =>
      current
        ? {
            ...current,
            sourceLocationId: nextSourceLocationId,
            sourceLocationCode:
              sourceLocationOptions.find((row) => row.id === nextSourceLocationId)?.locationCode || "",
            sourceLocationName:
              sourceLocationOptions.find((row) => row.id === nextSourceLocationId)?.locationName || "",
          }
        : current
    );

    try {
      const saved = await saveLowStockSettings(
        selectedLocationId,
        buildLowStockSettingsPayload(lowStockSettings, nextSourceLocationId)
      );
      setLowStockSettings(saved);
      presentToast({ message: "Low stock source saved", color: "success", duration: 1200 });
    } catch (error) {
      await loadSettings(selectedLocationId);
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save low stock source",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLowSaving(false);
    }
  }

  async function saveNilSettings(nextSourceLocationId: number | null, nextNotificationsEnabled: boolean) {
    if (!selectedLocationId) return;

    setNilSaving(true);
    setNilStockSettings((current) => ({
      ...(current || {
        shopLocationId: selectedLocationId,
        locationCode: selectedLocation?.locationCode || "",
        locationName: selectedLocation?.locationName || "",
      }),
      sourceLocationId: nextSourceLocationId,
      sourceLocationCode:
        sourceLocationOptions.find((row) => row.id === nextSourceLocationId)?.locationCode || "",
      sourceLocationName:
        sourceLocationOptions.find((row) => row.id === nextSourceLocationId)?.locationName || "",
      notificationsEnabled: nextNotificationsEnabled,
    }));

    try {
      const saved = await saveNilStockSettings(selectedLocationId, {
        sourceLocationId: nextSourceLocationId,
        notificationsEnabled: nextNotificationsEnabled,
      });
      setNilStockSettings(saved);
      presentToast({ message: "Nil stock config saved", color: "success", duration: 1200 });
    } catch (error) {
      await loadSettings(selectedLocationId);
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save nil stock config",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setNilSaving(false);
    }
  }

  useEffect(() => {
    void initializePage();
  }, []);

  useEffect(() => {
    const routeLocationId = parseShopLocationIdFromSearch(routeLocation.search);
    if (!routeLocationId) return;
    if (!locations.some((row) => row.id === routeLocationId)) return;
    if (selectedLocationId === routeLocationId) return;
    setSelectedLocationId(routeLocationId);
  }, [routeLocation.search, locations, selectedLocationId]);

  useEffect(() => {
    if (!selectedLocationId) {
      setLowStockSettings(null);
      setNilStockSettings(null);
      return;
    }

    setLoading(true);
    void loadSettings(selectedLocationId)
      .catch((error) => {
        presentToast({
          message: error instanceof Error ? error.message : "Failed to load location config",
          color: "danger",
          duration: 1800,
        });
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  return (
    <IonPage>
      <AppTopBar
        title="Notification Config"
        showBack
        showSettings={false}
        showLocationSwitcher={false}
        backPath={`/settings/low-stock-alerts${locationSearch}`}
      />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading notification config...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Selected Location</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="low-stock-config-grid">
              <div className="low-stock-field">
                <label className="low-stock-field-label">Shop Location</label>
                <IonSelect
                  value={selectedLocationId ?? undefined}
                  interface="popover"
                  placeholder="Select location"
                  onIonChange={(event) => {
                    const next = Number(event.detail.value);
                    if (Number.isFinite(next) && next > 0) {
                      updateSelectedLocation(Math.trunc(next));
                    }
                  }}
                >
                  {locations.map((row) => (
                    <IonSelectOption key={row.id} value={row.id}>
                      {row.locationName} ({row.locationCode})
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </div>
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Low Stock Config</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="low-stock-config-grid">
              <div className="low-stock-field">
                <label className="low-stock-field-label">Source Location</label>
                <IonSelect
                  value={lowStockSettings?.sourceLocationId !== null && lowStockSettings?.sourceLocationId !== undefined
                    ? String(lowStockSettings.sourceLocationId)
                    : "none"}
                  interface="popover"
                  disabled={!selectedLocationId || loading || lowSaving}
                  onIonChange={(event) => {
                    const nextRaw = event.detail.value;
                    const nextSourceLocationId =
                      nextRaw === "none" || nextRaw === undefined || nextRaw === null || nextRaw === ""
                        ? null
                        : Number.isFinite(Number(nextRaw)) && Number(nextRaw) > 0
                          ? Math.trunc(Number(nextRaw))
                          : lowStockSettings?.sourceLocationId ?? null;
                    void saveLowSourceLocation(nextSourceLocationId);
                  }}
                >
                  <IonSelectOption value="none">No source filter</IonSelectOption>
                  {sourceLocationOptions.map((row) => (
                    <IonSelectOption key={row.id} value={String(row.id)}>
                      {row.locationName} ({row.locationCode})
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </div>

              <div className="low-stock-switch-row">
                <div>
                  <div className="low-stock-switch-title">{selectedLocation?.locationName || "No location selected"}</div>
                  <div className="low-stock-switch-subtitle">
                    Product rules override pack-size rules. Low stock rows are shown only when the source
                    location has at least 1 bottle in brands.csv.
                  </div>
                </div>
              </div>
            </div>

            <IonNote className="low-stock-card-copy">
              This page controls notification routing. Threshold values are edited separately.
            </IonNote>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Nil Stock Config</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="low-stock-config-grid">
              <div className="low-stock-field">
                <label className="low-stock-field-label">Source Location</label>
                <IonSelect
                  value={nilStockSettings?.sourceLocationId !== null && nilStockSettings?.sourceLocationId !== undefined
                    ? String(nilStockSettings.sourceLocationId)
                    : "none"}
                  interface="popover"
                  disabled={!selectedLocationId || loading || nilSaving}
                  onIonChange={(event) => {
                    const nextRaw = event.detail.value;
                    const nextSourceLocationId =
                      nextRaw === "none" || nextRaw === undefined || nextRaw === null || nextRaw === ""
                        ? null
                        : Number.isFinite(Number(nextRaw)) && Number(nextRaw) > 0
                          ? Math.trunc(Number(nextRaw))
                          : nilStockSettings?.sourceLocationId ?? null;
                    void saveNilSettings(
                      nextSourceLocationId,
                      Boolean(nilStockSettings?.notificationsEnabled ?? true)
                    );
                  }}
                >
                  <IonSelectOption value="none">No source location</IonSelectOption>
                  {sourceLocationOptions.map((row) => (
                    <IonSelectOption key={row.id} value={String(row.id)}>
                      {row.locationName} ({row.locationCode})
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </div>

              <div className="low-stock-switch-row">
                <div>
                  <div className="low-stock-switch-title">Nil Stock Notifications</div>
                  <div className="low-stock-switch-subtitle">
                    Send nil stock alerts only when the selected target location is zero and the source
                    location has at least 1 bottle in brands.csv.
                  </div>
                </div>
                <IonToggle
                  checked={Boolean(nilStockSettings?.notificationsEnabled ?? true)}
                  disabled={!selectedLocationId || loading || nilSaving}
                  onIonChange={(event) => {
                    void saveNilSettings(
                      nilStockSettings?.sourceLocationId ?? null,
                      Boolean(event.detail.checked)
                    );
                  }}
                />
              </div>
            </div>

            <IonNote className="low-stock-card-copy">
              Nil stock is tracked separately from low stock and resets daily on first run.
            </IonNote>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
