import { IonContent, IonNote, IonPage, useIonToast } from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/common/AppTopBar";
import { HighStockOverviewCard } from "../components/high-stock/HighStockOverviewCard";
import { HighStockResultsCard } from "../components/high-stock/HighStockResultsCard";
import {
  getHighStockOverview,
  getHighStockProducts,
  getShopLocations,
  type HighStockOverview,
  type HighStockProductRow,
  type ShopLocation,
} from "../api/metaApi";
import { buildShopLocationSearch, parseShopLocationIdFromSearch } from "../components/low-stock/lowStockUtils";

export function StockHighStockPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const routeLocation = useLocation();

  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [overview, setOverview] = useState<HighStockOverview | null>(null);
  const [highRows, setHighRows] = useState<HighStockProductRow[]>([]);

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
      const summary = await getHighStockOverview();
      setOverview(summary);
    } catch {
      setOverview(null);
    }
  }

  async function loadLocationData(shopLocationId: number) {
    const products = await getHighStockProducts(shopLocationId);
    setHighRows(products.rows || []);
  }

  async function initializePage() {
    setLoading(true);
    try {
      await Promise.all([loadLocations(), loadOverviewData()]);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load high stock page",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  async function refreshHighStockList() {
    if (!selectedLocationId) {
      presentToast({ message: "Select location first", color: "warning", duration: 1400 });
      return;
    }

    setLoading(true);
    try {
      await Promise.all([loadLocationData(selectedLocationId), loadOverviewData()]);
      presentToast({ message: "High stock list refreshed", color: "success", duration: 1200 });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to refresh high stock list",
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
      setHighRows([]);
      return;
    }

    setLoading(true);
    void loadLocationData(selectedLocationId)
      .catch((error) => {
        presentToast({
          message: error instanceof Error ? error.message : "Failed to load high stock products",
          color: "danger",
          duration: 1800,
        });
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  return (
    <IonPage>
      <AppTopBar title="High Stock" showBack showSettings={false} showLocationSwitcher={false} backPath="/dashboard" />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading high stock data...</IonNote> : null}

        <HighStockOverviewCard
          overview={overview}
          selectedLocationId={selectedLocationId}
          selectedLocationName={selectedOverviewRow?.locationName || selectedLocation?.locationName || null}
          selectedLocationHighCount={selectedOverviewRow?.highCount ?? 0}
          onSelectLocation={updateSelectedLocation}
        />

        <HighStockResultsCard
          rows={highRows}
          loading={loading}
          locations={locations}
          selectedLocationId={selectedLocationId}
          selectedLocationName={selectedOverviewRow?.locationName || selectedLocation?.locationName || null}
          onSelectLocation={updateSelectedLocation}
          onRefresh={refreshHighStockList}
        />
      </IonContent>
    </IonPage>
  );
}
