import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCheckbox,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createBestSelling,
  deleteBestSelling,
  getAllMasterProducts,
  getBestSelling,
  type BestSellingProduct,
  type MasterProduct,
} from "../api/metaApi";

function normalizeText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function buildProductSearchText(product: {
  itemCode?: string | null;
  itemName?: string | null;
  brandName?: string | null;
  packValue?: string | null;
  barcode?: string | null;
}) {
  return [
    product.itemCode,
    product.itemName,
    product.brandName,
    product.packValue,
    product.barcode,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");
}

function formatPackValue(value: unknown) {
  const trimmed = String(value || "").trim();
  return trimmed || "-";
}

export function SettingsBestSellingPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BestSellingProduct[]>([]);
  const [allProducts, setAllProducts] = useState<MasterProduct[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [addItemFilter, setAddItemFilter] = useState("");
  const [addPackFilter, setAddPackFilter] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [listItemFilter, setListItemFilter] = useState("");
  const [listPackFilter, setListPackFilter] = useState("");
  const [selectedAddCodes, setSelectedAddCodes] = useState<string[]>([]);
  const [selectedExistingIds, setSelectedExistingIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deferredAddQuery = useDeferredValue(addQuery);
  const deferredListQuery = useDeferredValue(listQuery);

  async function loadRows() {
    const list = await getBestSelling();
    setRows(list);
  }

  async function initializePage() {
    setLoading(true);
    try {
      const [bestSelling, masterProducts] = await Promise.all([
        getBestSelling(),
        getAllMasterProducts(10000),
      ]);
      setRows(bestSelling);
      setAllProducts(masterProducts);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load best selling",
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

  const existingCodeSet = useMemo(() => {
    return new Set(rows.map((row) => normalizeText(row.itemCode)).filter(Boolean));
  }, [rows]);

  const availableAddProducts = useMemo(
    () => allProducts.filter((product) => !existingCodeSet.has(normalizeText(product.itemCode))),
    [allProducts, existingCodeSet]
  );

  const addItemOptions = useMemo(() => {
    return Array.from(
      new Set(
        availableAddProducts
          .map((product) => String(product.itemName || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [availableAddProducts]);

  const addPackOptions = useMemo(() => {
    return Array.from(
      new Set(
        availableAddProducts
          .map((product) => String(product.packValue || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [availableAddProducts]);

  const filteredAddResults = useMemo(() => {
    const query = normalizeText(deferredAddQuery);
    return availableAddProducts
      .filter((product) => {
        if (addItemFilter && String(product.itemName || "").trim() !== addItemFilter) return false;
        if (addPackFilter && String(product.packValue || "").trim() !== addPackFilter) return false;
        if (!query) return true;
        return buildProductSearchText(product).includes(query);
      })
      .slice(0, 250);
  }, [availableAddProducts, addItemFilter, addPackFilter, deferredAddQuery]);

  const listItemOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => String(row.itemName || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const listPackOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => String(row.packValue || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rows]);

  const filteredExistingRows = useMemo(() => {
    const query = normalizeText(deferredListQuery);
    return rows.filter((row) => {
      if (listItemFilter && String(row.itemName || "").trim() !== listItemFilter) return false;
      if (listPackFilter && String(row.packValue || "").trim() !== listPackFilter) return false;
      if (!query) return true;
      return buildProductSearchText(row).includes(query);
    });
  }, [rows, listItemFilter, listPackFilter, deferredListQuery]);

  useEffect(() => {
    setSelectedAddCodes((prev) => prev.filter((code) => !existingCodeSet.has(normalizeText(code))));
  }, [existingCodeSet]);

  useEffect(() => {
    const existingIdSet = new Set(rows.map((row) => row.id));
    setSelectedExistingIds((prev) => prev.filter((id) => existingIdSet.has(id)));
  }, [rows]);

  function toggleAddCode(itemCode: string, checked: boolean) {
    setSelectedAddCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemCode);
      else next.delete(itemCode);
      return Array.from(next);
    });
  }

  function toggleExistingId(id: number, checked: boolean) {
    setSelectedExistingIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return Array.from(next);
    });
  }

  async function onAddSelected() {
    const productsToAdd = availableAddProducts.filter((row) => selectedAddCodes.includes(row.itemCode));
    if (productsToAdd.length === 0) {
      presentToast({ message: "Select at least one product", color: "warning", duration: 1500 });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        productsToAdd.map((product) =>
          createBestSelling({
            itemCode: product.itemCode,
            itemName: product.itemName,
            brandName: product.brandName,
            packValue: product.packValue,
          })
        )
      );
      presentToast({
        message: `${productsToAdd.length} product${productsToAdd.length > 1 ? "s" : ""} added`,
        color: "success",
        duration: 1600,
      });
      setSelectedAddCodes([]);
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to add best selling products",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSelected() {
    if (selectedExistingIds.length === 0) {
      presentToast({ message: "Select products to remove", color: "warning", duration: 1500 });
      return;
    }

    setDeleting(true);
    try {
      await Promise.all(selectedExistingIds.map((id) => deleteBestSelling(id)));
      presentToast({
        message: `${selectedExistingIds.length} product${selectedExistingIds.length > 1 ? "s" : ""} removed`,
        color: "success",
        duration: 1600,
      });
      setSelectedExistingIds([]);
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete best selling products",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Best Selling" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Add Products</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="best-selling-toolbar">
              <IonItem>
                <IonLabel position="stacked">Search Product</IonLabel>
                <IonInput
                  value={addQuery}
                  placeholder="Search by code, brand, item, barcode"
                  onIonInput={(e) => setAddQuery(e.detail.value || "")}
                />
              </IonItem>

              <div className="best-selling-filter-grid">
                <IonItem>
                  <IonLabel position="stacked">Item</IonLabel>
                  <IonSelect
                    interface="popover"
                    value={addItemFilter}
                    placeholder="All Items"
                    onIonChange={(e) => setAddItemFilter(String(e.detail.value || ""))}
                  >
                    <IonSelectOption value="">All Items</IonSelectOption>
                    {addItemOptions.map((item) => (
                      <IonSelectOption key={item} value={item}>
                        {item}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Pack</IonLabel>
                  <IonSelect
                    interface="popover"
                    value={addPackFilter}
                    placeholder="All Packs"
                    onIonChange={(e) => setAddPackFilter(String(e.detail.value || ""))}
                  >
                    <IonSelectOption value="">All Packs</IonSelectOption>
                    {addPackOptions.map((pack) => (
                      <IonSelectOption key={pack} value={pack}>
                        {pack}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              </div>
            </div>

            <div className="best-selling-summary-bar">
              <IonBadge color="medium">Available {availableAddProducts.length}</IonBadge>
              <IonBadge color="primary">Visible {filteredAddResults.length}</IonBadge>
              <IonBadge color="success">Checked {selectedAddCodes.length}</IonBadge>
            </div>

            <div className="settings-actions settings-actions-inline best-selling-compact-actions">
              <IonButton onClick={onAddSelected} disabled={saving || selectedAddCodes.length === 0}>
                {saving ? "Adding..." : `Add Selected (${selectedAddCodes.length})`}
              </IonButton>
            </div>

            {filteredAddResults.length === 0 ? (
              <IonText color="medium">No matching products found.</IonText>
            ) : (
              <IonList className="best-selling-product-list">
                {filteredAddResults.map((product) => {
                  const checked = selectedAddCodes.includes(product.itemCode);
                  return (
                    <IonItem
                      key={product.itemCode}
                      className="best-selling-product-row"
                      button
                      onClick={() => toggleAddCode(product.itemCode, !checked)}
                    >
                      <IonCheckbox
                        slot="start"
                        checked={checked}
                        onIonChange={(e) => {
                          e.stopPropagation();
                          toggleAddCode(product.itemCode, Boolean(e.detail.checked));
                        }}
                      />
                      <IonLabel>
                        <h2>{product.brandName || product.itemName || product.itemCode}</h2>
                        <p>
                          {product.itemName || "-"} • {formatPackValue(product.packValue)} • Code: {product.itemCode}
                        </p>
                      </IonLabel>
                    </IonItem>
                  );
                })}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Best Selling List</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="best-selling-toolbar">
              <IonItem>
                <IonLabel position="stacked">Filter Current List</IonLabel>
                <IonInput
                  value={listQuery}
                  placeholder="Search current best selling list"
                  onIonInput={(e) => setListQuery(e.detail.value || "")}
                />
              </IonItem>

              <div className="best-selling-filter-grid">
                <IonItem>
                  <IonLabel position="stacked">Item</IonLabel>
                  <IonSelect
                    interface="popover"
                    value={listItemFilter}
                    placeholder="All Items"
                    onIonChange={(e) => setListItemFilter(String(e.detail.value || ""))}
                  >
                    <IonSelectOption value="">All Items</IonSelectOption>
                    {listItemOptions.map((item) => (
                      <IonSelectOption key={item} value={item}>
                        {item}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>

                <IonItem>
                  <IonLabel position="stacked">Pack</IonLabel>
                  <IonSelect
                    interface="popover"
                    value={listPackFilter}
                    placeholder="All Packs"
                    onIonChange={(e) => setListPackFilter(String(e.detail.value || ""))}
                  >
                    <IonSelectOption value="">All Packs</IonSelectOption>
                    {listPackOptions.map((pack) => (
                      <IonSelectOption key={pack} value={pack}>
                        {pack}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              </div>
            </div>

            <div className="best-selling-summary-bar">
              <IonBadge color="medium">Total {rows.length}</IonBadge>
              <IonBadge color="primary">Visible {filteredExistingRows.length}</IonBadge>
              <IonBadge color="danger">Checked {selectedExistingIds.length}</IonBadge>
            </div>

            <div className="settings-actions settings-actions-inline best-selling-compact-actions">
              <IonButton
                color="danger"
                fill="outline"
                onClick={onDeleteSelected}
                disabled={deleting || selectedExistingIds.length === 0}
              >
                {deleting ? "Removing..." : `Remove Selected (${selectedExistingIds.length})`}
              </IonButton>
            </div>

            {rows.length === 0 ? (
              <IonText color="medium">No products in best selling list.</IonText>
            ) : filteredExistingRows.length === 0 ? (
              <IonText color="medium">No products match the current filter.</IonText>
            ) : (
              <IonList className="best-selling-product-list">
                {filteredExistingRows.map((row) => {
                  const checked = selectedExistingIds.includes(row.id);
                  return (
                    <IonItem
                      key={row.id}
                      className="best-selling-product-row"
                      button
                      onClick={() => toggleExistingId(row.id, !checked)}
                    >
                      <IonCheckbox
                        slot="start"
                        checked={checked}
                        onIonChange={(e) => {
                          e.stopPropagation();
                          toggleExistingId(row.id, Boolean(e.detail.checked));
                        }}
                      />
                      <IonLabel>
                        <h2>{row.brandName || row.itemName || row.itemCode}</h2>
                        <p>
                          {row.itemName || "-"} • {formatPackValue(row.packValue)} • Code: {row.itemCode}
                        </p>
                      </IonLabel>
                    </IonItem>
                  );
                })}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
