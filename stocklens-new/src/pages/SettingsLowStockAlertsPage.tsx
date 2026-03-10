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

export function SettingsLowStockAlertsPage() {
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
        message: error instanceof Error ? error.message : "Failed to load notification settings",
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
      <AppTopBar title="Notification" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading notification settings...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Manage Notification Setup</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="low-stock-manage-grid">
              <div className="low-stock-manage-card">
                <div className="low-stock-manage-title">Notification Config</div>
                <div className="low-stock-manage-copy">
                  Select the target location and configure separate source locations for low-stock and nil-stock alerts.
                </div>
                <IonButton routerLink={`/settings/low-stock-alerts/config${locationSearch}`}>Open Config</IonButton>
              </div>

              <div className="low-stock-manage-card">
                <div className="low-stock-manage-title">Threshold Rules</div>
                <div className="low-stock-manage-copy">
                  Keep pack-size rules and product overrides on a separate screen so editing stays clear.
                </div>
                <IonButton fill="outline" routerLink={`/settings/low-stock-alerts/thresholds${locationSearch}`}>
                  Open Thresholds
                </IonButton>
              </div>

              <div className="low-stock-manage-card">
                <div className="low-stock-manage-title">Notification Settings</div>
                <div className="low-stock-manage-copy">
                  Review notification status, open device settings, and check push history on a separate page.
                </div>
                <IonButton fill="outline" routerLink={`/settings/low-stock-alerts/notifications${locationSearch}`}>
                  Open Notifications
                </IonButton>
              </div>

              <div className="low-stock-manage-card">
                <div className="low-stock-manage-title">FCM</div>
                <div className="low-stock-manage-copy">
                  Manage device token sync and choose which shop location this device should receive alerts for.
                </div>
                <IonButton fill="outline" routerLink="/settings/fcm">
                  Open FCM
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
