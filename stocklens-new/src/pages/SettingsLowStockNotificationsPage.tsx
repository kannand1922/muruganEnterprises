import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonInput,
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  checkLowStockNow,
  getLowStockNotifications,
  getLowStockOverview,
  getLowStockSettings,
  getShopLocations,
  type LowStockNotificationRow,
  type LowStockOverview,
  type ShopLocation,
} from "../api/metaApi";
import {
  buildShopLocationSearch,
  formatNotificationDateTime,
  getTodayDateKey,
  parseShopLocationIdFromSearch,
} from "../components/low-stock/lowStockUtils";

type NotificationSummary = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  totalLowCount: number;
  totalSuccessCount: number;
  totalFailureCount: number;
};

export function SettingsLowStockNotificationsPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const routeLocation = useLocation();

  const [loading, setLoading] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [overview, setOverview] = useState<LowStockOverview | null>(null);
  const [notificationRows, setNotificationRows] = useState<LowStockNotificationRow[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<NotificationSummary | null>(null);
  const [notificationStatusFilter, setNotificationStatusFilter] = useState("all");
  const [notificationDateFrom, setNotificationDateFrom] = useState(getTodayDateKey());
  const [notificationDateTo, setNotificationDateTo] = useState(getTodayDateKey());

  const selectedLocation = useMemo(
    () => locations.find((row) => row.id === selectedLocationId) || null,
    [locations, selectedLocationId]
  );
  const selectedOverviewRow = useMemo(
    () => (overview?.rows || []).find((row) => row.shopLocationId === selectedLocationId) || null,
    [overview, selectedLocationId]
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

  async function loadOverviewData() {
    try {
      const summary = await getLowStockOverview();
      setOverview(summary);
    } catch {
      setOverview(null);
    }
  }

  async function loadNotificationSettings(shopLocationId: number) {
    const settings = await getLowStockSettings(shopLocationId);
    return settings;
  }

  async function loadNotificationHistory(shopLocationId: number) {
    setNotificationsLoading(true);
    try {
      const result = await getLowStockNotifications({
        shopLocationId,
        status: notificationStatusFilter,
        dateFrom: notificationDateFrom || undefined,
        dateTo: notificationDateTo || undefined,
      });
      setNotificationRows(result.rows || []);
      setNotificationSummary(result.summary || null);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load notification history",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function initializePage() {
    setLoading(true);
    try {
      await Promise.all([loadLocations(), loadOverviewData()]);
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

  async function onCheckAndSend() {
    if (!selectedLocationId) {
      presentToast({ message: "Select location first", color: "warning", duration: 1400 });
      return;
    }

    setCheckingNow(true);
    try {
      const result = await checkLowStockNow({ shopLocationId: selectedLocationId });
      await Promise.all([
        loadNotificationSettings(selectedLocationId),
        loadNotificationHistory(selectedLocationId),
        loadOverviewData(),
      ]);

      const notifyRow = (result.notifyResults || [])[0];
      if (!notifyRow) {
        presentToast({ message: "Low stock check completed", color: "success", duration: 1500 });
        return;
      }

      const message = notifyRow.sent
        ? `Sent alert to ${notifyRow.successCount || 0} device(s)`
        : notifyRow.reason === "no-fcm-tokens"
          ? "No registered FCM tokens for this location"
        : notifyRow.reason === "no-low-stock"
          ? "No low stock items for this location"
          : notifyRow.reason === "already-sent-for-today"
            ? "Alert already sent today"
          : "Low stock check completed";

      presentToast({
        message,
        color: notifyRow.sent ? "success" : "warning",
        duration: 1800,
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to run low stock check",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setCheckingNow(false);
    }
  }

  function applyTodayNotificationFilters() {
    const today = getTodayDateKey();
    setNotificationDateFrom(today);
    setNotificationDateTo(today);
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
      setNotificationRows([]);
      setNotificationSummary(null);
      return;
    }

    setLoading(true);
    void Promise.all([loadNotificationSettings(selectedLocationId), loadNotificationHistory(selectedLocationId)])
      .catch((error) => {
        presentToast({
          message: error instanceof Error ? error.message : "Failed to load notification data",
          color: "danger",
          duration: 1800,
        });
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  return (
    <IonPage>
      <AppTopBar
        title="Notification Settings"
        showBack
        showSettings={false}
        showLocationSwitcher={false}
        backPath={`/settings/low-stock-alerts${locationSearch}`}
      />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading notification data...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Notification Control</IonCardTitle>
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

              <div className="low-stock-status-grid">
                <div className="low-stock-status-item">
                  <span className="low-stock-status-label">Current Low Products</span>
                  <strong>{selectedOverviewRow?.lowCount ?? 0}</strong>
                </div>
              </div>
            </div>

            <IonNote className="low-stock-card-copy">
              Per-device ON/OFF is managed in <strong>Settings → Phones</strong>. Device token sync and alert
              location mapping are managed in <strong>Settings → FCM</strong>. Location-level ON/OFF is managed in
              <strong> Settings → Shop Locations</strong>.
            </IonNote>

            <div className="settings-actions settings-actions-inline low-stock-page-actions">
              <IonButton onClick={onCheckAndSend} disabled={checkingNow || !selectedLocationId}>
                {checkingNow ? "Checking..." : "Check & Send Push"}
              </IonButton>
              <IonButton fill="outline" routerLink="/settings/fcm">
                Open FCM
              </IonButton>
              <IonButton fill="outline" routerLink="/settings/shop-locations">
                Shop Locations
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card low-stock-history-card">
          <IonCardHeader>
            <IonCardTitle>Notification History</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="low-stock-history-filters">
              <div className="low-stock-field">
                <label className="low-stock-field-label">Status</label>
                <IonSelect
                  value={notificationStatusFilter}
                  interface="popover"
                  onIonChange={(event) => setNotificationStatusFilter(String(event.detail.value || "all"))}
                >
                  <IonSelectOption value="all">All</IonSelectOption>
                  <IonSelectOption value="sent">Sent</IonSelectOption>
                  <IonSelectOption value="failed">Failed</IonSelectOption>
                  <IonSelectOption value="skipped">Skipped</IonSelectOption>
                  <IonSelectOption value="pending">Pending</IonSelectOption>
                </IonSelect>
              </div>

              <div className="low-stock-field">
                <label className="low-stock-field-label">Date From</label>
                <IonInput
                  type="date"
                  value={notificationDateFrom}
                  onIonInput={(event) => setNotificationDateFrom(String(event.detail.value || ""))}
                />
              </div>

              <div className="low-stock-field">
                <label className="low-stock-field-label">Date To</label>
                <IonInput
                  type="date"
                  value={notificationDateTo}
                  onIonInput={(event) => setNotificationDateTo(String(event.detail.value || ""))}
                />
              </div>

              <div className="settings-actions settings-actions-inline low-stock-history-actions">
                <IonButton fill="outline" onClick={applyTodayNotificationFilters}>
                  Today
                </IonButton>
                <IonButton
                  fill="outline"
                  onClick={() => selectedLocationId && void loadNotificationHistory(selectedLocationId)}
                  disabled={notificationsLoading || !selectedLocationId}
                >
                  {notificationsLoading ? "Loading..." : "Apply"}
                </IonButton>
              </div>
            </div>

            <div className="low-stock-results-meta">
              <span>
                Location: <strong>{selectedLocation?.locationName || "No location selected"}</strong>
              </span>
              <span>
                Low items: <strong>{selectedOverviewRow?.lowCount ?? 0}</strong>
              </span>
            </div>

            {notificationSummary ? (
              <div className="low-stock-history-summary">
                <IonBadge color="medium">Total: {notificationSummary.total}</IonBadge>
                <IonBadge color="success">Sent: {notificationSummary.sent}</IonBadge>
                <IonBadge color="medium">Failed: {notificationSummary.failed}</IonBadge>
                <IonBadge color="medium">Skipped: {notificationSummary.skipped}</IonBadge>
                <IonBadge color="medium">Pending: {notificationSummary.pending}</IonBadge>
              </div>
            ) : null}

            {notificationsLoading ? (
              <IonNote>Loading notification history...</IonNote>
            ) : notificationRows.length === 0 ? (
              <IonText color="medium">No notification history for selected filters.</IonText>
            ) : (
              <div className="low-stock-history-list">
                {notificationRows.map((row) => (
                  <div key={row.id} className="low-stock-history-row">
                    <div>
                      <div className="low-stock-history-title">
                        {formatNotificationDateTime(row.notificationTime)} | {row.locationName}
                      </div>
                      <div className="low-stock-history-meta">
                        Low: {row.lowCount} | Success: {row.successCount} | Failure: {row.failureCount}
                      </div>
                      <div className="low-stock-history-meta">
                        Trigger: {row.trigger || "-"} | Reason: {row.reason || "-"}
                      </div>
                    </div>
                    <IonBadge
                      color={row.status === "sent" ? "success" : row.status === "failed" ? "danger" : "medium"}
                    >
                      {row.status}
                    </IonBadge>
                  </div>
                ))}
              </div>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
