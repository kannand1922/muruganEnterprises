import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Haptics } from "@capacitor/haptics";
import { ScannedBarcode, QRData } from "./barcodeScannerTypes";

const SCAN_FEEDBACK_DURATION_MS = 80;

const triggerScanVibration = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.vibrate({ duration: SCAN_FEEDBACK_DURATION_MS }).catch((error) =>
      console.warn("Could not trigger haptic feedback:", error)
    );
  } else if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(SCAN_FEEDBACK_DURATION_MS);
  }
};

export const playBeepSound = () => {
  triggerScanVibration();
  try {
    // Create AudioContext if it doesn't exist
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();

    // Create oscillator for beep sound
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Connect oscillator to gain node to destination
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Set beep sound parameters
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // 800Hz frequency
    oscillator.type = "square"; // Square wave for classic beep sound

    // Set volume (0 to 1)
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.1
    );

    // Play beep for 100ms
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (error) {
    console.warn("Could not play beep sound:", error);

    // Fallback: try to create a simple beep using Data URI
    try {
      const audio = new Audio(
        "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmEeijmByn/MyoE2gqt0jMKnfXA+hCl/wlIwdECDjIWAwqiAh4MjbsKuggIGLnK4h"
      );
      audio.volume = 0.1;
      audio.play().catch(() => {
        // Silent fail if audio can't play
      });
    } catch (fallbackError) {
      console.warn("Fallback beep sound also failed:", fallbackError);
    }
  }
};

export const generateQRCode = (text: string, size: number = 200): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject("Canvas context not available");
        return;
      }

      canvas.width = size;
      canvas.height = size;
      const moduleSize = size / 25;
      const data = text;

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#000000";

      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash + data.charCodeAt(i)) & 0xffffffff;
      }

      for (let x = 0; x < 25; x++) {
        for (let y = 0; y < 25; y++) {
          const shouldFill = (hash + x * 31 + y * 17) % 3 === 0;
          if (
            shouldFill ||
            (x < 7 && y < 7) ||
            (x >= 18 && y < 7) ||
            (x < 7 && y >= 18)
          ) {
            ctx.fillRect(
              x * moduleSize,
              y * moduleSize,
              moduleSize,
              moduleSize
            );
          }
        }
      }

      const dataURL = canvas.toDataURL("image/png");
      resolve(dataURL);
    } catch (error) {
      reject(error);
    }
  });
};

export const generateQRWithAPI = async (data: string): Promise<string> => {
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&data=${encodeURIComponent(
      data
    )}`;
    const response = await fetch(qrUrl, { method: "HEAD" });
    if (response.ok) {
      return qrUrl;
    } else {
      throw new Error("QR API not accessible");
    }
  } catch (error) {
    console.warn("QR API failed, using fallback:", error);
    return await generateQRCode(data);
  }
};

export const getTotalQuantity = (scannedBarcodes: ScannedBarcode[]) => {
  return scannedBarcodes.reduce(
    (total, barcode) => total + barcode.quantity,
    0
  );
};

export const downloadQR = async (generatedQR: string, showToastMessage: (message: string) => void) => {
  if (!generatedQR) return;

  try {
    if (Capacitor.isNativePlatform()) {
      const fileName = `scanned-items-qr-${Date.now()}.png`;
      if (generatedQR.startsWith("data:")) {
        const base64Data = generatedQR.split(",")[1];
        await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Documents,
        });
        showToastMessage("QR code saved to Documents");
      } else {
        const response = await fetch(generatedQR);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents,
          });
          showToastMessage("QR code saved to Documents");
        };
        reader.readAsDataURL(blob);
      }
    } else {
      const link = document.createElement("a");
      link.href = generatedQR;
      link.download = `scanned-items-qr-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToastMessage("QR code downloaded");
    }
  } catch (error) {
    console.error("Download error:", error);
    showToastMessage("Error downloading QR code");
  }
};

export const shareQR = async (
  generatedQR: string, 
  scannedBarcodes: ScannedBarcode[], 
  showToastMessage: (message: string) => void
) => {
  if (!generatedQR || !Capacitor.isNativePlatform()) return;

  try {
    await Share.share({
      title: "Scanned Items QR Code",
      text: `QR code containing ${
        scannedBarcodes.length
      } scanned items with ${getTotalQuantity(scannedBarcodes)} total quantity`,
      url: generatedQR,
      dialogTitle: "Share QR Code",
    });
  } catch (error) {
    console.error("Share error:", error);
    showToastMessage("Error sharing QR code");
  }
};

export const createQRData = (scannedBarcodes: ScannedBarcode[]): QRData => {
  return {
    timestamp: new Date().toISOString(),
    count: scannedBarcodes.length,
    totalQuantity: getTotalQuantity(scannedBarcodes),
    barcodes: scannedBarcodes.map((barcode) => ({
      value: barcode.value,
      format: barcode.format,
      quantity: barcode.quantity,
      scanned_at: barcode.timestamp.toISOString(),
    })),
  };
};

export const DEFAULT_API_BASE_URL = "http://192.168.1.170:4000/api";
export const STORAGE_KEY = "api_base_url";

const sanitizeApiBaseUrl = (url: string): string => {
  const trimmed = String(url || "").trim();
  return trimmed || DEFAULT_API_BASE_URL;
};

export const getApiBaseUrl = (): string => {
  const stored = localStorage.getItem(STORAGE_KEY) || "";
  const sanitized = sanitizeApiBaseUrl(stored);
  if (!stored.trim()) {
    localStorage.setItem(STORAGE_KEY, sanitized);
  }
  return sanitized;
};

export const setApiBaseUrl = (url: string): void => {
  const sanitized = sanitizeApiBaseUrl(url);
  localStorage.setItem(STORAGE_KEY, sanitized);
};

export const allowedFormats = ["EAN_13", "EAN_8", "CODE_128"]; // allow only product barcodes
