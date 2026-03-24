import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonIcon,
  IonPage,
} from "@ionic/react";
import {
  businessOutline,
  locationOutline,
  notificationsOutline,
  peopleOutline,
  phonePortraitOutline,
  printOutline,
  layersOutline,
  settingsOutline,
  swapHorizontalOutline,
  starOutline,
} from "ionicons/icons";
import { AppTopBar } from "../components/common/AppTopBar";

const settingItems = [
  {
    title: "Shop Info",
    subtitle: "Basic shop details and nil location",
    icon: businessOutline,
    path: "/settings/shop-info",
  },
  {
    title: "Shop Locations",
    subtitle: "Create, edit and delete custom locations",
    icon: locationOutline,
    path: "/settings/shop-locations",
  },
  {
    title: "Operators",
    subtitle: "Manage operator names",
    icon: peopleOutline,
    path: "/settings/operators",
  },
  {
    title: "Phones",
    subtitle: "Manage phone names and select current phone",
    icon: phonePortraitOutline,
    path: "/settings/phones",
  },
  {
    title: "Best Selling",
    subtitle: "Select products from brands.csv",
    icon: starOutline,
    path: "/settings/best-selling",
  },
  {
    title: "Notification",
    subtitle: "Threshold rules, FCM mapping and push alerts",
    icon: notificationsOutline,
    path: "/settings/low-stock-alerts",
  },
  {
    title: "Printers",
    subtitle: "Add, edit and delete printers",
    icon: printOutline,
    path: "/settings/printers",
  },
  {
    title: "Difference",
    subtitle: "Review and manage diff batches",
    icon: swapHorizontalOutline,
    path: "/settings/difference",
  },
  {
    title: "DB Viewer",
    subtitle: "Inspect stock tables cycle-wise with filters and row clearing",
    icon: layersOutline,
    path: "/settings/db-viewer",
  },
  {
    title: "Common Configuration",
    subtitle: "Endpoint and phone name (local storage)",
    icon: settingsOutline,
    path: "/settings/common-config",
  },
];

export function SettingsPage() {
  return (
    <IonPage>
      <AppTopBar title="Settings" showBack showSettings={false} showLocationSwitcher={false} />
      <IonContent fullscreen className="settings-page-content ion-padding">
        <IonCard className="settings-config-card">
          <IonCardHeader>
            <IonCardTitle>Configuration</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <div className="settings-menu-grid">
              {settingItems.map((item) => (
                <IonButton
                  key={item.title}
                  routerLink={item.path}
                  expand="block"
                  fill="clear"
                  className="settings-menu-button"
                >
                  <div className="settings-menu-content">
                    <div className="settings-menu-icon-wrap">
                      <IonIcon icon={item.icon} />
                    </div>
                    <div className="settings-menu-text">
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                    </div>
                  </div>
                </IonButton>
              ))}
            </div>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
