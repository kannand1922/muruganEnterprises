import { IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonText } from "@ionic/react";
import type { HighStockOverview } from "../../api/metaApi";

type HighStockOverviewCardProps = {
  overview: HighStockOverview | null;
  selectedLocationId: number | null;
  selectedLocationName?: string | null;
  selectedLocationHighCount?: number | null;
  onSelectLocation: (shopLocationId: number) => void;
};

export function HighStockOverviewCard({
  overview,
  selectedLocationId,
  selectedLocationName,
  selectedLocationHighCount,
  onSelectLocation,
}: HighStockOverviewCardProps) {
  return (
    <IonCard className="settings-config-card low-stock-overview-card">
      <IonCardHeader>
        <IonCardTitle>Overview</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <div className="low-stock-kpi-grid">
          <div className="low-stock-kpi">
            <span className="low-stock-kpi-label">
              {selectedLocationName ? `${selectedLocationName} High Products` : "High Products"}
            </span>
            <strong className="low-stock-kpi-value">{selectedLocationHighCount ?? 0}</strong>
          </div>
        </div>

        <div className="low-stock-location-pills">
          {(overview?.rows || []).length === 0 ? (
            <IonText color="medium">No locations available.</IonText>
          ) : (
            (overview?.rows || []).map((row) => (
              <button
                key={row.shopLocationId}
                type="button"
                className={`low-stock-location-pill ${selectedLocationId === row.shopLocationId ? "active" : ""}`}
                onClick={() => onSelectLocation(row.shopLocationId)}
              >
                <span className="low-stock-location-pill-name">{row.locationName}</span>
                <span className="low-stock-location-pill-count">{row.highCount}</span>
              </button>
            ))
          )}
        </div>
      </IonCardContent>
    </IonCard>
  );
}
