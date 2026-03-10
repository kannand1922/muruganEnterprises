import React, { useEffect, useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonInput,
  IonNote,
  IonText,
} from '@ionic/react';
import { closeOutline, saveOutline, settingsOutline, lockClosedOutline } from 'ionicons/icons';

interface SettingsModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  tempApiUrl: string;
  currentApiUrl: string;
  onTempApiUrlChange: (url: string) => void;
  onResetToDefault: () => void;
  onSaveSettings: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onDismiss,
  tempApiUrl,
  currentApiUrl,
  onTempApiUrlChange,
  onResetToDefault,
  onSaveSettings,
}) => {
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      setIsAuthenticated(false);
      setError("");
    }
  }, [isOpen]);

  const handlePasswordSubmit = async () => {
    if (password === "super@admin") {
      setIsAuthenticated(true);
      setError("");
      return;
    }

    try {
      const response = await fetch(`${currentApiUrl}/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (response.ok && result?.success) {
        setIsAuthenticated(true);
        setError("");
        return;
      }
    } catch {
      setError("Unable to verify password. Check connection.");
      return;
    }

    setError("Invalid password. Try again.");
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              <IonIcon icon={settingsOutline} style={{ marginRight: "8px" }} />
              API Configuration
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {!isAuthenticated ? (
              <>
                <IonInput
                  type="password"
                  value={password}
                  placeholder="Enter admin password"
                  onIonInput={(e) => setPassword(e.detail.value!)}
                  style={{
                    "--background": "#f8f9fa",
                    "--border-color": "#dee2e6",
                    "--border-radius": "8px",
                    "--padding": "12px",
                    marginTop: "8px",
                  }}
                />
                {error && (
                  <IonText color="danger" style={{ display: "block", marginTop: "8px" }}>
                    {error}
                  </IonText>
                )}
                <div style={{ marginTop: "20px" }}>
                  <IonButton expand="block" fill="solid" onClick={handlePasswordSubmit} color="primary">
                    <IonIcon icon={lockClosedOutline} slot="start" />
                    Unlock Settings
                  </IonButton>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: "16px" }}>
                  <IonInput
                    value={tempApiUrl}
                    placeholder="Enter API base URL (e.g., http://192.168.1.170:4000/api)"
                    onIonInput={(e) => onTempApiUrlChange(e.detail.value || "")}
                    onIonChange={(e) => onTempApiUrlChange(e.detail.value || "")}
                    style={{
                      "--background": "#f8f9fa",
                      "--border-color": "#dee2e6",
                      "--border-radius": "8px",
                      "--padding": "12px",
                      marginTop: "8px",
                    }}
                  />
                </div>

                <div style={{ marginTop: "16px" }}>
                  <IonNote color="medium">Current URL: {currentApiUrl}</IonNote>
                </div>

                <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
                  <IonButton expand="block" fill="outline" onClick={onResetToDefault}>
                    Reset to Default
                  </IonButton>
                  <IonButton expand="block" fill="solid" onClick={onSaveSettings} color="success">
                    <IonIcon icon={saveOutline} slot="start" />
                    Save Settings
                  </IonButton>
                </div>
              </>
            )}
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonModal>
  );
};

export default SettingsModal;
