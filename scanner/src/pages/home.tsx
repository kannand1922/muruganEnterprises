import React, { useEffect } from "react";
import BarcodeScannerPage from "./BarcodeScanner";
import { ScreenOrientation } from "@capacitor/screen-orientation"; // Add this import
import { Capacitor } from "@capacitor/core";

function Home() {
  useEffect(() => {
    const lockOrientation = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          await ScreenOrientation.lock({ orientation: "portrait" });
        } catch (error) {
          console.error("Error locking screen orientation:", error);
        }
      }
    };

    lockOrientation();

    return () => {
      if (Capacitor.isNativePlatform()) {
        ScreenOrientation.unlock().catch(console.error);
      }
    };
  }, []);
  return <BarcodeScannerPage />;
}

export default Home;
