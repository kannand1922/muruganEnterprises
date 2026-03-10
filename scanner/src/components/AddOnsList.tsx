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
  IonChip,
  IonGrid,
  IonRow,
  IonCol,
} from '@ionic/react';
import { removeOutline, addOutline, trashOutline } from 'ionicons/icons';
import { SelectedAddOn } from './barcodeScannerTypes';

interface AddOnsListProps {
  selectedAddOns: SelectedAddOn[];
  isScanning: boolean;
  onIncrementAddOnQuantity: (index: number) => void;
  onDecrementAddOnQuantity: (index: number) => void;
  onOpenAddOnQuantityPopover: (index: number) => void;
  onRemoveAddOn: (index: number) => void;
}

const AddOnsList: React.FC<AddOnsListProps> = ({
  selectedAddOns,
  isScanning,
  onIncrementAddOnQuantity,
  onDecrementAddOnQuantity,
  onOpenAddOnQuantityPopover,
  onRemoveAddOn,
}) => {
  const filteredAddOns = selectedAddOns.filter((addOn) => addOn.quantity > 0);
  const addOnsTotal = filteredAddOns.reduce((total, addOn) => total + addOn.totalPrice, 0);

  if (filteredAddOns.length === 0) return null;

  return (
    <IonCard className={`items-card ${isScanning ? "scanning-mode" : ""}`}>
      <IonCardHeader>
        <IonCardTitle>
          <IonGrid>
            <IonRow className="ion-align-items-center">
              <IonCol size="8">
                <h3 style={{ margin: 0 }}>Add-on Items</h3>
              </IonCol>
              <IonCol size="4" className="ion-text-right">
                <IonChip color="secondary">
                  ₹{addOnsTotal.toFixed(2)}
                </IonChip>
              </IonCol>
            </IonRow>
          </IonGrid>
        </IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <IonList lines="none">
          {filteredAddOns.map((addOn, index) => (
            <div key={addOn.itemCode}>
              <IonItem>
                <IonLabel>
                  {/* First Line: Product name and price */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "3px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: "800",
                        color: "#666",
                      }}
                    >
                      {addOn.product}
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: "bold",
                        color: "#ff6b35",
                      }}
                    >
                      ₹{addOn.totalPrice.toFixed(2)}
                    </div>
                  </div>

                  {/* Second Line: Price per unit and quantity controls */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontSize: "14px", color: "#888" }}>
                      ₹{addOn.price} each
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <IonButton
                        fill="clear"
                        size="default"
                        onClick={() => onDecrementAddOnQuantity(index)}
                        disabled={addOn.quantity <= 1}
                        style={{
                          height: "60px",
                          width: "60px",
                          fontSize: "22px",
                        }}
                      >
                        <IonIcon
                          icon={removeOutline}
                          style={{ fontSize: "28px" }}
                        />
                      </IonButton>

                      <IonButton
                        fill="clear"
                        size="small"
                        onClick={() => onOpenAddOnQuantityPopover(index)}
                        style={{
                          height: "40px",
                          minWidth: "50px",
                          fontSize: "16px",
                          fontWeight: "bold",
                        }}
                      >
                        {addOn.quantity}
                      </IonButton>

                      <IonButton
                        fill="clear"
                        size="default"
                        onClick={() => onIncrementAddOnQuantity(index)}
                        style={{
                          height: "60px",
                          width: "60px",
                          fontSize: "22px",
                        }}
                      >
                        <IonIcon
                          icon={addOutline}
                          style={{ fontSize: "28px" }}
                        />
                      </IonButton>

                      <IonButton
                        fill="clear"
                        size="default"
                        color="danger"
                        onClick={() => onRemoveAddOn(index)}
                        style={{
                          height: "60px",
                          width: "60px",
                          fontSize: "22px",
                        }}
                      >
                        <IonIcon
                          icon={trashOutline}
                          style={{ fontSize: "28px" }}
                        />
                      </IonButton>
                    </div>
                  </div>
                </IonLabel>
              </IonItem>
              {/* Divider between items - except for last item */}
              {index < filteredAddOns.length - 1 && (
                <hr
                  style={{
                    margin: "0 4px",
                    border: "none",
                    borderTop: "1px solid #e0e0e0",
                  }}
                />
              )}
            </div>
          ))}
        </IonList>
      </IonCardContent>
    </IonCard>
  );
};

export default AddOnsList;