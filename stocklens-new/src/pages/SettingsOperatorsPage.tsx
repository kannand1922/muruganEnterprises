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
  IonToggle,
  useIonToast,
} from "@ionic/react";
import { useEffect, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import { createWorker, deleteWorker, getWorkers, updateWorker, type Worker } from "../api/metaApi";

type WorkerForm = {
  name: string;
  phone: string;
  active: boolean;
};

const EMPTY_FORM: WorkerForm = {
  name: "",
  phone: "",
  active: true,
};

export function SettingsOperatorsPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rows, setRows] = useState<Worker[]>([]);
  const [form, setForm] = useState<WorkerForm>(EMPTY_FORM);

  async function loadRows() {
    setLoading(true);
    try {
      const list = await getWorkers();
      setRows(list);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load operators",
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

  function startEdit(row: Worker) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      phone: row.phone || "",
      active: row.active,
    });
  }

  async function onSave() {
    if (!form.name.trim()) {
      presentToast({ message: "Operator name is required", color: "warning", duration: 1500 });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateWorker(editingId, {
          name: form.name.trim(),
          phone: form.phone.trim(),
          active: form.active,
        });
        presentToast({ message: "Operator updated", color: "success", duration: 1400 });
      } else {
        await createWorker({
          name: form.name.trim(),
          phone: form.phone.trim(),
          active: true,
        });
        presentToast({ message: "Operator created", color: "success", duration: 1400 });
      }
      resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save operator",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await deleteWorker(id);
      presentToast({ message: "Operator deleted", color: "success", duration: 1400 });
      if (editingId === id) resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete operator",
        color: "danger",
        duration: 1800,
      });
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Operators" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>{editingId ? "Edit Operator" : "Create Operator"}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Operator Name</IonLabel>
              <IonInput
                value={form.name}
                onIonInput={(e) => setForm((s) => ({ ...s, name: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Phone</IonLabel>
              <IonInput
                value={form.phone}
                onIonInput={(e) => setForm((s) => ({ ...s, phone: e.detail.value || "" }))}
              />
            </IonItem>
            {editingId ? (
              <IonItem lines="none">
                <IonLabel>Active</IonLabel>
                <IonToggle
                  checked={form.active}
                  onIonChange={(e) => setForm((s) => ({ ...s, active: e.detail.checked }))}
                />
              </IonItem>
            ) : (
              <IonNote color="medium">Active is auto-prefilled as ON for new operator.</IonNote>
            )}
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
            <IonCardTitle>Operators List</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {rows.length === 0 ? (
              <IonText color="medium">No operators found.</IonText>
            ) : (
              <IonList>
                {rows.map((row) => (
                  <IonItem key={row.id}>
                    <IonLabel>
                      <h2>{row.name}</h2>
                      <p>Phone: {row.phone || "-"}</p>
                    </IonLabel>
                    <IonBadge color={row.active ? "success" : "medium"}>
                      {row.active ? "Active" : "Inactive"}
                    </IonBadge>
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
