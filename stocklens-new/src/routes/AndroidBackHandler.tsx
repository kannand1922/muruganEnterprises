import { useEffect, useRef } from "react";
import { useIonToast } from "@ionic/react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { useHistory } from "react-router-dom";

const EXIT_CONFIRMATION_WINDOW_MS = 1500;
const DASHBOARD_PATH = "/dashboard";
const OVERLAY_SELECTOR = "ion-action-sheet,ion-alert,ion-loading,ion-modal,ion-picker,ion-popover";

type OverlayElement = HTMLElement & {
  dismiss?: (data?: unknown, role?: string) => Promise<boolean>;
};

function toRouteKey(pathname: string, search = "", hash = "") {
  return `${pathname}${search}${hash}`;
}

async function dismissTopOverlay() {
  const overlays = Array.from(document.querySelectorAll<OverlayElement>(OVERLAY_SELECTOR)).filter(
    (overlay) => !overlay.classList.contains("overlay-hidden")
  );
  const topOverlay = overlays[overlays.length - 1];
  if (!topOverlay?.dismiss) return false;
  return topOverlay.dismiss(undefined, "backdrop");
}

export function AndroidBackHandler() {
  const history = useHistory();
  const [presentToast] = useIonToast();
  const routeStackRef = useRef<string[]>([]);
  const lastBackPressRef = useRef(0);
  const backButtonListenerRef = useRef<PluginListenerHandle | null>(null);

  useEffect(() => {
    routeStackRef.current = [
      toRouteKey(history.location.pathname, history.location.search, history.location.hash),
    ];
    const unlisten = history.listen((nextLocation, action) => {
      const nextPath = toRouteKey(nextLocation.pathname, nextLocation.search, nextLocation.hash);
      const stack = routeStackRef.current;
      if (action === "REPLACE") {
        if (stack.length === 0) {
          stack.push(nextPath);
        } else {
          stack[stack.length - 1] = nextPath;
        }
        return;
      }

      if (action === "POP") {
        const existingIndex = stack.lastIndexOf(nextPath);
        if (existingIndex >= 0) {
          stack.splice(existingIndex + 1);
        } else {
          stack.push(nextPath);
        }
        return;
      }

      if (stack[stack.length - 1] !== nextPath) {
        stack.push(nextPath);
      }
    });

    return () => {
      unlisten();
    };
  }, [history]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const register = async () => {
      backButtonListenerRef.current = await CapacitorApp.addListener("backButton", async () => {
        if (await dismissTopOverlay()) return;

        const stack = routeStackRef.current;
        if (stack.length > 1) {
          history.goBack();
          return;
        }

        const currentPath = history.location.pathname;
        if (currentPath !== DASHBOARD_PATH) {
          history.replace(DASHBOARD_PATH);
          return;
        }

        const now = Date.now();
        if (now - lastBackPressRef.current < EXIT_CONFIRMATION_WINDOW_MS) {
          await CapacitorApp.exitApp();
          return;
        }

        lastBackPressRef.current = now;
        presentToast({
          message: "Press back again to exit",
          duration: EXIT_CONFIRMATION_WINDOW_MS,
          position: "bottom",
        });
      });
    };

    void register();
    return () => {
      const listener = backButtonListenerRef.current;
      backButtonListenerRef.current = null;
      if (listener) {
        void listener.remove();
      }
    };
  }, [history, presentToast]);

  return null;
}
