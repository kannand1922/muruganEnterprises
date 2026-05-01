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
import { useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { verifySettingsPassword } from "../api/metaApi";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  SETTINGS_SAFETY_PASSWORD,
  grantSettingsAccess,
  hasSettingsAccess,
} from "../config/settingsAuth";

export function SettingsUnlockPage() {
  const [presentToast] = useIonToast();
  const history = useHistory();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    const next = String(searchParams.get("next") || "").trim();
    if (!next) return "/settings";
    if (next === "/settings") return next;
    if (next.startsWith("/settings/")) return next;
    return "/settings";
  }, [location.search]);

  useEffect(() => {
    if (hasSettingsAccess()) {
      history.replace(nextPath);
    }
  }, [history, nextPath]);

  async function unlockSettings() {
    const candidate = password.trim();
    if (!candidate) {
      presentToast({ message: "Password is required", color: "warning", duration: 1400 });
      return;
    }

    setIsSubmitting(true);
    try {
      const verified = await verifySettingsPassword(candidate);
      if (!verified) {
        presentToast({ message: "Invalid settings password", color: "danger", duration: 1600 });
        return;
      }
      grantSettingsAccess();
      history.replace(nextPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const isUnauthorized = message.includes("(401)");
      if (!isUnauthorized && candidate === SETTINGS_SAFETY_PASSWORD) {
        grantSettingsAccess();
        history.replace(nextPath);
        return;
      }
      presentToast({ message: "Invalid settings password", color: "danger", duration: 1600 });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Settings Unlock" showSettings={false} showLocationSwitcher={false} showBack />
      <IonContent fullscreen className="settings-page-content ion-padding">
        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Enter Settings Password</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Password</IonLabel>
              <IonInput
                type="password"
                value={password}
                onIonInput={(event) => setPassword(event.detail.value || "")}
                placeholder="Enter password"
              />
            </IonItem>
            <IonNote color="medium">Settings access is protected for safety.</IonNote>
            <div className="settings-actions">
              <IonButton expand="block" onClick={() => void unlockSettings()} disabled={isSubmitting}>
                {isSubmitting ? "Checking..." : "Unlock Settings"}
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
