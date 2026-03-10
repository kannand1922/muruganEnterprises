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
  IonModal,
  IonPage,
  IonText,
  useIonToast,
  useIonViewWillEnter,
} from "@ionic/react";
import { useMemo, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  forceCloseCycle,
  getActiveCycleSummary,
  startCycle,
  stopCycle,
} from "../api/cyclesApi";

type ActiveSummary = {
  active: boolean;
  closeAllowed: boolean;
  closeGuard: {
    unfinishedCount: number;
    unmatchedFinishedCount: number;
  };
  cycle: {
    id: number;
    sno?: number | null;
    startDate: string;
    endDate?: string | null;
    status: "active" | "inactive";
  } | null;
};

export function CyclesPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ActiveSummary>({
    active: false,
    closeAllowed: false,
    closeGuard: { unfinishedCount: 0, unmatchedFinishedCount: 0 },
    cycle: null,
  });
  const [showForceCloseModal, setShowForceCloseModal] = useState(false);
  const [forceClosePassword, setForceClosePassword] = useState("");

  const startDateText = useMemo(() => {
    if (!summary.cycle?.startDate) return "-";
    return new Date(summary.cycle.startDate).toLocaleString();
  }, [summary.cycle?.startDate]);

  async function loadSummary() {
    setLoading(true);
    try {
      const result = await getActiveCycleSummary();
      setSummary({
        active: result.active,
        closeAllowed: result.closeAllowed,
        closeGuard: result.closeGuard,
        cycle: result.cycle,
      });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load cycle data",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  useIonViewWillEnter(() => {
    void loadSummary();
  });

  async function onClose() {
    if (!summary.cycle?.id) {
      presentToast({ message: "No active cycle to close", color: "warning", duration: 1500 });
      return;
    }
    if (!summary.closeAllowed) {
      presentToast({
        message: `Cannot close. Unfinished: ${summary.closeGuard.unfinishedCount}, Unmatched: ${summary.closeGuard.unmatchedFinishedCount}`,
        color: "warning",
        duration: 2200,
      });
      return;
    }
    setLoading(true);
    try {
      await stopCycle(summary.cycle.id);
      presentToast({ message: "Cycle closed", color: "success", duration: 1400 });
      await loadSummary();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to close cycle",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  function openForceCloseModal() {
    if (!summary.active) {
      presentToast({ message: "No active cycle to force close", color: "warning", duration: 1500 });
      return;
    }
    setForceClosePassword("");
    setShowForceCloseModal(true);
  }

  function closeForceCloseModal() {
    if (loading) return;
    setShowForceCloseModal(false);
    setForceClosePassword("");
  }

  async function confirmForceClose() {
    const trimmedPassword = forceClosePassword.trim();
    if (!trimmedPassword) {
      presentToast({ message: "Password is required", color: "warning", duration: 1500 });
      return;
    }

    setLoading(true);
    try {
      await forceCloseCycle({ startNew: false, password: trimmedPassword });
      presentToast({ message: "Cycle force-closed", color: "success", duration: 1800 });
      setShowForceCloseModal(false);
      setForceClosePassword("");
      await loadSummary();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to force close cycle",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  async function onStartNew() {
    setLoading(true);
    try {
      await startCycle();
      presentToast({ message: "New cycle started", color: "success", duration: 1400 });
      await loadSummary();
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to start cycle",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Cycles" showBack backPath="/dashboard" />
      <IonContent fullscreen className="main-page-content ion-padding stock-entry-content">
        <IonCard className="control-card">
          <IonCardHeader>
            <IonCardTitle>Current Cycle</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className={`cycle-status-box ${summary.active ? "is-active" : "is-inactive"}`}>
              <div className="cycle-title">{summary.active ? "Cycle Active" : "No Active Cycle"}</div>
              <div className="cycle-subtitle">SNO: {summary.cycle?.sno ?? "-"}</div>
              <div className="cycle-subtitle">Start Date: {startDateText}</div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <IonButton
                expand="block"
                color="dark"
                onClick={() => void onClose()}
                disabled={loading || !summary.active || !summary.closeAllowed}
              >
                Close
              </IonButton>
              <IonButton
                expand="block"
                color="danger"
                onClick={openForceCloseModal}
                disabled={loading || !summary.active}
              >
                Force Close
              </IonButton>
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => void onStartNew()}
                disabled={loading || summary.active}
              >
                Start New Cycle
              </IonButton>
            </div>
            {loading ? (
              <IonText color="medium">
                <p style={{ marginTop: 10 }}>Updating cycle...</p>
              </IonText>
            ) : null}
          </IonCardContent>
        </IonCard>
      </IonContent>

      <IonModal isOpen={showForceCloseModal} onDidDismiss={closeForceCloseModal}>
        <IonContent className="ion-padding">
          <IonCard className="control-card" style={{ marginTop: 12 }}>
            <IonCardHeader>
              <IonCardTitle>Force Close Cycle</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonText color="medium">
                <p style={{ marginTop: 0, marginBottom: 12 }}>
                  Enter force close password to close the active cycle.
                </p>
              </IonText>
              <IonItem lines="full">
                <IonLabel position="stacked">Password</IonLabel>
                <IonInput
                  type="password"
                  value={forceClosePassword}
                  placeholder="Enter force close password"
                  onIonInput={(event) => setForceClosePassword(event.detail.value || "")}
                />
              </IonItem>

              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <IonButton
                  expand="block"
                  color="danger"
                  onClick={() => void confirmForceClose()}
                  disabled={loading || !forceClosePassword.trim()}
                >
                  Confirm Force Close
                </IonButton>
                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={closeForceCloseModal}
                  disabled={loading}
                >
                  Cancel
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        </IonContent>
      </IonModal>
    </IonPage>
  );
}
