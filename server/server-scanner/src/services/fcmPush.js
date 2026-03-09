const fs = require("fs");
const path = require("path");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

const LOCAL_SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "..", "firebase-service-account.json");

function normalizePath(filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

function parseServiceAccountJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Service account JSON must be an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid service account JSON: ${error.message}`);
  }
}

function readServiceAccountFromPath(filePath) {
  const resolvedPath = normalizePath(filePath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return null;
  const raw = fs.readFileSync(resolvedPath, "utf8");
  return parseServiceAccountJson(raw);
}

function withNormalizedPrivateKey(serviceAccount) {
  if (!serviceAccount || typeof serviceAccount !== "object") return serviceAccount;
  const privateKey = String(serviceAccount.private_key || "");
  if (!privateKey) return serviceAccount;
  return {
    ...serviceAccount,
    private_key: privateKey.replace(/\\n/g, "\n"),
  };
}

function getServiceAccountConfig() {
  const inlineJson = String(process.env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  if (inlineJson) {
    return withNormalizedPrivateKey(parseServiceAccountJson(inlineJson));
  }

  const byPath =
    readServiceAccountFromPath(process.env.FCM_SERVICE_ACCOUNT_PATH) ||
    readServiceAccountFromPath(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    readServiceAccountFromPath(LOCAL_SERVICE_ACCOUNT_PATH);
  if (byPath) {
    return withNormalizedPrivateKey(byPath);
  }

  return null;
}

function getFirebaseApp() {
  if (getApps().length > 0) return getApps()[0];

  const serviceAccount = getServiceAccountConfig();
  if (!serviceAccount) {
    throw new Error(
      `Firebase service account not configured. Set FCM_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS, or place the JSON at ${LOCAL_SERVICE_ACCOUNT_PATH}.`
    );
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id || process.env.FCM_PROJECT_ID || undefined,
  });
}

function toDataPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const entries = Object.entries(data).filter(([key]) => String(key).trim() !== "");
  if (entries.length === 0) return undefined;
  const normalized = {};
  for (const [key, value] of entries) {
    normalized[String(key)] = value === undefined || value === null ? "" : String(value);
  }
  return normalized;
}

async function sendPushNotification({ token, title, body, data, dryRun = false }) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw new Error("FCM token is required");
  }

  const app = getFirebaseApp();
  const messaging = getMessaging(app);

  const notificationTitle = String(title || "").trim() || "StockLens Test Notification";
  const notificationBody = String(body || "").trim() || "Push notifications are working";
  const dataPayload = toDataPayload(data);

  const message = {
    token: normalizedToken,
    notification: {
      title: notificationTitle,
      body: notificationBody,
    },
    data: dataPayload,
    android: {
      priority: "high",
    },
  };

  const messageId = await messaging.send(message, Boolean(dryRun));
  return { messageId };
}

async function sendPushNotificationToMany({ tokens, title, body, data, dryRun = false }) {
  const normalizedTokens = Array.from(
    new Set(
      (Array.isArray(tokens) ? tokens : [])
        .map((token) => String(token || "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedTokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      responses: [],
    };
  }

  const app = getFirebaseApp();
  const messaging = getMessaging(app);

  const notificationTitle = String(title || "").trim() || "StockLens Notification";
  const notificationBody = String(body || "").trim() || "Stock is low, please refill it.";
  const dataPayload = toDataPayload(data);

  const response = await messaging.sendEachForMulticast(
    {
      tokens: normalizedTokens,
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: dataPayload,
      android: {
        priority: "high",
      },
    },
    Boolean(dryRun)
  );

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    responses: response.responses.map((entry, index) => ({
      token: normalizedTokens[index],
      success: Boolean(entry.success),
      messageId: entry.messageId || null,
      errorCode: entry.error?.code || null,
      errorMessage: entry.error?.message || null,
    })),
  };
}

module.exports = {
  sendPushNotification,
  sendPushNotificationToMany,
};
