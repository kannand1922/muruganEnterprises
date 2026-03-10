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

interface QuantityModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  customQuantity: string;
  setCustomQuantity: (quantity: string) => void;
  onSave: () => void;
  title?: string;
}

const QuantityModal: React.FC<QuantityModalProps> = ({
  isOpen,
  onDismiss,
  customQuantity,
  setCustomQuantity,
  onSave,
  title = "Set Quantity",
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
      className="main-quantity-modal-container"
    >
      <IonContent className="main-quantity-modal-content">
        <div className="main-quantity-modal-wrapper">
          <IonCard className="main-quantity-modal-card">
            <IonCardHeader className="main-quantity-modal-header">
              <IonCardTitle className="main-quantity-modal-title">
                {title}
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent className="main-quantity-modal-body">
              <IonInput
                ref={inputRef}
                value={customQuantity}
                placeholder="Enter quantity"
                type="number"
                min="0"
                onIonInput={(e) => setCustomQuantity(e.detail.value!)}
                fill="outline"
                className="main-quantity-modal-input"
              />
              <IonGrid className="main-quantity-modal-grid">
                <IonRow className="main-quantity-modal-row">
                  <IonCol className="main-quantity-modal-col">
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={onDismiss}
                      className="main-quantity-modal-cancel-btn"
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                  <IonCol className="main-quantity-modal-col">
                    <IonButton
                      expand="block"
                      fill="solid"
                      onClick={onSave}
                      color="primary"
                      className="main-quantity-modal-save-btn"
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

export default QuantityModal;