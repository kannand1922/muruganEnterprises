import {
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
import { useEffect, useState, type CSSProperties } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createShopLocation,
  deleteShopLocation,
  getShopLocations,
  updateShopLocation,
  type ShopLocation,
} from "../api/metaApi";

type LocationForm = {
  locationCode: string;
  locationName: string;
  locationType: string;
  locationColor: string;
  sortOrder: number;
};

const EMPTY_FORM: LocationForm = {
  locationCode: "",
  locationName: "",
  locationType: "",
  locationColor: "#2563eb",
  sortOrder: 0,
};

export function SettingsShopLocationsPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rows, setRows] = useState<ShopLocation[]>([]);
  const [form, setForm] = useState<LocationForm>(EMPTY_FORM);

  async function loadRows() {
    setLoading(true);
    try {
      const list = await getShopLocations();
      setRows(list);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load locations",
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

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(row: ShopLocation) {
    setEditingId(row.id);
    setForm({
      locationCode: row.locationCode,
      locationName: row.locationName,
      locationType: row.locationType || "",
      locationColor: row.locationColor || "#2563eb",
      sortOrder: row.sortOrder,
    });
  }

  async function onSave() {
    if (!form.locationCode.trim() || !form.locationName.trim() || !form.locationColor.trim()) {
      presentToast({
        message: "Location code, location name and color are required",
        color: "warning",
        duration: 1500,
      });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateShopLocation(editingId, {
          locationCode: form.locationCode.trim(),
          locationName: form.locationName.trim(),
          locationType: form.locationType.trim(),
          locationColor: form.locationColor,
          sortOrder: Number(form.sortOrder || 0),
        });
        presentToast({ message: "Location updated", color: "success", duration: 1400 });
      } else {
        await createShopLocation({
          locationCode: form.locationCode.trim(),
          locationName: form.locationName.trim(),
          locationType: form.locationType.trim(),
          locationColor: form.locationColor,
          sortOrder: Number(form.sortOrder || 0),
        });
        presentToast({ message: "Location created", color: "success", duration: 1400 });
      }
      resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save location",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await deleteShopLocation(id);
      presentToast({ message: "Location deleted", color: "success", duration: 1400 });
      if (editingId === id) resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete location",
        color: "danger",
        duration: 1800,
      });
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Shop Locations" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>{editingId ? "Edit Location" : "Create Location"}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Location Code</IonLabel>
              <IonInput
                value={form.locationCode}
                onIonInput={(e) => setForm((s) => ({ ...s, locationCode: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Location Name</IonLabel>
              <IonInput
                value={form.locationName}
                onIonInput={(e) => setForm((s) => ({ ...s, locationName: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Location Type</IonLabel>
              <IonInput
                value={form.locationType}
                onIonInput={(e) => setForm((s) => ({ ...s, locationType: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Location Color</IonLabel>
              <div className="settings-color-input-wrap">
                <input
                  className="settings-color-picker"
                  type="color"
                  value={form.locationColor}
                  onChange={(e) => setForm((s) => ({ ...s, locationColor: e.target.value }))}
                />
                <IonInput
                  value={form.locationColor}
                  onIonInput={(e) =>
                    setForm((s) => ({ ...s, locationColor: (e.detail.value || "#2563eb").trim() }))
                  }
                  placeholder="#2563eb"
                />
              </div>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Sort Order</IonLabel>
              <IonInput
                type="number"
                value={String(form.sortOrder)}
                onIonInput={(e) => setForm((s) => ({ ...s, sortOrder: Number(e.detail.value || 0) }))}
              />
            </IonItem>
            <div className="settings-actions settings-actions-inline">
              <IonButton onClick={onSave} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </IonButton>
              <IonButton fill="outline" onClick={resetForm}>
                Clear
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Locations</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {rows.length === 0 ? (
              <IonText color="medium">No locations found.</IonText>
            ) : (
              <IonList className="locations-list">
                {rows.map((row) => (
                  <IonItem
                    key={row.id}
                    className="location-card"
                    style={{ "--shop-color": row.locationColor || "#1a73e8" } as CSSProperties}
                  >
                    <IonLabel>
                      <h2>{row.locationName}</h2>
                      <p>
                        Code: {row.locationCode} | Type: {row.locationType || "-"} | Color:{" "}
                        {row.locationColor} | Sort: {row.sortOrder}
                      </p>
                    </IonLabel>
                    <span
                      className="settings-color-dot"
                      style={{ background: row.locationColor }}
                      title={row.locationColor}
                    />
                    <div className="settings-row-actions">
                      <IonButton size="small" fill="outline" onClick={() => startEdit(row)}>
                        Edit
                      </IonButton>
                      <IonButton size="small" color="danger" fill="outline" onClick={() => onDelete(row.id)}>
                        Delete
                      </IonButton>
                    </div>
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
