import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonTextarea,
  useIonToast,
} from "@ionic/react";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import { getPhones, getShopLocations, registerFcmToken, type Phone, type ShopLocation } from "../api/metaApi";
import { getFcmAlertLocationIdFromStorage, setFcmAlertLocationIdToStorage } from "../config/fcm";
import { getCurrentLocationIdFromStorage } from "../config/location";
import { getCurrentPhoneIdFromStorage } from "../config/phone";
import { clearStoredFcmToken, getStoredFcmToken, initializeFcmToken } from "../services/fcm";

export function SettingsFcmPage() {
  const [presentToast] = useIonToast();
  const [phones, setPhones] = useState<Phone[]>([]);
  const [locationRows, setLocationRows] = useState<ShopLocation[]>([]);
  const [currentPhoneId, setCurrentPhoneId] = useState<number | null>(null);
  const [tokenLocationId, setTokenLocationId] = useState<number | null>(null);
  const [fcmToken, setFcmToken] = useState<string | null>(() => getStoredFcmToken());
  const [fcmLoading, setFcmLoading] = useState(false);

  const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  const selectedPhone = phones.find((row) => row.id === currentPhoneId) || null;
  const selectedLocation = locationRows.find((row) => row.id === tokenLocationId) || null;

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!isAndroidNative) return;
    if (!currentPhoneId || !tokenLocationId) return;
    void syncFcmToken();
  }, [isAndroidNative, currentPhoneId, tokenLocationId]);

  async function loadData() {
    try {
      const [phoneRows, shopLocations] = await Promise.all([getPhones(), getShopLocations()]);
      setPhones(phoneRows);
      setLocationRows(shopLocations);

      const storedPhoneId = getCurrentPhoneIdFromStorage();
      const validPhoneId = storedPhoneId && phoneRows.some((row) => row.id === storedPhoneId) ? storedPhoneId : null;
      setCurrentPhoneId(validPhoneId);

      const storedAlertLocationId = getFcmAlertLocationIdFromStorage();
      const fallbackLocationId = getCurrentLocationIdFromStorage();
      const preferredLocationId = storedAlertLocationId || fallbackLocationId || null;
      const validLocationId =
        preferredLocationId && shopLocations.some((row) => row.id === preferredLocationId)
          ? preferredLocationId
          : (shopLocations[0]?.id ?? null);

      setTokenLocationId(validLocationId);
      if (validLocationId) {
        setFcmAlertLocationIdToStorage(validLocationId);
      }
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load FCM settings",
        color: "danger",
        duration: 1800,
      });
    }
  }

  async function syncFcmToken(options: { force?: boolean; showSuccessToast?: boolean } = {}) {
    const { force = false, showSuccessToast = false } = options;
    if (!isAndroidNative) return;

    setFcmLoading(true);
    try {
      const token = await initializeFcmToken({ force, requestPermission: true });
      if (!token) {
        presentToast({
          message: "Notification permission not granted",
          color: "warning",
          duration: 1600,
        });
        return;
      }
      if (!currentPhoneId) {
        presentToast({
          message: "Select Current Phone first in Settings -> Phones",
          color: "warning",
          duration: 1800,
        });
        return;
      }
      if (!tokenLocationId) {
        presentToast({
          message: "Select alert location first",
          color: "warning",
          duration: 1600,
        });
        return;
      }

      setFcmAlertLocationIdToStorage(tokenLocationId);
      setFcmToken(token);

      await registerFcmToken({
        token,
        phoneId: currentPhoneId,
        shopLocationId: tokenLocationId,
        active: true,
      });

      if (showSuccessToast) {
        presentToast({ message: "FCM token synced", color: "success", duration: 1400 });
      }
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to sync FCM token",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setFcmLoading(false);
    }
  }

  async function onCopyFcmToken() {
    if (!fcmToken) {
      presentToast({ message: "FCM token not available", color: "warning", duration: 1400 });
      return;
    }
    if (!navigator.clipboard?.writeText) {
      presentToast({ message: "Clipboard is not available", color: "warning", duration: 1600 });
      return;
    }

    try {
      await navigator.clipboard.writeText(fcmToken);
      presentToast({ message: "FCM token copied", color: "success", duration: 1300 });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to copy token",
        color: "danger",
        duration: 1800,
      });
    }
  }

  function onClearCachedFcmToken() {
    clearStoredFcmToken();
    setFcmToken(null);
    presentToast({ message: "Cached token cleared", color: "medium", duration: 1200 });
  }

  return (
    <IonPage>
      <AppTopBar title="FCM" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Firebase Cloud Messaging</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Current Phone</IonLabel>
              <IonTextarea
                className="settings-token-textarea"
                value={selectedPhone ? `${selectedPhone.id} - ${selectedPhone.name}` : ""}
                readonly
                autoGrow
                placeholder="Select Current Phone in Settings -> Phones"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Notification Location</IonLabel>
              <IonTextarea
                className="settings-token-textarea"
                value={selectedLocation ? `${selectedLocation.locationName} (${selectedLocation.locationCode})` : ""}
                readonly
                autoGrow
                placeholder="Set notification location in Settings -> Shop Info"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">FCM Token</IonLabel>
              <IonTextarea
                className="settings-token-textarea"
                value={fcmToken ?? ""}
                readonly
                autoGrow
                placeholder="Token auto-generates after notification permission is granted"
              />
            </IonItem>
            <IonNote color="medium">
              {isAndroidNative
                ? "This token belongs to this app install on this device. The server currently maps one token to one alert location at a time."
                : "Run this page inside Android app (Capacitor) to generate and sync token."}
            </IonNote>
            <IonNote color="medium">
              Current mapping: {selectedPhone ? selectedPhone.name : "No phone selected"} {"->"}{" "}
              {selectedLocation ? `${selectedLocation.locationName} (${selectedLocation.locationCode})` : "No alert location selected"}
            </IonNote>
            <div className="settings-actions settings-actions-inline">
              <IonButton onClick={() => void syncFcmToken({ force: true, showSuccessToast: true })} disabled={fcmLoading}>
                {fcmLoading ? "Please wait..." : "Re-sync Token"}
              </IonButton>
              <IonButton fill="outline" routerLink="/settings/shop-info">
                Open Shop Info
              </IonButton>
            </div>
            <div className="settings-actions settings-actions-inline">
              <IonButton fill="outline" onClick={onCopyFcmToken} disabled={!fcmToken}>
                Copy Token
              </IonButton>
              <IonButton fill="outline" color="medium" onClick={onClearCachedFcmToken} disabled={!fcmToken}>
                Clear Cached
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
