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
  IonNote,
  IonPage,
  useIonToast,
} from "@ionic/react";
import { useEffect, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  setApiBaseUrl,
} from "../config/env";

export function SettingsCommonConfigPage() {
  const [presentToast] = useIonToast();
  const [backendUrlInput, setBackendUrlInput] = useState("");
  const [currentBackendUrl, setCurrentBackendUrl] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "checking" | "connected" | "disconnected"
  >("idle");

  function reloadCurrentValues() {
    const backend = getApiBaseUrl();
    setBackendUrlInput(backend);
    setCurrentBackendUrl(backend);
  }

  useEffect(() => {
    reloadCurrentValues();
  }, []);

  function toHealthUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    if (!normalized) return "";
    if (normalized.endsWith("/api")) {
      return `${normalized.slice(0, -4)}/health`;
    }
    return `${normalized}/health`;
  }

  async function checkConnection(backendUrl: string) {
    const healthUrl = toHealthUrl(backendUrl);
    if (!healthUrl) {
      setConnectionStatus("disconnected");
      return false;
    }

    setConnectionStatus("checking");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(healthUrl, { method: "GET", signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        setConnectionStatus("disconnected");
        return false;
      }

      const data = (await response.json()) as { ok?: boolean };
      const connected = Boolean(data?.ok);
      setConnectionStatus(connected ? "connected" : "disconnected");
      return connected;
    } catch (error) {
      clearTimeout(timeout);
      setConnectionStatus("disconnected");
      return false;
    }
  }

  function onSave() {
    if (!backendUrlInput.trim()) {
      presentToast({ message: "Backend URL is required", color: "warning", duration: 1500 });
      return;
    }

    const backend = setApiBaseUrl(backendUrlInput);
    setCurrentBackendUrl(backend);
    setBackendUrlInput(backend);
    presentToast({ message: "Configuration saved", color: "success", duration: 1400 });
    void checkConnection(backend);
  }

  const isDirty = backendUrlInput.trim().replace(/\/+$/, "") !== currentBackendUrl;

  const badgeText =
    connectionStatus === "checking"
      ? "Checking"
      : connectionStatus === "connected"
        ? "Connected"
        : connectionStatus === "disconnected"
          ? "Disconnected"
          : "Not Checked";

  const badgeTone =
    connectionStatus === "connected"
      ? "green"
      : connectionStatus === "checking"
        ? "amber"
        : connectionStatus === "disconnected"
          ? "red"
          : "gray";

  useEffect(() => {
    if (!currentBackendUrl) return;
    void checkConnection(currentBackendUrl);
  }, [currentBackendUrl]);

  return (
    <IonPage>
      <AppTopBar
        title="Common Configuration"
        showBack
        showSettings={false}
        showLocationSwitcher={false}
        backPath="/settings"
        statusBadgeText={badgeText}
        statusBadgeTone={badgeTone}
      />
      <IonContent fullscreen className="settings-page-content ion-padding">
        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Current Values</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonNote>Endpoint: {currentBackendUrl}</IonNote>
            <div className="settings-actions settings-actions-inline">
              <IonButton
                size="small"
                fill="outline"
                onClick={() => void checkConnection(backendUrlInput || currentBackendUrl)}
              >
                Check
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Edit Configuration</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Backend URL</IonLabel>
              <IonInput
                value={backendUrlInput}
                onIonInput={(e) => setBackendUrlInput(e.detail.value || "")}
                placeholder="http://192.168.1.170:4000/new/api"
              />
            </IonItem>
            <IonNote color="medium">Default Endpoint: {DEFAULT_API_BASE_URL}</IonNote>

            {isDirty ? (
              <div className="settings-actions">
                <IonButton expand="block" onClick={onSave}>
                  Edit Save
                </IonButton>
              </div>
            ) : null}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
