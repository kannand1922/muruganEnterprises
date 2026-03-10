import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from "@capacitor/push-notifications";

export const FCM_TOKEN_STORAGE_KEY = "stocklens_fcm_token";

const FCM_REGISTRATION_TIMEOUT_MS = 15000;
const FOREGROUND_NOTIFICATION_CHANNEL_ID = "stocklens-foreground";
const FOREGROUND_NOTIFICATION_CHANNEL_NAME = "StockLens Alerts";

type InitFcmOptions = {
  force?: boolean;
  requestPermission?: boolean;
};

let listenersAttached = false;
let inFlightRegistration: Promise<string | null> | null = null;
let localNotificationChannelReady = false;

function isAndroidNative() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function normalizeToken(value: unknown) {
  const token = String(value ?? "").trim();
  return token || null;
}

function normalizeRoute(value: unknown) {
  const route = String(value ?? "").trim();
  if (!route) return "";
  if (route.startsWith("/")) return route;
  return `/${route.replace(/^\/+/, "")}`;
}

function toPayloadRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function resolveNotificationRoute(payload: Record<string, unknown> | null | undefined) {
  const data = payload || {};
  const routeFromPayload = normalizeRoute(data.route || data.redirectRoute || data.path || data.redirectPath);
  if (routeFromPayload) return routeFromPayload;

  const screen = String(data.screen || data.type || "").trim().toLowerCase();
  if (screen.includes("nil_stock") || screen.includes("nil-stock")) {
    const locationRaw = Number(data.shopLocationId || data.locationId || "");
    if (Number.isFinite(locationRaw) && locationRaw > 0) {
      return `/stock/nil?shopLocationId=${encodeURIComponent(String(Math.trunc(locationRaw)))}`;
    }
    return "/stock/nil";
  }

  if (screen.includes("low_stock") || screen.includes("low-stock")) {
    const locationRaw = Number(data.shopLocationId || data.locationId || "");
    if (Number.isFinite(locationRaw) && locationRaw > 0) {
      return `/stock/low-stock?shopLocationId=${encodeURIComponent(String(Math.trunc(locationRaw)))}`;
    }
    return "/stock/low-stock";
  }

  return "";
}

function navigateFromPushAction(payload: Record<string, unknown> | null | undefined) {
  const route = resolveNotificationRoute(payload);
  if (!route) return;

  const current = `${window.location.pathname}${window.location.search}`;
  if (current === route) return;
  window.location.assign(route);
}

async function ensureForegroundNotificationChannel() {
  if (localNotificationChannelReady) return;

  await LocalNotifications.createChannel({
    id: FOREGROUND_NOTIFICATION_CHANNEL_ID,
    name: FOREGROUND_NOTIFICATION_CHANNEL_NAME,
    description: "Foreground push notifications for StockLens",
    importance: 5,
    visibility: 1,
  });

  localNotificationChannelReady = true;
}

async function ensureLocalNotificationPermission() {
  const permissions = await LocalNotifications.checkPermissions();
  if (permissions.display === "granted") return true;

  const requested = await LocalNotifications.requestPermissions();
  return requested.display === "granted";
}

async function showForegroundNotification(notification: PushNotificationSchema) {
  const granted = await ensureLocalNotificationPermission();
  if (!granted) return;

  await ensureForegroundNotificationChannel();

  const title = String(notification.title || "").trim() || "StockLens";
  const body = String(notification.body || "").trim() || "Open app to view details";
  const payload = toPayloadRecord(notification.data);

  await LocalNotifications.schedule({
    notifications: [
      {
        id: Date.now() % 2147483647,
        title,
        body,
        channelId: FOREGROUND_NOTIFICATION_CHANNEL_ID,
        extra: payload,
      },
    ],
  });
}

function persistToken(value: string) {
  localStorage.setItem(FCM_TOKEN_STORAGE_KEY, value);
  return value;
}

export function getStoredFcmToken() {
  const token = normalizeToken(localStorage.getItem(FCM_TOKEN_STORAGE_KEY));
  return token;
}

export function clearStoredFcmToken() {
  localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
}

async function attachNotificationListeners() {
  if (listenersAttached) return;

  await PushNotifications.addListener("pushNotificationReceived", (notification: PushNotificationSchema) => {
    console.info("Push notification received:", notification);
    void showForegroundNotification(notification).catch((error) => {
      console.warn("Failed to show foreground notification:", error);
    });
  });

  await PushNotifications.addListener("pushNotificationActionPerformed", (notification: ActionPerformed) => {
    console.info("Push notification action performed:", notification);
    const payload = toPayloadRecord(notification?.notification?.data);
    navigateFromPushAction(payload);
  });

  await LocalNotifications.addListener("localNotificationActionPerformed", (notification) => {
    console.info("Local notification action performed:", notification);
    const payload = toPayloadRecord(notification?.notification?.extra);
    navigateFromPushAction(payload);
  });

  listenersAttached = true;
}

async function ensurePushPermission(shouldPrompt: boolean) {
  const permissions = await PushNotifications.checkPermissions();
  if (permissions.receive === "granted") return true;
  if (!shouldPrompt) return false;

  const requested = await PushNotifications.requestPermissions();
  return requested.receive === "granted";
}

async function registerAndWaitForToken() {
  return new Promise<string>((resolve, reject) => {
    let timeoutId: number | null = null;
    let registrationHandle: { remove: () => Promise<void> } | null = null;
    let registrationErrorHandle: { remove: () => Promise<void> } | null = null;
    let settled = false;

    const cleanup = async () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      await registrationHandle?.remove();
      await registrationErrorHandle?.remove();
    };

    const resolveOnce = async (value: string) => {
      if (settled) return;
      settled = true;
      await cleanup();
      resolve(value);
    };

    const rejectOnce = async (error: Error) => {
      if (settled) return;
      settled = true;
      await cleanup();
      reject(error);
    };

    const setup = async () => {
      try {
        registrationHandle = await PushNotifications.addListener("registration", (token: Token) => {
          const normalized = normalizeToken(token.value);
          if (!normalized) {
            void rejectOnce(new Error("Received empty FCM token"));
            return;
          }
          void resolveOnce(persistToken(normalized));
        });

        registrationErrorHandle = await PushNotifications.addListener("registrationError", (error) => {
          const message =
            typeof error === "object" && error && "error" in error
              ? String((error as { error?: unknown }).error ?? "Unknown registration error")
              : "Unknown registration error";
          void rejectOnce(new Error(message));
        });

        timeoutId = window.setTimeout(() => {
          void rejectOnce(new Error("Timed out while waiting for FCM token"));
        }, FCM_REGISTRATION_TIMEOUT_MS);

        await PushNotifications.register();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to register for FCM";
        await rejectOnce(new Error(message));
      }
    };

    void setup();
  });
}

export async function initializeFcmToken(options: InitFcmOptions = {}) {
  const { force = false, requestPermission = true } = options;

  if (!isAndroidNative()) return null;
  await attachNotificationListeners();

  if (!force) {
    const existing = getStoredFcmToken();
    if (existing) return existing;
  }

  if (inFlightRegistration) return inFlightRegistration;

  inFlightRegistration = (async () => {
    const granted = await ensurePushPermission(requestPermission);
    if (!granted) return null;
    return registerAndWaitForToken();
  })();

  try {
    return await inFlightRegistration;
  } finally {
    inFlightRegistration = null;
  }
}

export async function refreshFcmToken() {
  return initializeFcmToken({ force: true, requestPermission: true });
}
