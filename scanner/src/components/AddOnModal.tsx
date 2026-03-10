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
  IonCheckbox,
  IonNote,
} from '@ionic/react';
import { closeOutline, bagOutline, removeOutline, addOutline } from 'ionicons/icons';
import { AddOnItem, SelectedAddOn } from './barcodeScannerTypes';

interface AddOnModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  addOnItems: AddOnItem[];
  selectedAddOns: SelectedAddOn[];
  onToggleAddOn: (item: AddOnItem) => void;
  onIncrementAddOnQuantity: (index: number) => void;
  onDecrementAddOnQuantity: (index: number) => void;
  onOpenAddOnQuantityPopover: (index: number) => void;
  onProceedToPrinterSelection: () => void;
  getAddOnsTotal: () => number;
}

const AddOnModal: React.FC<AddOnModalProps> = ({
  isOpen,
  onDismiss,
  addOnItems,
  selectedAddOns,
  onToggleAddOn,
  onIncrementAddOnQuantity,
  onDecrementAddOnQuantity,
  onOpenAddOnQuantityPopover,
  onProceedToPrinterSelection,
  getAddOnsTotal,
}) => {
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Manage Add-Ons</IonTitle>
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
            <IonCardTitle>
              <IonIcon icon={bagOutline} style={{ marginRight: "8px" }} />
              Additional Items (Bags, etc.)
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonNote>Select and set quantities for additional items:</IonNote>
            <IonList>
              {addOnItems.map((item, index) => {
                const selectedAddOn = selectedAddOns.find(
                  (addOn) => addOn.itemCode === item["ITEM CODE"]
                );
                const isSelected = !!selectedAddOn;
                const quantity = selectedAddOn?.quantity || 0;
                const addOnIndex = selectedAddOns.findIndex(
                  (addOn) => addOn.itemCode === item["ITEM CODE"]
                );

                return (
                  <IonItem key={index}>
                    <IonCheckbox
                      slot="start"
                      checked={isSelected}
                      onIonChange={() => onToggleAddOn(item)}
                    />
                    <IonLabel onClick={() => onToggleAddOn(item)}>
                      <h3>{item["PRODUCT"]}</h3>
                      <p>
                        Code: {item["ITEM CODE"]} | Price: ₹
                        {parseFloat(item["PRICE"] || "0").toFixed(2)}
                      </p>
                      {isSelected && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginTop: "8px",
                          }}
                        >
                          <IonButton
                            fill="clear"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (addOnIndex >= 0) {
                                onDecrementAddOnQuantity(addOnIndex);
                              }
                            }}
                            disabled={quantity <= 0}
                          >
                            <IonIcon icon={removeOutline} />
                          </IonButton>

                          <IonButton
                            fill="clear"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (addOnIndex >= 0) {
                                onOpenAddOnQuantityPopover(addOnIndex);
                              }
                            }}
                            style={{ fontWeight: "bold", minWidth: "40px" }}
                          >
                            {quantity}
                          </IonButton>

                          <IonButton
                            fill="clear"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (addOnIndex >= 0) {
                                onIncrementAddOnQuantity(addOnIndex);
                              }
                            }}
                          >
                            <IonIcon icon={addOutline} />
                          </IonButton>

                          <div
                            style={{
                              fontSize: "14px",
                              color: "#2dd36f",
                              fontWeight: "bold",
                              marginLeft: "8px",
                            }}
                          >
                            Total: ₹
                            {(quantity * parseFloat(item["PRICE"] || "0")).toFixed(2)}
                          </div>
                        </div>
                      )}
                    </IonLabel>
                  </IonItem>
                );
              })}
            </IonList>

            {selectedAddOns.some((addOn) => addOn.quantity > 0) && (
              <div style={{ marginTop: "16px" }}>
                <IonNote color="primary">
                  Selected Add-ons Total: ₹{getAddOnsTotal().toFixed(2)}
                </IonNote>
              </div>
            )}
          </IonCardContent>
        </IonCard>

        <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
          <IonButton expand="block" fill="outline" onClick={onProceedToPrinterSelection}>
            Skip Add-Ons
          </IonButton>
          <IonButton expand="block" fill="solid" onClick={onProceedToPrinterSelection}>
            Continue (
            {selectedAddOns.filter((addOn) => addOn.quantity > 0).length} items, ₹
            {getAddOnsTotal().toFixed(2)})
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default AddOnModal;