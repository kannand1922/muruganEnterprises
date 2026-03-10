import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonText,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import type { LowStockProductRow, ShopLocation } from "../../api/metaApi";
import { formatPackLabel, normalizeSearchValue, toPackSortValue } from "./lowStockUtils";

type LowStockResultsCardProps = {
  title?: string;
  rows: LowStockProductRow[];
  loading?: boolean;
  locations: ShopLocation[];
  selectedLocationId: number | null;
  selectedLocationName?: string | null;
  onSelectLocation: (shopLocationId: number) => void;
  onRefresh?: () => void | Promise<void>;
  emptyMessage?: string;
};

export function LowStockResultsCard({
  title,
  rows,
  loading = false,
  locations,
  selectedLocationId,
  selectedLocationName,
  onSelectLocation,
  onRefresh,
  emptyMessage = "No low stock products for current filters.",
}: LowStockResultsCardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [itemFilter, setItemFilter] = useState("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [packFilter, setPackFilter] = useState("all");

  const itemOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => String(row.itemName || "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );

  const brandOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => String(row.brandName || "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );

  const packOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => String(row.packValue || "").trim()).filter(Boolean))).sort((a, b) => {
        const sortA = toPackSortValue(a);
        const sortB = toPackSortValue(b);
        if (sortA !== sortB) return sortA - sortB;
        return a.localeCompare(b);
      }),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);

    return rows.filter((row) => {
      if (itemFilter !== "all" && String(row.itemName || "").trim() !== itemFilter) return false;
      if (ruleFilter !== "all" && String(row.ruleType || "").trim() !== ruleFilter) return false;
      if (brandFilter !== "all" && String(row.brandName || "").trim() !== brandFilter) return false;
      if (packFilter !== "all" && String(row.packValue || "").trim() !== packFilter) return false;

      if (!query) return true;
      const searchable = normalizeSearchValue(
        `${row.displayName} ${row.itemCode} ${row.itemName} ${row.brandName} ${row.packValue}`
      );
      return searchable.includes(query);
    });
  }, [rows, searchQuery, itemFilter, ruleFilter, brandFilter, packFilter]);

  useEffect(() => {
    if (itemFilter !== "all" && !itemOptions.includes(itemFilter)) {
      setItemFilter("all");
    }
  }, [itemFilter, itemOptions]);

  useEffect(() => {
    if (brandFilter !== "all" && !brandOptions.includes(brandFilter)) {
      setBrandFilter("all");
    }
  }, [brandFilter, brandOptions]);

  useEffect(() => {
    if (packFilter !== "all" && !packOptions.includes(packFilter)) {
      setPackFilter("all");
    }
  }, [packFilter, packOptions]);

  function clearFilters() {
    setSearchQuery("");
    setItemFilter("all");
    setRuleFilter("all");
    setBrandFilter("all");
    setPackFilter("all");
  }

  return (
    <IonCard className="settings-config-card">
      {title ? (
        <IonCardHeader>
          <IonCardTitle>{title}</IonCardTitle>
        </IonCardHeader>
      ) : null}
      <IonCardContent>
        <div className="low-stock-results-toolbar">
          <div className="low-stock-field">
            <label className="low-stock-field-label">Shop Location</label>
            <IonSelect
              value={selectedLocationId ?? undefined}
              interface="popover"
              placeholder="Select location"
              onIonChange={(event) => {
                const next = Number(event.detail.value);
                if (Number.isFinite(next) && next > 0) {
                  onSelectLocation(Math.trunc(next));
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

          <div className="settings-actions settings-actions-inline low-stock-inline-actions">
            <IonButton fill="outline" onClick={clearFilters}>
              Clear Filters
            </IonButton>
            <IonButton fill="outline" onClick={() => void onRefresh?.()} disabled={loading || !selectedLocationId}>
              Refresh
            </IonButton>
          </div>
        </div>

        <IonSearchbar
          className="low-stock-searchbar"
          value={searchQuery}
          placeholder="Search by name, code, brand, pack"
          debounce={120}
          onIonInput={(event) => setSearchQuery(event.detail.value || "")}
        />

        <div className="low-stock-filter-grid">
          <div className="low-stock-field">
            <label className="low-stock-field-label">Product</label>
            <IonSelect value={itemFilter} interface="popover" onIonChange={(event) => setItemFilter(String(event.detail.value || "all"))}>
              <IonSelectOption value="all">All Products</IonSelectOption>
              {itemOptions.map((itemName) => (
                <IonSelectOption key={itemName} value={itemName}>
                  {itemName}
                </IonSelectOption>
              ))}
            </IonSelect>
          </div>

          <div className="low-stock-field">
            <label className="low-stock-field-label">Rule Type</label>
            <IonSelect value={ruleFilter} interface="popover" onIonChange={(event) => setRuleFilter(String(event.detail.value || "all"))}>
              <IonSelectOption value="all">All Rules</IonSelectOption>
              <IonSelectOption value="product">Product Rule</IonSelectOption>
              <IonSelectOption value="pack">Pack Rule</IonSelectOption>
            </IonSelect>
          </div>

          <div className="low-stock-field">
            <label className="low-stock-field-label">Brand</label>
            <IonSelect value={brandFilter} interface="popover" onIonChange={(event) => setBrandFilter(String(event.detail.value || "all"))}>
              <IonSelectOption value="all">All Brands</IonSelectOption>
              {brandOptions.map((brandName) => (
                <IonSelectOption key={brandName} value={brandName}>
                  {brandName}
                </IonSelectOption>
              ))}
            </IonSelect>
          </div>

          <div className="low-stock-field">
            <label className="low-stock-field-label">Pack Size</label>
            <IonSelect value={packFilter} interface="popover" onIonChange={(event) => setPackFilter(String(event.detail.value || "all"))}>
              <IonSelectOption value="all">All Packs</IonSelectOption>
              {packOptions.map((packValue) => (
                <IonSelectOption key={packValue} value={packValue}>
                  {formatPackLabel(packValue)}
                </IonSelectOption>
              ))}
            </IonSelect>
          </div>
        </div>

        <div className="low-stock-results-meta">
          <span>
            Showing <strong>{filteredRows.length}</strong> / {rows.length}
          </span>
          {selectedLocationName ? (
            <span>
              Location: <strong>{selectedLocationName}</strong>
            </span>
          ) : null}
        </div>

        {loading ? <IonText color="medium">Updating low stock list...</IonText> : null}

        {filteredRows.length === 0 ? (
          <IonText color="medium">{emptyMessage}</IonText>
        ) : (
          <div className="low-stock-result-list">
            {filteredRows.map((row) => (
              <div key={`${row.itemCode}_${row.packValue}`} className="low-stock-result-row">
                <div className="low-stock-result-head">
                  <strong>{row.displayName}</strong>
                  <IonBadge color="medium">{row.ruleType === "product" ? "Product Rule" : "Pack Rule"}</IonBadge>
                </div>
                <div className="low-stock-result-meta">
                  Code: {row.itemCode} | Pack: {formatPackLabel(row.packValue)}
                </div>
              </div>
            ))}
          </div>
        )}
      </IonCardContent>
    </IonCard>
  );
}
