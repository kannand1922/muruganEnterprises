import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonNote,
  IonPage,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/common/AppTopBar";
import { getShopLocations, type ShopLocation } from "../api/metaApi";
import { buildShopLocationSearch, parseShopLocationIdFromSearch } from "../components/low-stock/lowStockUtils";

export function SettingsHighStockAlertsPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const routeLocation = useLocation();

  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);

  const selectedLocation = useMemo(
    () => locations.find((row) => row.id === selectedLocationId) || null,
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

  async function initializePage() {
    setLoading(true);
    try {
      await loadLocations();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load high stock settings",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
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
      return;
    }

    history.replace({
      pathname: routeLocation.pathname,
      search: buildShopLocationSearch(routeLocation.search, selectedLocationId),
    });
  }, [selectedLocationId]);

  return (
    <IonPage>
      <AppTopBar title="High Stock" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading high stock settings...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Manage High Stock Setup</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="low-stock-manage-grid">
              <div className="low-stock-manage-card">
                <div className="low-stock-manage-title">Threshold Rules</div>
                <div className="low-stock-manage-copy">
                  Set pack-size rules and product overrides for excess stock. Products above the threshold appear in
                  the high stock screen.
                </div>
                <IonButton routerLink={`/settings/high-stock-alerts/thresholds${locationSearch}`}>
                  Open Thresholds
                </IonButton>
              </div>

              <div className="low-stock-manage-card">
                <div className="low-stock-manage-title">Stock View</div>
                <div className="low-stock-manage-copy">
                  Open the live high stock page to review location-wise excess products using the current master CSV.
                </div>
                <IonButton fill="outline" routerLink={`/stock/high-stock${locationSearch}`}>
                  Open High Stock
                </IonButton>
              </div>
            </div>

            <IonNote className="low-stock-card-copy">
              Selected location: <strong>{selectedLocation?.locationName || "No location selected"}</strong>
            </IonNote>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
