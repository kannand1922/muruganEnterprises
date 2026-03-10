import { BarcodeScanner, BarcodesScannedEvent } from "@capacitor-mlkit/barcode-scanning";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { 
  EnhancedScannedBarcode, 
  BrandItem, 
  AddOnItem, 
  SelectedAddOn,
  QuantityMode 
} from "./barcodeScannerTypes";
import { playBeepSound, getApiBaseUrl, DEFAULT_API_BASE_URL } from "./barcodeScannerUtils";

// Permission checking
export const checkPermissions = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    try {
      await BarcodeScanner.requestPermissions();
      return true;
    } catch (error) {
      console.error("Permission error:", error);
      return false;
    }
  }
  return true;
};

// Barcode processing
export const processBarcodeResult = (
  barcodeValue: string,
  format: string,
  brandItems: BrandItem[],
  scannedBarcodes: EnhancedScannedBarcode[],
  quantityMode: QuantityMode,
  setScannedBarcodes: React.Dispatch<React.SetStateAction<EnhancedScannedBarcode[]>>,
  setSelectedBarcodeId: React.Dispatch<React.SetStateAction<string>>,
  setCustomQuantity: React.Dispatch<React.SetStateAction<string>>,
  setShowQuantityPopover: React.Dispatch<React.SetStateAction<boolean>>,
  showToastMessage: (message: string) => void
): void => {
  const currentTime = Date.now();
  const timeWindow = Math.floor(currentTime / 1000);
  const barcodeKey = `${barcodeValue}_${timeWindow}`;

  // Find product by barcode
  const matchedProduct = brandItems.find((item) => item.BarCode === barcodeValue) || null;

  playBeepSound();

  setScannedBarcodes((prevBarcodes) => {
    const existingBarcode = prevBarcodes.find((item) => item.value === barcodeValue);

    if (existingBarcode) {
      // Handle duplicate based on mode
      if (quantityMode === "auto") {
        const updatedBarcodes = prevBarcodes.map((item) =>
          item.id === existingBarcode.id
            ? { ...item, quantity: item.quantity + 1, timestamp: new Date() }
            : item
        );

        const displayName = existingBarcode.isMatched
          ? `${existingBarcode.brandName} - ${existingBarcode.pack}`
          : `${existingBarcode.value}`;

        showToastMessage(`${displayName} - Quantity: ${existingBarcode.quantity + 1}`);
        return updatedBarcodes;
      } else if (quantityMode === "prompt") {
        setSelectedBarcodeId(existingBarcode.id);
        setCustomQuantity("1");
        setShowQuantityPopover(true);
        showToastMessage("Duplicate found");
        return prevBarcodes;
      } else {
        const updatedBarcodes = prevBarcodes.map((item) =>
          item.id === existingBarcode.id
            ? { ...item, quantity: item.quantity + 1, timestamp: new Date() }
            : item
        );

        const displayName = existingBarcode.isMatched
          ? `${existingBarcode.brandName} - ${existingBarcode.pack}`
          : `${existingBarcode.value}`;

        showToastMessage(`${displayName} - Added +1. Total: ${existingBarcode.quantity + 1}`);
        return updatedBarcodes;
      }
    } else {
      // Add new barcode
      let newBarcode: EnhancedScannedBarcode;

      if (matchedProduct) {
        newBarcode = {
          id: Date.now().toString() + Math.random(),
          value: barcodeValue,
          format: format || "Unknown",
          timestamp: new Date(),
          quantity: 1,
          productName: `${matchedProduct.Item}`,
          brandName: matchedProduct.Brand,
          pack: matchedProduct.Pack,
          mrp: parseFloat(matchedProduct.MRP),
          isMatched: true,
        };

        showToastMessage(`Scanned: ${newBarcode.productName}`);
      } else {
        newBarcode = {
          id: Date.now().toString() + Math.random(),
          value: barcodeValue,
          format: format || "Unknown",
          timestamp: new Date(),
          quantity: 1,
          productName: barcodeValue,
          brandName: undefined,
          pack: undefined,
          mrp: 0,
          isMatched: false,
        };

        showToastMessage(`Scanned: ${barcodeValue} (No match)`);
      }

      if (quantityMode === "prompt") {
        setSelectedBarcodeId(newBarcode.id);
        setCustomQuantity("1");
        setShowQuantityPopover(true);
      }

      return [...prevBarcodes, newBarcode];
    }
  });
};

// Add-on helpers
export const toggleAddOn = (
  item: AddOnItem,
  selectedAddOns: SelectedAddOn[],
  setSelectedAddOns: React.Dispatch<React.SetStateAction<SelectedAddOn[]>>
): void => {
  const existingIndex = selectedAddOns.findIndex(
    (addOn) => addOn.itemCode === item["ITEM CODE"]
  );

  if (existingIndex >= 0) {
    setSelectedAddOns((prev) => prev.filter((_, index) => index !== existingIndex));
  } else {
    const price = parseFloat(item["PRICE"] || "0");
    const newAddOn: SelectedAddOn = {
      itemCode: item["ITEM CODE"],
      product: item["PRODUCT"],
      price: price,
      quantity: 0,
      totalPrice: 0,
    };
    setSelectedAddOns((prev) => [...prev, newAddOn]);
  }
};

export const updateAddOnQuantity = (
  index: number,
  newQuantity: number,
  selectedAddOns: SelectedAddOn[],
  setSelectedAddOns: React.Dispatch<React.SetStateAction<SelectedAddOn[]>>
): void => {
  setSelectedAddOns((prev) => {
    const updated = [...prev];
    if (newQuantity === 0) {
      updated.splice(index, 1);
    } else {
      updated[index] = {
        ...updated[index],
        quantity: newQuantity,
        totalPrice: updated[index].price * newQuantity,
      };
    }
    return updated;
  });
};

// Statistics calculation
export const getStatistics = (
  scannedBarcodes: EnhancedScannedBarcode[],
  selectedAddOns: SelectedAddOn[]
) => {
  const matched = scannedBarcodes.filter((b) => b.isMatched).length;
  const unmatched = scannedBarcodes.length - matched;
  
  const barcodesQuantity = scannedBarcodes.reduce(
    (total, barcode) => total + barcode.quantity,
    0
  );

  const addOnsQuantity = selectedAddOns.reduce((total, addOn) => {
    return total + addOn.quantity;
  }, 0);

  const totalQuantity = barcodesQuantity + addOnsQuantity;

  const barcodesTotal = scannedBarcodes.reduce((total, barcode) => {
    if (barcode.isMatched && barcode.mrp) {
      return total + barcode.mrp * barcode.quantity;
    }
    return total;
  }, 0);

  const addOnsTotal = selectedAddOns.reduce((total, addOn) => {
    return total + addOn.totalPrice;
  }, 0);

  const totalValue = barcodesTotal + addOnsTotal;

  return { matched, unmatched, totalQuantity, totalValue, addOnsTotal };
};

// Back button handler
export const setupBackButtonHandler = async (
  handleBackButton: () => void,
  backButtonListenerRef: React.MutableRefObject<any>
): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    if (backButtonListenerRef.current) {
      backButtonListenerRef.current.remove();
    }

    backButtonListenerRef.current = await App.addListener("backButton", () => {
      handleBackButton();
    });
  }
};

// Cleanup back button handler
export const cleanupBackButtonHandler = (backButtonListenerRef: React.MutableRefObject<any>): void => {
  if (backButtonListenerRef.current) {
    backButtonListenerRef.current.remove();
  }
};