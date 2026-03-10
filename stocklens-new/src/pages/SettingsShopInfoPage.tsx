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
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonText,
  IonToggle,
  useIonToast,
} from "@ionic/react";
import { Capacitor } from "@capacitor/core";
import { useEffect, useMemo, useState } from "react";
import { AppTopBar } from "../components/common/AppTopBar";
import {
  createOrUpdateShopInfo,
  getShopInfo,
  getShopLocations,
  registerFcmToken,
  type ShopInfo,
  type ShopLocation,
} from "../api/metaApi";
import { getFcmAlertLocationIdFromStorage, setFcmAlertLocationIdToStorage } from "../config/fcm";
import { getCurrentPhoneIdFromStorage } from "../config/phone";
import { getStoredFcmToken } from "../services/fcm";

const EMPTY_FORM: ShopInfo = {
  shopCode: "",
  shopName: "",
  areaName: "",
  city: "",
  state: "",
  pincode: "",
  addressLine1: "",
  addressLine2: "",
  nilLocation: null,
  active: true,
};

export function SettingsShopInfoPage() {
  const [presentToast] = useIonToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState<ShopLocation[]>([]);
  const [form, setForm] = useState<ShopInfo>(EMPTY_FORM);
  const [current, setCurrent] = useState<ShopInfo | null>(null);
  const [notificationLocationId, setNotificationLocationId] = useState<number | null>(null);

  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => (a.sortOrder === b.sortOrder ? a.id - b.id : a.sortOrder - b.sortOrder)),
    [locations]
  );

  async function loadData() {
    setLoading(true);
    try {
      const [shop, locationsData] = await Promise.all([getShopInfo(), getShopLocations()]);
      setCurrent(shop);
      setLocations(locationsData);
      const storedNotificationLocationId = getFcmAlertLocationIdFromStorage();
      const validNotificationLocationId =
        storedNotificationLocationId && locationsData.some((row) => row.id === storedNotificationLocationId)
          ? storedNotificationLocationId
          : (locationsData[0]?.id ?? null);
      setNotificationLocationId(validNotificationLocationId);
      setForm(
        shop
          ? {
              ...shop,
              areaName: shop.areaName || "",
              city: shop.city || "",
              state: shop.state || "",
              pincode: shop.pincode || "",
              addressLine1: shop.addressLine1 || "",
              addressLine2: shop.addressLine2 || "",
            }
          : EMPTY_FORM
      );
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to load shop info",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function updateNotificationLocation(nextId: number | null) {
    setNotificationLocationId(nextId);
    if (!nextId) return;

    setFcmAlertLocationIdToStorage(nextId);

    const token = getStoredFcmToken();
    const currentPhoneId = getCurrentPhoneIdFromStorage();
    if (!token || !currentPhoneId || !Capacitor.isNativePlatform()) {
      return;
    }

    try {
      await registerFcmToken({
        token,
        phoneId: currentPhoneId,
        shopLocationId: nextId,
        active: true,
      });
      presentToast({ message: "Notification location updated", color: "success", duration: 1400 });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to update notification location",
        color: "danger",
        duration: 1800,
      });
    }
  }

  async function onSave() {
    if (!form.shopCode?.trim() || !form.shopName?.trim()) {
      presentToast({ message: "Shop code and shop name are required", color: "warning", duration: 1500 });
      return;
    }

    setSaving(true);
    try {
      const saved = await createOrUpdateShopInfo({
        ...form,
        shopCode: form.shopCode.trim(),
        shopName: form.shopName.trim(),
        active: current ? form.active : true,
      });
      setCurrent(saved);
      setForm({
        ...saved,
        areaName: saved.areaName || "",
        city: saved.city || "",
        state: saved.state || "",
        pincode: saved.pincode || "",
        addressLine1: saved.addressLine1 || "",
        addressLine2: saved.addressLine2 || "",
      });
      presentToast({ message: "Shop info saved", color: "success", duration: 1400 });
    } catch (error) {
      presentToast({
        message: error instanceof Error ? error.message : "Failed to save shop info",
        color: "danger",
        duration: 1800,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <IonPage>
      <AppTopBar title="Shop Info" showBack showSettings={false} showLocationSwitcher={false} backPath="/settings" />
      <IonContent fullscreen className="settings-page-content ion-padding">
        {loading ? <IonNote>Loading...</IonNote> : null}

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Current Shop</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {current ? (
              <div className="settings-list-item">
                <div>
                  <strong>{current.shopName}</strong>
                  <p>
                    Code: {current.shopCode} | Area: {current.areaName || "-"} | City: {current.city || "-"}
                  </p>
                </div>
                <IonBadge color={current.active ? "success" : "medium"}>
                  {current.active ? "Active" : "Inactive"}
                </IonBadge>
              </div>
            ) : (
              <IonText color="medium">No shop info saved yet.</IonText>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>{current ? "Edit Shop Info" : "Create Shop Info"}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem>
              <IonLabel position="stacked">Shop Code</IonLabel>
              <IonInput
                value={form.shopCode}
                disabled={Boolean(current)}
                onIonInput={(e) => setForm((s) => ({ ...s, shopCode: e.detail.value || "" }))}
              />
            </IonItem>
            {current ? (
              <IonNote color="medium">
                Only one shop is allowed. Shop code is locked after first setup.
              </IonNote>
            ) : null}
            <IonItem>
              <IonLabel position="stacked">Shop Name</IonLabel>
              <IonInput
                value={form.shopName}
                onIonInput={(e) => setForm((s) => ({ ...s, shopName: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Area</IonLabel>
              <IonInput
                value={form.areaName || ""}
                onIonInput={(e) => setForm((s) => ({ ...s, areaName: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">City</IonLabel>
              <IonInput
                value={form.city || ""}
                onIonInput={(e) => setForm((s) => ({ ...s, city: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">State</IonLabel>
              <IonInput
                value={form.state || ""}
                onIonInput={(e) => setForm((s) => ({ ...s, state: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Pincode</IonLabel>
              <IonInput
                value={form.pincode || ""}
                onIonInput={(e) => setForm((s) => ({ ...s, pincode: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Address Line 1</IonLabel>
              <IonInput
                value={form.addressLine1 || ""}
                onIonInput={(e) => setForm((s) => ({ ...s, addressLine1: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Address Line 2</IonLabel>
              <IonInput
                value={form.addressLine2 || ""}
                onIonInput={(e) => setForm((s) => ({ ...s, addressLine2: e.detail.value || "" }))}
              />
            </IonItem>
            <IonItem>
              <IonLabel>NIL Source Location</IonLabel>
              <IonSelect
                value={form.nilLocation ?? undefined}
                onIonChange={(e) =>
                  setForm((s) => ({ ...s, nilLocation: e.detail.value ? Number(e.detail.value) : null }))
                }
                placeholder="Select"
              >
                {sortedLocations.map((location) => (
                  <IonSelectOption key={location.id} value={location.id}>
                    {location.locationName} ({location.locationCode})
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonNote color="medium">
              This is the source location for the NIL page. The NIL page compares this source against a selected
              target location.
            </IonNote>
            <IonItem>
              <IonLabel>Notification Location</IonLabel>
              <IonSelect
                value={notificationLocationId ?? undefined}
                onIonChange={(e) => {
                  const nextId = e.detail.value ? Number(e.detail.value) : null;
                  void updateNotificationLocation(
                    nextId && Number.isFinite(nextId) && nextId > 0 ? Math.trunc(nextId) : null
                  );
                }}
                placeholder="Select"
              >
                {sortedLocations.map((location) => (
                  <IonSelectOption key={location.id} value={location.id}>
                    {location.locationName} ({location.locationCode})
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonNote color="medium">
              This decides which shop location the current device token receives low stock notifications for.
            </IonNote>
            {current ? (
              <IonItem lines="none">
                <IonLabel>Active</IonLabel>
                <IonToggle
                  checked={Boolean(form.active)}
                  onIonChange={(e) => setForm((s) => ({ ...s, active: e.detail.checked }))}
                />
              </IonItem>
            ) : (
              <IonNote color="medium">Active is auto-prefilled as ON while creating shop info.</IonNote>
            )}

            <div className="settings-actions settings-actions-inline">
              <IonButton onClick={onSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
