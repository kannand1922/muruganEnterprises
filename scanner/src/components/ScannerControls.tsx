import React from 'react';
import {
  IonCard,
  IonCardContent,
  IonGrid,
  IonRow,
  IonCol,
  IonFab,
  IonFabButton,
  IonIcon,
  IonButton,
} from '@ionic/react';
import { scanOutline, stopOutline, printOutline } from 'ionicons/icons';
import { EnhancedScannedBarcode, SelectedAddOn } from './barcodeScannerTypes';

interface ScannerControlsProps {
  scannedBarcodes: EnhancedScannedBarcode[];
  selectedAddOns: SelectedAddOn[];
  stats: {
    totalQuantity: number;
    totalValue: number;
  };
  isScanning?: boolean;
  onStartScanning?: () => void;
  onStopScanning?: () => void;
  onPrint?: () => void;
  isPrinting?: boolean;
  showScanButton?: boolean;
}

const ScannerControls: React.FC<ScannerControlsProps> = ({
  scannedBarcodes,
  selectedAddOns,
  stats,
  isScanning = false,
  onStartScanning,
  onStopScanning,
  onPrint,
  isPrinting = false,
  showScanButton = true,
}) => {
  const itemCount =
    scannedBarcodes.length +
    selectedAddOns.filter((addOn) => addOn.quantity > 0).length;

  return (
    <>
      {!isScanning && (
        <IonCard className="scanner-card">
          <IonCardContent className="scanner-card-content">
            <IonGrid>
              <IonRow className="ion-justify-content-between ion-text-center">
                <IonCol size="4" className="stat-item">
                  <div className="stat-number">{itemCount}</div>
                  <div className="stat-label">Items</div>
                </IonCol>

                <IonCol size="4" className="stat-item">
                  <div className="stat-number">{stats.totalQuantity}</div>
                  <div className="stat-label">Quantity</div>
                </IonCol>

                <IonCol size="4" className="stat-item">
                  <div className="stat-number">₹{stats.totalValue}</div>
                  <div className="stat-label">Value</div>
                </IonCol>
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>
      )}

      {/* Floating Action Button for Scan */}
      {showScanButton && (
        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton
            color={isScanning ? 'danger' : 'primary'}
            onClick={isScanning ? onStopScanning : onStartScanning}
          >
            <IonIcon icon={isScanning ? stopOutline : scanOutline} />
          </IonFabButton>
        </IonFab>
      )}

      {/* Bottom action button - Print */}
      <div className="action-buttons">
        <IonGrid>
          <IonRow className="ion-justify-content-center">
            <IonCol size="12">
              <IonButton
                expand="block"
                fill="solid"
                color="secondary"
                onClick={onPrint}
                disabled={
                  (scannedBarcodes.length === 0 &&
                    selectedAddOns.every((addOn) => addOn.quantity === 0)) ||
                  isPrinting
                }
                className="action-btn"
              >
                <IonIcon icon={printOutline} slot="start" />
                {isPrinting
                  ? 'Printing...'
                  : `Print All Items (₹${stats.totalValue.toFixed(2)})`}
              </IonButton>
            </IonCol>
          </IonRow>
        </IonGrid>
      </div>
    </>
  );
};

export default ScannerControls;
