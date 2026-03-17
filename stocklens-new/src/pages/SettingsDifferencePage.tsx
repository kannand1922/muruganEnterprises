import {
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  useIonAlert,
  useIonToast,
} from "@ionic/react";
import { useEffect, useMemo, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import { getShopLocations, type ShopLocation } from "../api/metaApi";
import { deleteDiffBatch, getDiffBatches, type DiffBatch } from "../api/stockApi";
import { getCurrentLocationIdFromStorage } from "../config/location";

function parsePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

export function SettingsDifferencePage() {
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [batches, setBatches] = useState<DiffBatch[]>([]);
  const [errorText, setErrorText] = useState("");

  const locationById = useMemo(
    () => new Map<number, ShopLocation>(locations.map((row) => [row.id, row])),
    [locations]
  );
  const selectedLocation = selectedLocationId ? locationById.get(selectedLocationId) || null : null;

  async function loadLocations() {
    const rows = await getShopLocations();
    setLocations(rows);
    const storedLocationId = getCurrentLocationIdFromStorage();
    const validLocationId =
      (storedLocationId && rows.some((row) => row.id === storedLocationId) && storedLocationId) ||
      rows[0]?.id ||
      null;
    setSelectedLocationId(validLocationId);
  }

  async function loadBatches(locationId: number) {
    setLoading(true);
    setErrorText("");
    try {
      const result = await getDiffBatches({ shopLocationId: locationId, includeDeleted: true });
      setBatches(result.rows || []);
    } catch (error) {
      setBatches([]);
      setErrorText(error instanceof Error ? error.message : "Failed to load diff batches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (!selectedLocationId) return;
    void loadBatches(selectedLocationId);
  }, [selectedLocationId]);

  async function handleDeleteBatch(batch: DiffBatch) {
    const batchLabel = `Batch #${batch.id}`;
    presentAlert({
      header: "Delete Diff Batch",
      message: `Delete ${batchLabel}? Items will be moved back to their source table.`,
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Delete",
          role: "destructive",
          handler: () => void confirmDeleteBatch(batch.id),
        },
      ],
    });
  }

  async function confirmDeleteBatch(batchId: number) {
    if (!selectedLocationId) return;
    try {
      const result = await deleteDiffBatch(batchId);
      presentToast({
        message: `Batch deleted. Restored ${result.restoredCount || 0} item(s).`,
        color: "success",
        duration: 2000,
      });
      await loadBatches(selectedLocationId);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to delete batch",
        color: "danger",
        duration: 2000,
      });
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Difference" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Diff Batches</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {locations.length > 1 ? (
              <IonItem lines="none" className="settings-select-row">
                <IonLabel>Shop Location</IonLabel>
                <IonSelect
                  value={selectedLocationId ?? undefined}
                  interface="popover"
                  onIonChange={(event) => {
                    const next = parsePositiveInt(event.detail.value);
                    setSelectedLocationId(next);
                  }}
                >
                  {locations.map((location) => (
                    <IonSelectOption key={location.id} value={location.id}>
                      {location.locationName}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            ) : null}

            {selectedLocation ? (
              <div className="settings-hint">Showing batches for {selectedLocation.locationName}.</div>
            ) : null}

            {loading ? (
              <div className="stock-loading-wrap">
                <IonSpinner name="crescent" />
                <IonText>Loading diff batches...</IonText>
              </div>
            ) : errorText ? (
              <div className="operator-required-box">{errorText}</div>
            ) : batches.length === 0 ? (
              <div className="stock-empty">No diff batches for this location.</div>
            ) : (
              <IonAccordionGroup multiple className="diff-accordion-group">
                {batches.map((batch) => {
                  const count = batch.itemCount ?? batch.items?.length ?? 0;
                  const cycleLabel = batch.cycle?.sno ? `Cycle #${batch.cycle.sno}` : `Cycle ${batch.cycleId}`;
                  const isDeleted = Boolean(batch.deletedAt);
                  return (
                    <IonAccordion
                      key={batch.id}
                      value={String(batch.id)}
                      className={`diff-accordion${isDeleted ? " is-deleted" : ""}`}
                    >
                      <IonItem slot="header" className="diff-accordion-header">
                        <IonLabel>
                          <div className="diff-accordion-title">Batch #{batch.id}</div>
                          <div className="diff-accordion-subtitle">
                            {cycleLabel} • {formatDateTime(batch.createdAt)} • {count} item(s)
                          </div>
                        </IonLabel>
                        <IonBadge color={isDeleted ? "medium" : "primary"}>{count}</IonBadge>
                        {isDeleted ? <IonBadge color="danger">Deleted</IonBadge> : null}
                      </IonItem>
                      <div slot="content" className="diff-accordion-content">
                        {batch.proofImageName ? (
                          <div className="diff-accordion-meta">
                            <div>Proof Path: {batch.proofImagePath || "-"}</div>
                            <div>Proof File: {batch.proofImageName}</div>
                          </div>
                        ) : null}
                        <IonButton
                          size="small"
                          fill="outline"
                          className="diff-batch-delete-btn"
                          disabled={isDeleted}
                          onClick={() => void handleDeleteBatch(batch)}
                        >
                          Delete Batch
                        </IonButton>

                        <div className="diff-item-list">
                          {(batch.items || []).map((item) => (
                            <div
                              key={item.id}
                              className={`diff-item-row${item.deletedAt ? " is-deleted" : ""}`}
                            >
                              <div className="diff-item-title">{item.brandName || item.itemName || item.itemCode}</div>
                              <div className="diff-item-meta">
                                {item.packValue || "-"} • Code: {item.itemCode} • Diff: {item.diffBottles}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </IonAccordion>
                  );
                })}
              </IonAccordionGroup>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
