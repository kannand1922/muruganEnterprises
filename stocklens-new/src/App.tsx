import { useEffect, useState } from "react";
import { IonApp, IonContent, IonIcon, IonPage } from "@ionic/react";
import { alertCircleOutline } from "ionicons/icons";
import { AppRoutes } from "./routes/AppRoutes";
import { APP_BUILD_NUMBER } from "./config/appVersion";
import { getRequiredBuild } from "./api/metaApi";
import { initializeFcmToken, startFcmConnectionHeartbeat } from "./services/fcm";

const VERSION_CHECK_TIMEOUT_MS = 5000;

type VersionStatus = "checking" | "ok" | "mismatch" | "unknown";

export function App() {
  const [versionStatus, setVersionStatus] = useState<VersionStatus>("unknown");
  const [requiredBuild, setRequiredBuild] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!isMounted || resolved) return;
      resolved = true;
      setVersionStatus("unknown");
    }, VERSION_CHECK_TIMEOUT_MS);

    const checkVersion = async () => {
      try {
        const required = await getRequiredBuild();
        if (!isMounted || resolved) return;
        resolved = true;
        if (!required) {
          setVersionStatus("unknown");
          return;
        }
        setRequiredBuild(required);
        setVersionStatus(required === APP_BUILD_NUMBER ? "ok" : "mismatch");
      } catch (error) {
        if (!isMounted || resolved) return;
        resolved = true;
        console.warn("Version check failed:", error);
        setVersionStatus("unknown");
      } finally {
        clearTimeout(timeoutId);
      }
    };

    checkVersion();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const token = await initializeFcmToken({ requestPermission: true });
        if (!token) return;
        await startFcmConnectionHeartbeat();
      } catch (error) {
        console.warn("FCM setup failed:", error);
      }
    })();
  }, []);

  if (versionStatus === "mismatch") {
    return (
      <IonApp>
        <IonPage>
          <IonContent fullscreen>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: "12px",
                textAlign: "center",
                padding: "24px",
              }}
            >
              <IonIcon
                icon={alertCircleOutline}
                style={{ fontSize: "40px", color: "#c0392b" }}
              />
              <div style={{ fontSize: "20px", fontWeight: 700 }}>
                App Update Required
              </div>
              <div style={{ fontSize: "14px" }}>
                App version is not matching. Please update to continue.
              </div>
              <div style={{ fontSize: "12px", opacity: 0.75 }}>
                Current build: {APP_BUILD_NUMBER}
                {requiredBuild ? ` • Required build: ${requiredBuild}` : ""}
              </div>
            </div>
          </IonContent>
        </IonPage>
      </IonApp>
    );
  }

  return (
    <IonApp>
      <AppRoutes />
    </IonApp>
  );
}
