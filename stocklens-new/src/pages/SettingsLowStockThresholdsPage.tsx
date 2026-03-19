import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonInput,
  IonNote,
  IonPage,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  getAllMasterProducts,
  getLowStockSettings,
  getShopLocations,
  saveLowStockSettings,
  type ShopLocation,
} from "../api/metaApi";
import {
  buildPackRulesForAllPackValues,
  buildShopLocationSearch,
  createRowId,
  formatPackLabel,
  parseShopLocationIdFromSearch,
  toPackSortValue,
  toThresholdNumber,
  type PackRuleForm,
  type ProductRuleForm,
} from "../components/low-stock/lowStockUtils";
import type { LowStockSettings } from "../api/metaApi";

export function SettingsLowStockThresholdsPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const routeLocation = useLocation();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [sourceLocationId, setSourceLocationId] = useState<number | null>(null);
  const [availablePackValues, setAvailablePackValues] = useState<string[]>([]);
  const [packRules, setPackRules] = useState<PackRuleForm[]>([]);
  const [productRules, setProductRules] = useState<ProductRuleForm[]>([]);

  const selectedLocation = useMemo(
    () => locations.find((row) => row.id === selectedLocationId) || null,
    [locations, selectedLocationId]
  );
  const locationSearch = buildShopLocationSearch(routeLocation.search, selectedLocationId);

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

  async function loadPackValues() {
    const rows = await getAllMasterProducts(10000);
    const set = new Set<string>();
    rows.forEach((row) => {
      const pack = String(row.packValue || "").trim();
      if (pack) set.add(pack);
    });

    const values = Array.from(set).sort((a, b) => {
      const sortA = toPackSortValue(a);
      const sortB = toPackSortValue(b);
      if (sortA !== sortB) return sortA - sortB;
      return a.localeCompare(b);
    });

    setAvailablePackValues(values);
  }

  async function loadLocationSettings(shopLocationId: number) {
    const settings = await getLowStockSettings(shopLocationId);
    applySettingsToForm(settings);
  }

  async function initializePage() {
    setLoading(true);
    try {
      await Promise.all([loadLocations(), loadPackValues()]);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load threshold rules",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  function buildSettingsPayload(nextSourceLocationId: number | null = sourceLocationId) {
    return {
      sourceLocationId: nextSourceLocationId,
      packRules: packRules
        .map((row) => ({
          packValue: row.packValue.trim(),
          thresholdBottles: toThresholdNumber(row.thresholdBottles, 0),
        }))
        .filter((row) => row.packValue && row.thresholdBottles > 0),
      productRules: productRules
        .map((row) => ({
          itemCode: row.itemCode.trim(),
          thresholdBottles: toThresholdNumber(row.thresholdBottles, 0),
        }))
        .filter((row) => row.itemCode && row.thresholdBottles > 0),
    };
  }

  function applySettingsToForm(
    settings: LowStockSettings,
    options: { fallbackSourceLocationId?: number | null } = {}
  ) {
    const hasSourceLocationId = Object.prototype.hasOwnProperty.call(settings, "sourceLocationId");
    setSourceLocationId(
      hasSourceLocationId ? settings.sourceLocationId ?? null : options.fallbackSourceLocationId ?? null
    );
    setPackRules(
      buildPackRulesForAllPackValues(
        availablePackValues,
        settings.packRules.map((row) => ({
          id: createRowId("pack"),
          packValue: row.packValue,
          thresholdBottles: String(row.thresholdBottles),
        }))
      )
    );
    setProductRules(
      settings.productRules.map((row) => ({
        id: createRowId("product"),
        itemCode: row.itemCode,
        thresholdBottles: String(row.thresholdBottles),
      }))
    );
  }

  async function onSave() {
    if (!selectedLocationId) {
      presentToast({ message: "Select location first", color: "warning", duration: 1400 });
      return;
    }

    setSaving(true);
    try {
      const savedSettings = await saveLowStockSettings(selectedLocationId, buildSettingsPayload());
      applySettingsToForm(savedSettings, { fallbackSourceLocationId: sourceLocationId });
      presentToast({ message: "Threshold rules saved", color: "success", duration: 1400 });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save threshold rules",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  function addProductRule() {
    setProductRules((prev) => [...prev, { id: createRowId("product"), itemCode: "", thresholdBottles: "6" }]);
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
      setSourceLocationId(null);
      setPackRules([]);
      setProductRules([]);
      return;
    }

    setLoading(true);
    void loadLocationSettings(selectedLocationId)
      .catch((error) => {
        presentToast({
          message: error instanceof Error ? error.message : "Failed to load threshold settings",
          color: "danger",
          duration: 1800,
        });
      })
      .finally(() => setLoading(false));
  }, [selectedLocationId]);

  useEffect(() => {
    if (availablePackValues.length === 0) return;
    setPackRules((prev) => buildPackRulesForAllPackValues(availablePackValues, prev));
  }, [availablePackValues]);

  return (
    <IonPage>
      <AppTopBar
        title="Threshold Rules"
        showBack
        showSettings={false}
        showLocationSwitcher={false}
        backPath={`/settings/low-stock-alerts${locationSearch}`}
      />
      <IonContent fullscreen className="settings-page-content ion-padding low-stock-alerts-page">
        {loading ? <IonNote className="low-stock-loading-note">Loading threshold data...</IonNote> : null}

        <IonNote className="low-stock-card-copy">
          Editing threshold rules for <strong>{selectedLocation?.locationName || "selected location"}</strong>. Source
          and target routing are managed in <strong>Notification Config</strong>.
        </IonNote>

        <IonCard className="settings-config-card">
          <IonCardHeader className="low-stock-card-header">
            <IonCardTitle>Pack Size Rules</IonCardTitle>
            <div className="settings-actions settings-actions-inline low-stock-card-header-actions">
              <IonButton onClick={onSave} disabled={saving || !selectedLocationId}>
                {saving ? "Saving..." : "Save Rules"}
              </IonButton>
            </div>
          </IonCardHeader>
          <IonCardContent>
            <IonNote>These rules are generated from pack sizes found in brands.csv.</IonNote>
            <div className="low-stock-pack-rules">
              <div className="low-stock-pack-header">
                <span>Pack Size</span>
                <span>Threshold</span>
              </div>
              {packRules.map((row) => (
                <div key={row.id} className="low-stock-pack-row">
                  <div className="low-stock-pack-name">{formatPackLabel(row.packValue)}</div>
                  <IonInput
                    className="low-stock-pack-threshold-input"
                    type="number"
                    inputMode="numeric"
                    value={row.thresholdBottles}
                    onIonInput={(event) => {
                      const next = event.detail.value || "";
                      setPackRules((prev) =>
                        prev.map((entry) => (entry.id === row.id ? { ...entry, thresholdBottles: next } : entry))
                      );
                    }}
                  />
                </div>
              ))}
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Product Rules</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonNote>Use product rules only for item codes that need a different threshold.</IonNote>
            <div className="low-stock-product-rules">
              <div className="low-stock-product-header">
                <span>Item Code</span>
                <span>Threshold</span>
                <span className="low-stock-product-header-action">Action</span>
              </div>
              {productRules.length === 0 ? (
                <div className="low-stock-product-empty">No product-specific rules added.</div>
              ) : (
                productRules.map((row) => (
                  <div key={row.id} className="low-stock-product-row">
                    <IonInput
                      className="low-stock-product-code-input"
                      value={row.itemCode}
                      placeholder="e.g. 101.1"
                      onIonInput={(event) => {
                        const next = event.detail.value || "";
                        setProductRules((prev) =>
                          prev.map((entry) => (entry.id === row.id ? { ...entry, itemCode: next } : entry))
                        );
                      }}
                    />
                    <IonInput
                      className="low-stock-product-threshold-input"
                      type="number"
                      inputMode="numeric"
                      value={row.thresholdBottles}
                      onIonInput={(event) => {
                        const next = event.detail.value || "";
                        setProductRules((prev) =>
                          prev.map((entry) =>
                            entry.id === row.id ? { ...entry, thresholdBottles: next } : entry
                          )
                        );
                      }}
                    />
                    <IonButton
                      className="low-stock-product-remove-button"
                      fill="clear"
                      color="danger"
                      onClick={() => setProductRules((prev) => prev.filter((entry) => entry.id !== row.id))}
                    >
                      Remove
                    </IonButton>
                  </div>
                ))
              )}
            </div>

            <div className="settings-actions settings-actions-inline low-stock-page-actions">
              <IonButton fill="outline" onClick={addProductRule}>
                Add Product Rule
              </IonButton>
              <IonButton onClick={onSave} disabled={saving || !selectedLocationId}>
                {saving ? "Saving..." : "Save Rules"}
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
