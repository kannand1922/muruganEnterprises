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
  IonSelect,
  IonSelectOption,
  IonText,
  IonToggle,
  useIonToast,
} from "@ionic/react";
import { useEffect, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createPhone,
  deletePhone,
  getPhones,
  updatePhone,
  type Phone,
} from "../api/metaApi";
import {
  clearCurrentPhoneIdFromStorage,
  getCurrentPhoneIdFromStorage,
  setCurrentPhoneIdToStorage,
} from "../config/phone";

type PhoneForm = {
  name: string;
  lowStockNotificationsEnabled: boolean;
};

const EMPTY_FORM: PhoneForm = {
  name: "",
  lowStockNotificationsEnabled: true,
};

export function SettingsPhonesPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rows, setRows] = useState<Phone[]>([]);
  const [form, setForm] = useState<PhoneForm>(EMPTY_FORM);
  const [currentPhoneId, setCurrentPhoneId] = useState<number | null>(null);

  async function loadRows() {
    setLoading(true);
    try {
      const list = await getPhones();
      setRows(list);
      const storedId = getCurrentPhoneIdFromStorage();
      const validStored = storedId ? list.find((row) => row.id === storedId) : null;
      if (validStored) {
        setCurrentPhoneId(validStored.id);
      } else {
        setCurrentPhoneId(null);
        clearCurrentPhoneIdFromStorage();
      }
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load phones",
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

  function startEdit(row: Phone) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      lowStockNotificationsEnabled: Boolean(row.lowStockNotificationsEnabled),
    });
  }

  async function onSave() {
    const name = form.name.trim();
    if (!name) {
      presentToast({ message: "Phone name is required", color: "warning", duration: 1500 });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updatePhone(editingId, {
          name,
          lowStockNotificationsEnabled: form.lowStockNotificationsEnabled,
        });
        presentToast({ message: "Phone updated", color: "success", duration: 1400 });
      } else {
        await createPhone({
          name,
          lowStockNotificationsEnabled: form.lowStockNotificationsEnabled,
        });
        presentToast({ message: "Phone created", color: "success", duration: 1400 });
      }
      resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save phone",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await deletePhone(id);
      presentToast({ message: "Phone deleted", color: "success", duration: 1400 });
      if (currentPhoneId === id) {
        setCurrentPhoneId(null);
        clearCurrentPhoneIdFromStorage();
      }
      if (editingId === id) resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete phone",
        color: "danger",
        duration: 1800,
      });
    }
  }

  function onSelectCurrentPhone(nextIdRaw: string | number | null | undefined) {
    const nextId = Number(nextIdRaw);
    if (!Number.isFinite(nextId) || nextId <= 0) {
      setCurrentPhoneId(null);
      clearCurrentPhoneIdFromStorage();
      return;
    }
    setCurrentPhoneId(Math.trunc(nextId));
    setCurrentPhoneIdToStorage(Math.trunc(nextId));
    presentToast({ message: "Current phone selected", color: "success", duration: 1200 });
  }

  return (
    <IonPage>
      <AppTopBar title="Phones" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Current Phone</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Selected Phone</IonLabel>
              <IonSelect
                value={currentPhoneId ?? undefined}
                interface="popover"
                placeholder="Select phone"
                onIonChange={(e) => onSelectCurrentPhone(e.detail.value)}
              >
                {rows.map((row) => (
                  <IonSelectOption key={row.id} value={row.id}>
                    {row.id} - {row.name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonNote color="medium">
              Current phone id is stored in local storage and used for stock entries.
            </IonNote>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>{editingId ? "Edit Phone" : "Create Phone"}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Phone Name</IonLabel>
              <IonInput
                value={form.name}
                onIonInput={(e) => setForm((s) => ({ ...s, name: e.detail.value || "" }))}
                placeholder="Phone-A"
              />
            </IonItem>
            <IonItem lines="none">
              <IonLabel>Low Stock Push Notifications</IonLabel>
              <IonToggle
                checked={form.lowStockNotificationsEnabled}
                onIonChange={(event) =>
                  setForm((s) => ({ ...s, lowStockNotificationsEnabled: Boolean(event.detail.checked) }))
                }
              />
            </IonItem>
            <IonNote color="medium">
              This phone receives low stock alerts only when this setting is ON.
            </IonNote>
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
            <IonCardTitle>Phone List</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {rows.length === 0 ? (
              <IonText color="medium">No phones found.</IonText>
            ) : (
              <IonList>
                {rows.map((row) => (
                  <IonItem key={row.id}>
                    <IonLabel>
                      <h2>
                        {row.id} - {row.name}
                      </h2>
                      <p>
                        Low stock alerts: {row.lowStockNotificationsEnabled ? "ON" : "OFF"}
                      </p>
                    </IonLabel>
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
