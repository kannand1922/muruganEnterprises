import React from 'react';
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
  IonList,
  IonItem,
  IonLabel,
  IonRadioGroup,
  IonRadio,
  IonNote,
} from '@ionic/react';
import { closeOutline, printOutline } from 'ionicons/icons';
import { EnhancedScannedBarcode, SelectedAddOn, Printer } from './barcodeScannerTypes';

interface PrintModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  scannedBarcodes: EnhancedScannedBarcode[];
  selectedAddOns: SelectedAddOn[];
  printers: Printer[];
  selectedPrinter: string;
  onSelectedPrinterChange: (printer: string) => void;
  onExecutePrint: () => void;
  isPrinting: boolean;
  stats: {
    matched: number;
    unmatched: number;
    totalQuantity: number;
    totalValue: number;
    addOnsTotal: number;
  };
}

const PrintModal: React.FC<PrintModalProps> = ({
  isOpen,
  onDismiss,
  scannedBarcodes,
  selectedAddOns,
  printers,
  selectedPrinter,
  onSelectedPrinterChange,
  onExecutePrint,
  isPrinting,
  stats,
}) => {
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Print Receipt</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Print Summary</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <p>
              <strong>Scanned Items:</strong> {scannedBarcodes.length} (
              {stats.matched} matched, {stats.unmatched} unmatched)
            </p>
            <p>
              <strong>Add-on Items:</strong>{" "}
              {selectedAddOns.filter((addOn) => addOn.quantity > 0).length} (₹
              {stats.addOnsTotal.toFixed(2)})
            </p>
            <p>
              <strong>Total Quantity:</strong> {stats.totalQuantity} items
            </p>
            <p>
              <strong>Total Value:</strong> ₹{stats.totalValue.toFixed(2)}
            </p>
            <p>
              <strong>Generated:</strong> {new Date().toLocaleString()}
            </p>

            {stats.unmatched > 0 && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "8px",
                  backgroundColor: "#fff3cd",
                  borderRadius: "4px",
                }}
              >
                <IonNote color="warning">
                  {stats.unmatched} items have no product match (₹0 value each)
                </IonNote>
              </div>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Available Printers</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonRadioGroup
              value={selectedPrinter}
              onIonChange={(e) => onSelectedPrinterChange(e.detail.value)}
            >
              {printers.map((printer, index) => (
                <IonItem
                  key={index}
                  button
                  onClick={() => onSelectedPrinterChange(printer["IP"])}
                >
                  <IonLabel>
                    <h3>{printer["PRINTER NAME"]}</h3>
                    <p>IP: {printer["IP"]}</p>
                  </IonLabel>
                  <IonRadio slot="start" value={printer["IP"]} />
                </IonItem>
              ))}
            </IonRadioGroup>
          </IonCardContent>
        </IonCard>

        <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
          <IonButton expand="block" fill="outline" onClick={onDismiss}>
            Cancel
          </IonButton>
          <IonButton
            expand="block"
            fill="solid"
            onClick={onExecutePrint}
            disabled={!selectedPrinter || isPrinting}
            color="success"
          >
            <IonIcon icon={printOutline} slot="start" />
            {isPrinting
              ? "Printing..."
              : `Print Receipt (₹${stats.totalValue.toFixed(2)})`}
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default PrintModal;
