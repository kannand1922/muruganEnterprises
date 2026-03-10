import {
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonCard,
  IonCardContent,
  IonContent,
  IonItem,
  IonLabel,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { getAllMasterProducts, getShopInfo, getShopLocations, type MasterProduct, type ShopLocation } from "../api/metaApi";
import { AppTopBar } from "../components/common/AppTopBar";

type NilRow = {
  itemCode: string;
  itemName: string;
  brandName: string;
  packValue: string;
  nilBottles: number;
};

type NilSection = {
  location: ShopLocation;
  rows: NilRow[];
};

function normalizeLocationKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseStockStringToBottles(stock: string | null | undefined, bpc: number) {
  const raw = String(stock || "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [packsPart = "0", bottlesPart = "0"] = unsigned.split(".");
  const packs = Math.max(0, Number.parseInt(packsPart, 10) || 0);
  const bottles = Math.max(0, Number.parseInt(bottlesPart, 10) || 0);
  const total = packs * Math.max(1, bpc) + bottles;
  return negative ? -total : total;
}

function getLocationStockBottles(product: MasterProduct, location: ShopLocation) {
  const safeBpc = Number(product.bpc) || 12;
  const stocks = product.locationStocks || {};
  const codeKey = normalizeLocationKey(location.locationCode);
  const nameKey = normalizeLocationKey(location.locationName);
  const typeKey = normalizeLocationKey(location.locationType || "");
  const stockValue =
    (codeKey && stocks[codeKey]) ||
    (nameKey && stocks[nameKey]) ||
    (typeKey && stocks[typeKey]) ||
    (typeKey.includes("godown") || nameKey.includes("godown") || codeKey.includes("godown")
      ? product.godownStock
      : "") ||
    (typeKey === "shop" || nameKey === "shop" || codeKey === "shop" ? product.shopStock : "") ||
    "0";
  return parseStockStringToBottles(stockValue, safeBpc);
}

export function NilProductsPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [nilLocation, setNilLocation] = useState<ShopLocation | null>(null);
  const [sections, setSections] = useState<NilSection[]>([]);
  const [targetLocations, setTargetLocations] = useState<ShopLocation[]>([]);
  const [selectedTargetLocationId, setSelectedTargetLocationId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState("");

  const visibleSections = useMemo(() => {
    if (!selectedTargetLocationId) return sections;
    return sections.filter((section) => section.location.id === selectedTargetLocationId);
  }, [sections, selectedTargetLocationId]);

  const totalNilProducts = useMemo(
    () => visibleSections.reduce((sum, section) => sum + section.rows.length, 0),
    [visibleSections]
  );

  const selectedTargetLocation = useMemo(
    () => visibleSections[0]?.location || null,
    [visibleSections]
  );

  async function loadNilProducts() {
    setLoading(true);
    setErrorText("");
    try {
      const [shopInfo, locations, masterRows] = await Promise.all([
        getShopInfo(),
        getShopLocations(),
        getAllMasterProducts(10000, { includeAll: true }),
      ]);

      const nilLocationId = Number(shopInfo?.nilLocation || 0);
      if (!nilLocationId) {
        setNilLocation(null);
        setSections([]);
        setErrorText("Set NIL location first in Settings -> Shop Info.");
        return;
      }

      const sourceLocation = locations.find((row) => row.id === nilLocationId) || null;
      if (!sourceLocation) {
        setNilLocation(null);
        setSections([]);
        setErrorText("Configured NIL location not found.");
        return;
      }

      const targetLocations = locations.filter((row) => row.id !== nilLocationId);
      setTargetLocations(targetLocations);
      const nextSections: NilSection[] = [];

      for (const targetLocation of targetLocations) {
        const nilRows: NilRow[] = [];
        for (const product of masterRows) {
          const sourceBottles = getLocationStockBottles(product, sourceLocation);
          const targetBottles = getLocationStockBottles(product, targetLocation);

          // NIL logic: stock is present in NIL location and missing in target location.
          if (sourceBottles > 0 && targetBottles <= 0) {
            nilRows.push({
              itemCode: String(product.itemCode || ""),
              itemName: String(product.itemName || ""),
              brandName: String(product.brandName || ""),
              packValue: String(product.packValue || ""),
              nilBottles: sourceBottles,
            });
          }
        }

        nilRows.sort((a, b) => {
          const byBrand = a.brandName.localeCompare(b.brandName);
          if (byBrand !== 0) return byBrand;
          return a.itemCode.localeCompare(b.itemCode);
        });

        nextSections.push({ location: targetLocation, rows: nilRows });
      }

      setNilLocation(sourceLocation);
      const filteredSections = nextSections.filter((section) => section.rows.length > 0);
      setSections(filteredSections);
      setSelectedTargetLocationId((current) => {
        if (current && filteredSections.some((section) => section.location.id === current)) {
          return current;
        }
        return null;
      });
    } catch (error) {
      setNilLocation(null);
      setSections([]);
      setTargetLocations([]);
      setSelectedTargetLocationId(null);
      setErrorText("Failed to load NIL products.");
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load NIL products",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNilProducts();
  }, []);

  function renderRows(rows: NilRow[]) {
    if (rows.length === 0) {
      return <div className="stock-empty">No NIL products.</div>;
    }
    return (
      <div className="nil-list">
        {rows.map((row) => (
          <IonItem key={`${row.itemCode}_${row.packValue}`} lines="none" className="nil-row-item">
            <IonLabel>
              <h3 className="nil-row-title">
                {row.brandName} | {row.itemName}
              </h3>
              <p className="nil-row-meta nil-row-meta-compact">
                Pack: {row.packValue} | Code: {row.itemCode}
              </p>
            </IonLabel>
            <IonBadge className="nil-bottles-badge">{row.nilBottles} bottles</IonBadge>
          </IonItem>
        ))}
      </div>
    );
  }

  const showAccordion = !selectedTargetLocationId && visibleSections.length > 1;
  const singleSection = visibleSections.length === 1 ? visibleSections[0] : null;

  return (
    <IonPage>
      <AppTopBar title="NIL Products" showBack backPath="/dashboard" showLocationSwitcher={false} />
      <IonContent fullscreen className="main-page-content ion-padding stock-entry-content nil-products-content">
        <IonCard className="control-card nil-products-card">
          <IonCardContent className="control-content">
            {nilLocation ? (
              <div className="cycle-subtitle nil-products-heading">
                NIL Source: {nilLocation.locationName}
              </div>
            ) : null}

            {nilLocation ? (
              <IonItem lines="none" className="nil-target-select">
                <IonLabel position="stacked">Target Location</IonLabel>
                <IonSelect
                  value={selectedTargetLocationId ?? "all"}
                  interface="popover"
                  onIonChange={(event) => {
                    const raw = event.detail.value;
                    if (raw === "all") {
                      setSelectedTargetLocationId(null);
                      return;
                    }
                    const next = Number(raw);
                    setSelectedTargetLocationId(Number.isFinite(next) && next > 0 ? Math.trunc(next) : null);
                  }}
                >
                  <IonSelectOption value="all">All Targets</IonSelectOption>
                  {targetLocations.map((location) => (
                    <IonSelectOption key={location.id} value={location.id}>
                      {location.locationName}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            ) : null}

            {nilLocation ? (
              <div className="nil-explainer-box">
                {selectedTargetLocation
                  ? `Showing products available in ${nilLocation.locationName} but missing in ${selectedTargetLocation.locationName}.`
                  : `Showing products available in ${nilLocation.locationName} but missing in each target location.`}
              </div>
            ) : null}

            <div className="nil-total-box">Total NIL Products: {totalNilProducts}</div>

            {loading ? (
              <div className="stock-loading-wrap">
                <IonSpinner name="crescent" />
                <IonText>Loading NIL products...</IonText>
              </div>
            ) : errorText ? (
              <div className="operator-required-box">{errorText}</div>
            ) : visibleSections.length === 0 ? (
              <div className="stock-empty">No NIL products for configured locations.</div>
            ) : showAccordion ? (
              <IonAccordionGroup multiple value={visibleSections.map((section) => String(section.location.id))}>
                {visibleSections.map((section) => (
                  <IonAccordion
                    key={section.location.id}
                    value={String(section.location.id)}
                    className="nil-accordion-with-color"
                    style={
                      {
                        "--shop-color": section.location.locationColor || "#1a73e8",
                      } as CSSProperties
                    }
                  >
                    <IonItem slot="header" className="nil-accordion-header">
                      <IonLabel>
                        {section.location.locationName} ({section.rows.length})
                      </IonLabel>
                    </IonItem>
                    <div slot="content">{renderRows(section.rows)}</div>
                  </IonAccordion>
                ))}
              </IonAccordionGroup>
            ) : singleSection ? (
              <div className="nil-single-wrap">
                <div className="nil-single-title">Target: {singleSection.location.locationName}</div>
                {renderRows(singleSection.rows)}
              </div>
            ) : null}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
