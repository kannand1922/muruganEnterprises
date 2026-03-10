import React, { useRef, useEffect } from "react";
import {
  IonModal,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonInput,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
} from "@ionic/react";

interface AddOnQuantityModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  customQuantity: string;
  setCustomQuantity: (quantity: string) => void;
  onSave: () => void;
}

const AddOnQuantityModal: React.FC<AddOnQuantityModalProps> = ({
  isOpen,
  onDismiss,
  customQuantity,
  setCustomQuantity,
  onSave,
}) => {
  const inputRef = useRef<HTMLIonInputElement>(null);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      // Longer delay to ensure modal is fully rendered and visible
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setFocus();
          // Additional fallback for mobile devices
          const nativeInput = inputRef.current.querySelector('input');
          if (nativeInput) {
            nativeInput.focus();
            nativeInput.select(); // Also select existing text
          }
        }
      }, 300);
      
      return () => clearTimeout(timer);
    }
  }, [isOpen]);
  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={onDismiss}
      showBackdrop={true}
      backdropDismiss={false}
      animated={false}
      className="quantity-modal-container"
    >
      <IonContent className="quantity-modal-content">
        <div className="quantity-modal-wrapper">
          <IonCard className="quantity-modal-card">
            <IonCardHeader className="quantity-modal-header">
              <IonCardTitle className="quantity-modal-title">
                Set Add-On Quantity
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent className="quantity-modal-body">
              <IonInput
                ref={inputRef}
                value={customQuantity}
                placeholder="Enter quantity"
                type="number"
                min="0"
                onIonInput={(e) => setCustomQuantity(e.detail.value!)}
                fill="outline"
                className="quantity-modal-input"
              />
              <IonGrid className="quantity-modal-grid">
                <IonRow className="quantity-modal-row">
                  <IonCol className="quantity-modal-col">
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={onDismiss}
                      className="quantity-modal-cancel-btn"
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                  <IonCol className="quantity-modal-col">
                    <IonButton
                      expand="block"
                      fill="solid"
                      onClick={onSave}
                      color="primary"
                      className="quantity-modal-save-btn"
                    >
                      Save
                    </IonButton>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default AddOnQuantityModal;