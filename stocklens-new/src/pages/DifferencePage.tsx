import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCheckbox,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonModal,
  IonPage,
  IonSpinner,
  IonText,
  useIonToast,
} from "@ionic/react";
import { cameraOutline, closeOutline, cloudUploadOutline, refreshOutline } from "ionicons/icons";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentCycle } from "../api/cyclesApi";
import { getShopLocations, type ShopLocation } from "../api/metaApi";
import {
  createDiffBatch,
  getVerifyMismatchedFinished,
  type VerifyMismatchedFinishedRow,
} from "../api/stockApi";
import { AppTopBar } from "../components/common/AppTopBar";
import { CURRENT_LOCATION_ID_KEY, LOCATION_CHANGED_EVENT, getCurrentLocationIdFromStorage } from "../config/location";
import { captureDiffProofPhoto, type DiffProofPhoto } from "../services/diffProofPhoto";

const CURRENT_OPERATOR_ID_KEY = "stocklens_current_operator_id";

function parsePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

export function DifferencePage() {
  const [presentToast] = useIonToast();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeCycleId, setActiveCycleId] = useState<number | null>(null);
  const [activeCycleSno, setActiveCycleSno] = useState<number | null>(null);
  const [currentLocationId, setCurrentLocationId] = useState<number | null>(null);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [rows, setRows] = useState<VerifyMismatchedFinishedRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showProofModal, setShowProofModal] = useState(false);
  const [capturingProof, setCapturingProof] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<DiffProofPhoto | null>(null);

  const locationById = useMemo(
    () => new Map<number, ShopLocation>(locations.map((row) => [row.id, row])),
    [locations]
  );
  const currentLocation = currentLocationId ? locationById.get(currentLocationId) || null : null;

  async function loadFinishedDiffRows(cycleId: number, shopLocationId: number) {
    const result = await getVerifyMismatchedFinished({ cycleId, shopLocationId });
    setRows(result.rows || []);
    setSelectedIds(new Set());
  }

  async function loadPageData() {
    setLoading(true);
    try {
      const [cycleResult, locationRows] = await Promise.all([getCurrentCycle(), getShopLocations()]);
      setLocations(locationRows);

      const storedLocationId = getCurrentLocationIdFromStorage();
      const validLocationId =
        (storedLocationId && locationRows.some((row) => row.id === storedLocationId) && storedLocationId) ||
        locationRows[0]?.id ||
        null;
      setCurrentLocationId(validLocationId);

      if (!cycleResult.active || !cycleResult.cycle) {
        setActiveCycleId(null);
        setActiveCycleSno(null);
        setRows([]);
        return;
      }

      setActiveCycleId(cycleResult.cycle.id);
      setActiveCycleSno(cycleResult.cycle.sno ?? null);

      if (validLocationId) {
        await loadFinishedDiffRows(cycleResult.cycle.id, validLocationId);
      } else {
        setRows([]);
      }
    } catch (error) {
      setRows([]);
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load unmatched items",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPageData();
  }, [location.search]);

  useEffect(() => {
    function onLocationChanged(event: Event) {
      const custom = event as CustomEvent<ShopLocation>;
      const nextId = parsePositiveInt(custom.detail?.id);
      if (!nextId) return;
      setCurrentLocationId(nextId);
      localStorage.setItem(CURRENT_LOCATION_ID_KEY, String(nextId));
      if (activeCycleId) {
        void loadFinishedDiffRows(activeCycleId, nextId);
      }
    }
    window.addEventListener(LOCATION_CHANGED_EVENT, onLocationChanged as EventListener);
    return () => {
      window.removeEventListener(LOCATION_CHANGED_EVENT, onLocationChanged as EventListener);
    };
  }, [activeCycleId]);

  const selectedCount = selectedIds.size;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  function toggleSelection(rowId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(rows.map((row) => row.id)));
  }

  async function handleCreateDiff() {
    if (!activeCycleId || !currentLocationId) {
      presentToast({
        message: "Select an active cycle and shop location first.",
        color: "warning",
        duration: 1500,
      });
      return;
    }
    if (selectedIds.size === 0) {
      presentToast({ message: "Select at least one item.", color: "warning", duration: 1400 });
      return;
    }
    setShowProofModal(true);
  }

  async function submitDiffBatch() {
    if (!activeCycleId || !currentLocationId) return;
    const operatorId = parsePositiveInt(localStorage.getItem(CURRENT_OPERATOR_ID_KEY));
    setCreating(true);
    try {
      const result = await createDiffBatch({
        cycleId: activeCycleId,
        shopLocationId: currentLocationId,
        sourceScope: "unfinished",
        itemIds: Array.from(selectedIds),
        createdByWorkerId: operatorId,
        proofImageName: proofPhoto?.fileName,
        proofImageData: proofPhoto?.base64Data,
        proofImageMimeType: proofPhoto?.mimeType,
      });
      const printMessage = result.print?.message ? ` ${result.print.message}` : "";
      const toastColor = result.print && !result.print.success && !result.print.skipped ? "warning" : "success";
      presentToast({
        message: `${result.movedCount} item(s) moved to diff batch #${result.batch.id}.${printMessage}`,
        color: toastColor,
        duration: 2200,
      });
      setShowProofModal(false);
      setProofPhoto(null);
      await loadFinishedDiffRows(activeCycleId, currentLocationId);
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to create diff batch",
        color: "danger",
        duration: 2000,
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleCaptureProofPhoto() {
    setCapturingProof(true);
    try {
      const nextPhoto = await captureDiffProofPhoto();
      setProofPhoto(nextPhoto);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to capture proof photo";
      if (!/cancel/i.test(message)) {
        presentToast({ message, color: "danger", duration: 1800 });
      }
    } finally {
      setCapturingProof(false);
    }
  }

  const hasActiveCycle = Boolean(activeCycleId);

  return (
    <IonPage>
      <AppTopBar title="Difference" showBack backPath="/stock" />
      <IonContent fullscreen className="main-page-content ion-padding stock-entry-content difference-content">
        <IonCard className="control-card difference-layout-card">
          <IonCardContent className="control-content difference-layout-content">
            <div className="finish-summary-top">
              <div className="finish-summary-head">
                <div className="finish-operator-name">
                  {hasActiveCycle
                    ? `Cycle: ${activeCycleSno ? `#${activeCycleSno}` : "Active"}`
                    : "No active cycle"}
                </div>
                {currentLocation ? (
                  <IonBadge
                    className="location-badge"
                    style={{ "--shop-color": currentLocation.locationColor } as CSSProperties}
                  >
                    {currentLocation.locationName}
                  </IonBadge>
                ) : null}
              </div>
              <IonButton
                className="difference-create-btn"
                onClick={() => void handleCreateDiff()}
                disabled={creating || loading || !hasActiveCycle || !currentLocationId || selectedCount === 0}
              >
                {creating ? "Creating..." : "Create Diff"}
              </IonButton>
            </div>

            <div className="finish-summary-meta-row">
              <IonBadge className="finish-count-chip">{rows.length} mismatched finished item(s)</IonBadge>
              <IonBadge className="finish-count-chip">{selectedCount} selected</IonBadge>
              <IonButton
                size="small"
                fill="outline"
                className="diff-select-all-btn"
                disabled={rows.length === 0}
                onClick={toggleSelectAll}
              >
                {allSelected ? "Clear" : "Select All"}
              </IonButton>
            </div>

            {loading ? (
              <div className="stock-loading-wrap">
                <IonSpinner name="crescent" />
                <IonText>Loading unmatched items...</IonText>
              </div>
            ) : !hasActiveCycle ? (
              <div className="operator-required-box">No active cycle. Start a cycle first.</div>
            ) : rows.length === 0 ? (
              <div className="stock-empty">No mismatched finished items for this location.</div>
            ) : (
              <div className="search-results-container finish-result-list difference-result-list">
                {rows.map((row) => {
                  return (
                    <IonItem key={row.id} lines="none" className="search-result-items finish-result-item">
                      <IonCheckbox
                        slot="start"
                        checked={selectedIds.has(row.id)}
                        onIonChange={() => toggleSelection(row.id)}
                      />
                      <IonLabel>
                        <h3 className="result-brand">
                          {row.brandName || "-"} • {row.itemName || row.itemCode} • {row.packValue || "-"}
                        </h3>
                      </IonLabel>
                    </IonItem>
                  );
                })}
              </div>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>

      <IonModal
        isOpen={showProofModal}
        onDidDismiss={() => {
          if (!creating) {
            setShowProofModal(false);
            setProofPhoto(null);
          }
        }}
        className="difference-proof-modal"
      >
        <IonContent fullscreen className="difference-proof-content">
          <div className="stock-sheet-header">
            <h2>Upload Proof</h2>
            <IonButton fill="clear" onClick={() => setShowProofModal(false)}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </div>

          <div className="difference-proof-body">
            <IonButton
              expand="block"
              fill={proofPhoto ? "outline" : "solid"}
              className="difference-proof-submit"
              disabled={creating || capturingProof}
              onClick={() => void handleCaptureProofPhoto()}
            >
              <IonIcon icon={proofPhoto ? refreshOutline : cameraOutline} slot="start" />
              {capturingProof ? "Opening Camera..." : proofPhoto ? "Retake Proof Photo" : "Take Proof Photo"}
            </IonButton>

            {proofPhoto ? (
              <IonItem lines="none" className="difference-proof-item">
                <IonLabel>
                  <h3>{proofPhoto.fileName}</h3>
                  <p>Captured from live camera and saved automatically to the configured diff image path.</p>
                  <img
                    src={proofPhoto.dataUrl}
                    alt="Captured proof"
                    style={{
                      display: "block",
                      width: "100%",
                      borderRadius: "12px",
                      marginTop: "12px",
                      objectFit: "cover",
                    }}
                  />
                </IonLabel>
              </IonItem>
            ) : null}

            <IonText color="medium" className="difference-proof-note">
              No local file picker is used here. Tap the camera button to capture proof directly.
            </IonText>

            <IonButton
              expand="block"
              className="difference-proof-submit"
              disabled={creating || capturingProof}
              onClick={() => void submitDiffBatch()}
            >
              <IonIcon icon={cloudUploadOutline} slot="start" />
              {creating ? "Saving..." : proofPhoto ? "Save Proof & Create" : "Create Without Photo"}
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </IonPage>
  );
}
