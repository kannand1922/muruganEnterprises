import {
  IonButton,
  IonButtons,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from "@ionic/react";
import { arrowBackOutline, settingsOutline, swapHorizontalOutline } from "ionicons/icons";
import { useEffect, useState, type CSSProperties } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { getShopLocations, type ShopLocation } from "../../api/metaApi";
import { getApiBaseUrl } from "../../config/env";
import {
  CURRENT_LOCATION_ID_KEY,
  LOCATION_CHANGED_EVENT,
  getCurrentLocationIdFromStorage,
  setCurrentLocationIdToStorage,
} from "../../config/location";
import { hasSettingsAccess } from "../../config/settingsAuth";

type AppTopBarProps = {
  title: string;
  showSettings?: boolean;
  showBack?: boolean;
  backPath?: string;
  showLocationSwitcher?: boolean;
  statusBadgeText?: string;
  statusBadgeTone?: "green" | "red" | "amber" | "gray";
  showHealthBadge?: boolean;
};

export function AppTopBar({
  title,
  showSettings = false,
  showBack = true,
  backPath = "/dashboard",
  showLocationSwitcher = true,
  statusBadgeText,
  statusBadgeTone = "gray",
  showHealthBadge = true,
}: AppTopBarProps) {
  const history = useHistory();
  const location = useLocation();
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [currentLocationId, setCurrentLocationId] = useState<number | null>(null);
  const [autoHealthTone, setAutoHealthTone] = useState<"green" | "red" | "amber" | "gray">("gray");

  const currentLocation =
    locations.find((location) => location.id === currentLocationId) || locations[0] || null;

  function applyLocationTheme(location: ShopLocation) {
    const root = document.documentElement;
    const baseColor = location.locationColor || "#1a73e8";
    root.style.setProperty("--shop-color", baseColor);
  }

  useEffect(() => {
    if (!showLocationSwitcher) return;

    let cancelled = false;
    async function loadLocations() {
      try {
        const rows = await getShopLocations();
        if (cancelled) return;

        setLocations(rows);

        if (rows.length === 0) {
          localStorage.removeItem(CURRENT_LOCATION_ID_KEY);
          setCurrentLocationId(null);
          return;
        }

        const stored = getCurrentLocationIdFromStorage();
        const validStored = rows.find((row) => row.id === stored);
        const selectedId = validStored ? validStored.id : rows[0].id;
        setCurrentLocationIdToStorage(selectedId);
        setCurrentLocationId(selectedId);
        const selectedLocation = rows.find((row) => row.id === selectedId);
        if (selectedLocation) {
          applyLocationTheme(selectedLocation);
          window.dispatchEvent(
            new CustomEvent(LOCATION_CHANGED_EVENT, {
              detail: selectedLocation,
            })
          );
        }
      } catch (error) {
        setLocations([]);
        setCurrentLocationId(null);
      }
    }

    void loadLocations();

    return () => {
      cancelled = true;
    };
  }, [showLocationSwitcher, location.pathname]);

  useEffect(() => {
    const shouldCheckDashboardHealth =
      showHealthBadge && !statusBadgeText && location.pathname === "/dashboard";
    if (!shouldCheckDashboardHealth) return;

    const baseUrl = getApiBaseUrl();
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const healthUrl = normalized.endsWith("/api")
      ? `${normalized.slice(0, -4)}/health`
      : `${normalized}/health`;
    if (!healthUrl) {
      setAutoHealthTone("red");
      return;
    }

    setAutoHealthTone("amber");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    async function runHealthCheck() {
      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          signal: controller.signal,
        });
        if (!response.ok) {
          setAutoHealthTone("red");
          return;
        }
        const payload = (await response.json()) as { ok?: boolean };
        setAutoHealthTone(payload?.ok ? "green" : "red");
      } catch (error) {
        setAutoHealthTone("red");
      } finally {
        clearTimeout(timeout);
      }
    }

    void runHealthCheck();

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [location.pathname, showHealthBadge, statusBadgeText]);

  function switchLocation() {
    if (locations.length === 0 || !currentLocation) return;
    const currentIndex = locations.findIndex((location) => location.id === currentLocation.id);
    const next = locations[(currentIndex + 1) % locations.length];
    setCurrentLocationIdToStorage(next.id);
    setCurrentLocationId(next.id);
    applyLocationTheme(next);
    window.dispatchEvent(
      new CustomEvent(LOCATION_CHANGED_EVENT, {
        detail: next,
      })
    );
  }

  function openSettings() {
    if (hasSettingsAccess()) {
      history.push("/settings");
      return;
    }
    history.push("/settings-unlock?next=%2Fsettings");
  }

  function goBack() {
    if (history.length > 1) {
      history.goBack();
      return;
    }
    const fallback = backPath || "/dashboard";
    if (location.pathname !== fallback) {
      history.replace(fallback);
    }
  }

  const effectiveTone = statusBadgeText ? statusBadgeTone : autoHealthTone;
  const statusDotClass =
    effectiveTone === "green"
      ? "connected"
      : effectiveTone === "amber"
        ? "checking"
        : effectiveTone === "red"
          ? "disconnected"
          : "idle";
  const shouldRenderBadge = Boolean(statusBadgeText) || (showHealthBadge && location.pathname === "/dashboard");

  return (
    <IonHeader className="simple-header">
      <IonToolbar>
        <IonButtons slot="start">
          {showBack ? (
            <IonButton className="drawer-button" onClick={goBack}>
              <IonIcon icon={arrowBackOutline} />
            </IonButton>
          ) : null}
          {showSettings ? (
            <IonButton className="toolbar-settings-button" onClick={openSettings}>
              <IonIcon icon={settingsOutline} />
            </IonButton>
          ) : null}
        </IonButtons>
        <IonTitle className="toolbar-center">
          {showLocationSwitcher ? (
            <button
              type="button"
              className="toolbar-location-button"
              onClick={switchLocation}
              style={
                currentLocation?.locationColor
                  ? ({ "--shop-color": currentLocation.locationColor } as CSSProperties)
                  : undefined
              }
            >
              {currentLocation?.locationColor ? (
                <span className="toolbar-location-dot" style={{ background: currentLocation.locationColor }} />
              ) : null}
              <IonIcon icon={swapHorizontalOutline} />
              {currentLocation ? currentLocation.locationName : "No Location"}
            </button>
          ) : (
            title
          )}
        </IonTitle>
        {shouldRenderBadge ? (
          <div slot="end" className="connection-badge-holder topbar-connection-holder">
            {/* <span className="scan-count-text">{statusBadgeText}</span> */}
            <span className={`status-dot ${statusDotClass}`} />
          </div>
        ) : null}
      </IonToolbar>
    </IonHeader>
  );
}
