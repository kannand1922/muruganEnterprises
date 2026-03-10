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
  IonToggle,
  useIonToast,
} from "@ionic/react";
import { useEffect, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createPrinter,
  deletePrinter,
  getPrinters,
  updatePrinter,
  type Printer,
} from "../api/metaApi";

type PrinterForm = {
  name: string;
  ipAddress: string;
  port: string;
  defaultPrinter: boolean;
};

const EMPTY_FORM: PrinterForm = {
  name: "",
  ipAddress: "",
  port: "9100",
  defaultPrinter: false,
};

export function SettingsPrintersPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rows, setRows] = useState<Printer[]>([]);
  const [form, setForm] = useState<PrinterForm>(EMPTY_FORM);

  async function loadRows() {
    setLoading(true);
    try {
      const list = await getPrinters();
      setRows(list);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load printers",
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

  function startEdit(row: Printer) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      ipAddress: row.ipAddress,
      port: String(row.port || 9100),
      defaultPrinter: Boolean(row.defaultPrinter),
    });
  }

  async function onSave() {
    const name = form.name.trim();
    const ipAddress = form.ipAddress.trim();
    const port = Number(form.port.trim() || "9100");
    const defaultPrinter = Boolean(form.defaultPrinter);

    if (!name || !ipAddress) {
      presentToast({
        message: "Printer name and IP address are required",
        color: "warning",
        duration: 1500,
      });
      return;
    }

    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      presentToast({
        message: "Port must be between 1 and 65535",
        color: "warning",
        duration: 1500,
      });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updatePrinter(editingId, {
          name,
          ipAddress,
          port: Math.trunc(port),
          defaultPrinter,
        });
        presentToast({ message: "Printer updated", color: "success", duration: 1400 });
      } else {
        await createPrinter({
          name,
          ipAddress,
          port: Math.trunc(port),
          defaultPrinter,
        });
        presentToast({ message: "Printer added", color: "success", duration: 1400 });
      }
      resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save printer",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await deletePrinter(id);
      presentToast({ message: "Printer deleted", color: "success", duration: 1400 });
      if (editingId === id) resetForm();
      await loadRows();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete printer",
        color: "danger",
        duration: 1800,
      });
    }
  }

  return (
    <IonPage>
      <AppTopBar
        title="Printers"
        showBack
        showSettings={false}
        showLocationSwitcher={false}
        backPath="/settings"
      />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>{editingId ? "Edit Printer" : "Add Printer"}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Printer Name</IonLabel>
              <IonInput
                value={form.name}
                onIonInput={(e) => setForm((s) => ({ ...s, name: e.detail.value || "" }))}
                placeholder="Shop Printer"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">IP Address</IonLabel>
              <IonInput
                value={form.ipAddress}
                type="text"
                inputMode="decimal"
                onIonInput={(e) => setForm((s) => ({ ...s, ipAddress: e.detail.value || "" }))}
                placeholder="192.168.1.25"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Port</IonLabel>
              <IonInput
                value={form.port}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                onIonInput={(e) => setForm((s) => ({ ...s, port: e.detail.value || "" }))}
                placeholder="9100"
              />
            </IonItem>
            <IonItem>
              <IonLabel>Default Printer</IonLabel>
              <IonToggle
                checked={form.defaultPrinter}
                onIonChange={(e) =>
                  setForm((s) => ({ ...s, defaultPrinter: Boolean(e.detail.checked) }))
                }
              />
            </IonItem>

            <div className="settings-actions settings-actions-inline">
              <IonButton onClick={onSave} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Add"}
              </IonButton>
              <IonButton fill="outline" onClick={resetForm}>
                Clear
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Printer List</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {rows.length === 0 ? (
              <IonText color="medium">No printers found.</IonText>
            ) : (
              <IonList>
                {rows.map((row) => (
                  <IonItem key={row.id}>
                    <IonLabel>
                      <h2>
                        {row.name}
                        {row.defaultPrinter ? " (Default)" : ""}
                      </h2>
                      <p>
                        {row.ipAddress}:{row.port}
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
