import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonText,
  useIonToast,
} from "@ionic/react";
import { useEffect, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createBestSelling,
  deleteBestSelling,
  getBestSelling,
  searchMasterProducts,
  type BestSellingProduct,
  type MasterProduct,
} from "../api/metaApi";

export function SettingsBestSellingPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BestSellingProduct[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MasterProduct[]>([]);
  const [selected, setSelected] = useState<MasterProduct | null>(null);

  async function loadRows() {
    setLoading(true);
    try {
      const list = await getBestSelling();
      setRows(list);
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
    void loadRows();
  }, []);

  async function onSearch() {
    setSearching(true);
    try {
      const list = await searchMasterProducts(searchText, 50);
      setSearchResults(list);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to search products",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSearching(false);
    }
  }

  async function onAdd() {
    if (!selected) {
      presentToast({ message: "Select a product from search list", color: "warning", duration: 1500 });
      return;
    }

    try {
      await createBestSelling({
        itemCode: selected.itemCode,
        itemName: selected.itemName,
        brandName: selected.brandName,
        packValue: selected.packValue,
      });
      presentToast({ message: "Added to best selling", color: "success", duration: 1400 });
      setSelected(null);
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to add best selling",
        color: "danger",
        duration: 1800,
      });
    }
  }

  async function onDelete(id: number) {
    try {
      await deleteBestSelling(id);
      presentToast({ message: "Deleted", color: "success", duration: 1400 });
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete",
        color: "danger",
        duration: 1800,
      });
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
            <IonItem>
              <IonLabel position="stacked">Search Product</IonLabel>
              <IonInput
                value={searchText}
                placeholder="Search by code/name/brand"
                onIonInput={(e) => setSearchText(e.detail.value || "")}
              />
            </IonItem>
            <div className="settings-actions settings-actions-inline">
              <IonButton onClick={onSearch} disabled={searching}>
                {searching ? "Searching..." : "Search"}
              </IonButton>
            </div>

            {searchResults.length > 0 ? (
              <IonList>
                {searchResults.map((product) => (
                  <IonItem key={product.itemCode} button onClick={() => setSelected(product)}>
                    <IonLabel>
                      <h2>{product.itemName || product.itemCode}</h2>
                      <p>
                        {product.itemCode} | {product.brandName || "-"} | {product.packValue || "-"}
                      </p>
                    </IonLabel>
                    {selected?.itemCode === product.itemCode ? <IonBadge color="primary">Selected</IonBadge> : null}
                  </IonItem>
                ))}
              </IonList>
            ) : null}

            {selected ? (
              <div className="settings-selected-summary">
                <p>
                  <strong>Selected:</strong> {selected.itemName || "-"} ({selected.itemCode})
                </p>
                <div className="settings-actions settings-actions-inline">
                  <IonButton onClick={onAdd}>Add Product</IonButton>
                </div>
              </div>
            ) : null}
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Best Selling List</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {rows.length === 0 ? (
              <IonText color="medium">No products in best selling list.</IonText>
            ) : (
              <IonList>
                {rows.map((row) => (
                  <IonItem key={row.id}>
                    <IonLabel>
                      <h2>{row.itemName || row.itemCode}</h2>
                      <p>
                        {row.itemCode} | {row.brandName || "-"} | {row.packValue || "-"}
                      </p>
                    </IonLabel>
                    <IonButton size="small" color="danger" fill="outline" onClick={() => onDelete(row.id)}>
                      Delete
                    </IonButton>
                  </IonItem>
                ))}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
