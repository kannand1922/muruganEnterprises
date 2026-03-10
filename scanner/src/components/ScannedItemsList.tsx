import React from 'react';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonIcon,
  IonCheckbox,
} from '@ionic/react';
import { removeOutline, addOutline, trashOutline } from 'ionicons/icons';
import { EnhancedScannedBarcode } from './barcodeScannerTypes';

interface ScannedItemsListProps {
  scannedBarcodes: EnhancedScannedBarcode[];
  isScanning: boolean;
  onIncrementQuantity: (id: string) => void;
  onDecrementQuantity: (id: string) => void;
  onOpenQuantityPopover: (id: string) => void;
  onRemoveBarcode: (id: string) => void;
  onClearAllBarcodes: () => void;
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
}

const ScannedItemsList: React.FC<ScannedItemsListProps> = ({
  scannedBarcodes,
  isScanning,
  onIncrementQuantity,
  onDecrementQuantity,
  onOpenQuantityPopover,
  onRemoveBarcode,
  onClearAllBarcodes,
  selectedIds,
  onToggleSelected,
}) => {
  if (scannedBarcodes.length === 0) return null;

  return (
    <IonCard
      className={`items-card scanned-items-card ${
        isScanning ? "scanning-mode" : ""
      }`}
    >
      <IonCardHeader className="scanned-items-header">
        <IonCardTitle className="scanned-items-header-row">
        <div style={{fontSize:"15px"}}>Scanned Items</div>
          <IonButton
            className="scanned-items-clear-btn"
            fill="clear"
            // size="small"
            color="danger"
            onClick={onClearAllBarcodes}
          >
            <IonIcon icon={trashOutline} slot="start" />
            Clear All
          </IonButton>
        </IonCardTitle>
      </IonCardHeader>
      <IonCardContent className="scanned-items-content">
        <IonList className="scanned-items-list" lines="none">
          {scannedBarcodes.map((barcode, index) => {
            const isSelected = selectedIds.includes(barcode.id);
            const isInQueue = index < 12;

            return (
            <React.Fragment key={barcode.id}>
              <IonItem className="scanned-item" lines="none">
                <IonCheckbox
                  slot="start"
                  checked={isSelected}
                  disabled={!isInQueue}
                  onIonChange={() => onToggleSelected(barcode.id)}
                />
                <IonLabel className="scanned-item-label">
                  <div className="scanned-item-row primary">
                    <div className="scanned-item-title">
                      {barcode.isMatched
                        ? `${barcode.brandName} - ${barcode.pack}`
                        : barcode.value}
                    </div>
                    <div className="scanned-item-price">
                      ₹
                      {barcode.isMatched
                        ? ((barcode.mrp ?? 0) * barcode.quantity).toFixed(2)
                        : "0.00"}
                    </div>
                  </div>

                  <div className="scanned-item-row secondary">
                    <div className="scanned-item-quantity">
                      <IonButton
                        className="scanned-item-quantity-btn"
                        fill="clear"
                        // size="small"
                        onClick={() => onDecrementQuantity(barcode.id)}
                        disabled={barcode.quantity <= 1}
                      >
                        <IonIcon icon={removeOutline} />
                      </IonButton>

                      <IonButton
                        className="scanned-item-quantity-value"
                        fill="clear"
                        // size="small"
                        onClick={() => onOpenQuantityPopover(barcode.id)}
                      >
                        {barcode.quantity}
                      </IonButton>

                      <IonButton
                        className="scanned-item-quantity-btn"
                        fill="clear"
                        // size="small"
                        onClick={() => onIncrementQuantity(barcode.id)}
                      >
                        <IonIcon icon={addOutline} />
                      </IonButton>
                    </div>

                    <IonButton
                      className="scanned-item-quantity-btn"
                      fill="clear"
                      size="small"
                      color="danger"
                      onClick={() => onRemoveBarcode(barcode.id)}
                    >
                      <IonIcon icon={trashOutline} />
                    </IonButton>
                  </div>
                </IonLabel>
              </IonItem>

            </React.Fragment>
          );
          })}
        </IonList>
      </IonCardContent>
    </IonCard>
  );
};

export default ScannedItemsList;
