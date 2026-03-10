import { IonContent, IonNote, IonPage, useIonToast } from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/common/AppTopBar";
import { LowStockOverviewCard } from "../components/low-stock/LowStockOverviewCard";
import { LowStockResultsCard } from "../components/low-stock/LowStockResultsCard";
import {
  getLowStockOverview,
  getLowStockProducts,
  getShopLocations,
  type LowStockOverview,
  type LowStockProductRow,
  type ShopLocation,
} from "../api/metaApi";
import { buildShopLocationSearch, parseShopLocationIdFromSearch } from "../components/low-stock/lowStockUtils";

export function StockLowStockPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const routeLocation = useLocation();

  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [overview, setOverview] = useState<LowStockOverview | null>(null);
  const [lowRows, setLowRows] = useState<LowStockProductRow[]>([]);

  const selectedLocation = useMemo(
    () => locations.find((row) => row.id === selectedLocationId) || null,
    [locations, selectedLocationId]
  );
  const selectedOverviewRow = useMemo(
    () => (overview?.rows || []).find((row) => row.shopLocationId === selectedLocationId) || null,
    [overview, selectedLocationId]
  );

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

  async function loadLocationData(shopLocationId: number) {
    const products = await getLowStockProducts(shopLocationId);
    setLowRows(products.rows || []);
  }

  async function initializePage() {
    setLoading(true);
    try {
      await Promise.all([loadLocations(), loadOverviewData()]);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load low stock page",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  async function refreshLowStockList() {
    if (!selectedLocationId) {
      presentToast({ message: "Select location first", color: "warning", duration: 1400 });
      return;
    }

    setLoading(true);
    try {
      await Promise.all([loadLocationData(selectedLocationId), loadOverviewData()]);
      presentToast({ message: "Low stock list refreshed", color: "success", duration: 1200 });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to refresh low stock list",
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
      setLowRows([]);
      return;
    }

    setLoading(true);
    void loadLocationData(selectedLocationId)
      .catch((error) => {
        presentToast({
          message: error instanceof Error ? error.message : "Failed to load low stock products",
          color: "danger",
          duration: 1800,
        });
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  return (
    <IonPage>
      <AppTopBar title="Low Stock" showBack showSettings={false} showLocationSwitcher={false} backPath="/dashboard" />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading low stock data...</IonNote> : null}

        <LowStockOverviewCard
          overview={overview}
          selectedLocationId={selectedLocationId}
          selectedLocationName={selectedOverviewRow?.locationName || selectedLocation?.locationName || null}
          selectedLocationLowCount={selectedOverviewRow?.lowCount ?? 0}
          onSelectLocation={updateSelectedLocation}
        />

        <LowStockResultsCard
          rows={lowRows}
          loading={loading}
          locations={locations}
          selectedLocationId={selectedLocationId}
          selectedLocationName={selectedOverviewRow?.locationName || selectedLocation?.locationName || null}
          onSelectLocation={updateSelectedLocation}
          onRefresh={refreshLowStockList}
        />
      </IonContent>
    </IonPage>
  );
}
