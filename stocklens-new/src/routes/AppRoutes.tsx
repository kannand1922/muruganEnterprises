import { IonReactRouter } from "@ionic/react-router";
import { IonRouterOutlet } from "@ionic/react";
import { useEffect } from "react";
import { Redirect, Route, useLocation } from "react-router-dom";

import { DashboardPage } from "../pages/DashboardPage";
import { CyclesPage } from "../pages/CyclesPage";
import { StockEntryPage } from "../pages/StockEntryPage";
import { OperatorFinishPage } from "../pages/OperatorFinishPage";
import { NilProductsPage } from "../pages/NilProductsPage";
import { FastMovingPage } from "../pages/FastMovingPage";
import { PrintPage } from "../pages/PrintPage";
import { VerifyPage } from "../pages/VerifyPage";
import { UncheckedPage } from "../pages/UncheckedPage";
import { DifferencePage } from "../pages/DifferencePage";
import { SettingsPage } from "../pages/SettingsPage";
import { SettingsShopInfoPage } from "../pages/SettingsShopInfoPage";
import { SettingsShopLocationsPage } from "../pages/SettingsShopLocationsPage";
import { SettingsOperatorsPage } from "../pages/SettingsOperatorsPage";
import { SettingsPhonesPage } from "../pages/SettingsPhonesPage";
import { SettingsFcmPage } from "../pages/SettingsFcmPage";
import { SettingsBestSellingPage } from "../pages/SettingsBestSellingPage";
import { SettingsPrintersPage } from "../pages/SettingsPrintersPage";
import { SettingsCommonConfigPage } from "../pages/SettingsCommonConfigPage";
import { SettingsLowStockAlertsPage } from "../pages/SettingsLowStockAlertsPage";
import { SettingsHighStockAlertsPage } from "../pages/SettingsHighStockAlertsPage";
import { SettingsNotificationConfigPage } from "../pages/SettingsNotificationConfigPage";
import { SettingsLowStockNotificationsPage } from "../pages/SettingsLowStockNotificationsPage";
import { SettingsLowStockThresholdsPage } from "../pages/SettingsLowStockThresholdsPage";
import { SettingsHighStockThresholdsPage } from "../pages/SettingsHighStockThresholdsPage";
import { SettingsDifferencePage } from "../pages/SettingsDifferencePage";
import { SettingsDbViewerPage } from "../pages/SettingsDbViewerPage";
import { StockLowStockPage } from "../pages/StockLowStockPage";
import { StockHighStockPage } from "../pages/StockHighStockPage";
import { SettingsUnlockPage } from "../pages/SettingsUnlockPage";
import { SettingsProtectedRoute } from "./SettingsProtectedRoute";
import { AndroidBackHandler } from "./AndroidBackHandler";
import { clearSettingsAccess } from "../config/settingsAuth";

function SettingsAccessLifecycle() {
  const location = useLocation();

  useEffect(() => {
    const path = String(location.pathname || "");
    const isSettingsPath = path === "/settings" || path.startsWith("/settings/");
    const isSettingsUnlockPath = path === "/settings-unlock";
    const isSettingsLinkedStockPath = path === "/stock/low-stock" || path === "/stock/high-stock";
    if (!isSettingsPath && !isSettingsUnlockPath && !isSettingsLinkedStockPath) {
      clearSettingsAccess();
    }
  }, [location.pathname]);

  useEffect(() => {
    const clearOnHide = () => {
      clearSettingsAccess();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearOnHide();
      }
    };

    window.addEventListener("pagehide", clearOnHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", clearOnHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}

export function AppRoutes() {
  return (
    <IonReactRouter>
      <AndroidBackHandler />
      <SettingsAccessLifecycle />
      <IonRouterOutlet>
        <Route exact path="/dashboard" component={DashboardPage} />
        <Route exact path="/cycles" component={CyclesPage} />
        <Route exact path="/stock" component={StockEntryPage} />
        <Route exact path="/stock/finish" component={OperatorFinishPage} />
        <Route exact path="/stock/nil" component={NilProductsPage} />
        <Route exact path="/stock/fast-moving" component={FastMovingPage} />
        <Route exact path="/stock/verify" component={VerifyPage} />
        <Route exact path="/stock/unchecked" component={UncheckedPage} />
        <Route exact path="/stock/difference" component={DifferencePage} />
        <Route exact path="/stock/print" component={PrintPage} />
        <Route exact path="/stock/low-stock" component={StockLowStockPage} />
        <Route exact path="/stock/high-stock" component={StockHighStockPage} />
        <Route exact path="/settings-unlock" component={SettingsUnlockPage} />
        <SettingsProtectedRoute exact path="/settings" component={SettingsPage} />
        <SettingsProtectedRoute exact path="/settings/shop-info" component={SettingsShopInfoPage} />
        <SettingsProtectedRoute
          exact
          path="/settings/shop-locations"
          component={SettingsShopLocationsPage}
        />
        <SettingsProtectedRoute exact path="/settings/operators" component={SettingsOperatorsPage} />
        <SettingsProtectedRoute exact path="/settings/phones" component={SettingsPhonesPage} />
        <SettingsProtectedRoute exact path="/settings/fcm" component={SettingsFcmPage} />
        <SettingsProtectedRoute exact path="/settings/best-selling" component={SettingsBestSellingPage} />
        <SettingsProtectedRoute exact path="/settings/printers" component={SettingsPrintersPage} />
        <SettingsProtectedRoute exact path="/settings/difference" component={SettingsDifferencePage} />
        <SettingsProtectedRoute exact path="/settings/db-viewer" component={SettingsDbViewerPage} />
        <SettingsProtectedRoute
          exact
          path="/settings/low-stock-alerts/config"
          component={SettingsNotificationConfigPage}
        />
        <SettingsProtectedRoute
          exact
          path="/settings/low-stock-alerts/thresholds"
          component={SettingsLowStockThresholdsPage}
        />
        <SettingsProtectedRoute
          exact
          path="/settings/low-stock-alerts/notifications"
          component={SettingsLowStockNotificationsPage}
        />
        <SettingsProtectedRoute
          exact
          path="/settings/low-stock-alerts"
          component={SettingsLowStockAlertsPage}
        />
        <SettingsProtectedRoute
          exact
          path="/settings/high-stock-alerts/thresholds"
          component={SettingsHighStockThresholdsPage}
        />
        <SettingsProtectedRoute
          exact
          path="/settings/high-stock-alerts"
          component={SettingsHighStockAlertsPage}
        />
        <SettingsProtectedRoute
          exact
          path="/settings/common-config"
          component={SettingsCommonConfigPage}
        />
        <Route exact path="/">
          <Redirect to="/dashboard" />
        </Route>
      </IonRouterOutlet>
    </IonReactRouter>
  );
}
