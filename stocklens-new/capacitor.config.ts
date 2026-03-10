import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.stock.app",
  appName: "Stock",
  webDir: "dist",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
  plugins: {
    BarcodeScanner: {
      cameraDirection: "back",
      targetResolution: "HD",
      formats: [
        "QR_CODE",
        "CODE_128",
        "CODE_39",
        "EAN_13",
        "EAN_8",
        "UPC_A",
        "UPC_E",
      ],
    },
  },
};

export default config;
