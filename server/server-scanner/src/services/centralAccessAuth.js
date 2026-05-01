const crypto = require("crypto");
const fs = require("fs");
const { centralPrisma } = require("../centralPrisma");
const { stockLensScannerConfigPaths } = require("../../../../shared/config/paths");
const { readMailConfig, sendCentralOtpEmail } = require("./centralOtpMailer");

const CENTRAL_SESSION_HEADER = "x-central-session-token";
const CENTRAL_SESSION_COOKIE = "central_session";
const CENTRAL_DEVICE_HEADER = "x-central-device-id";
const CENTRAL_DEVICE_LABEL_HEADER = "x-central-device-label";
const OTP_PURPOSE_LOGIN = "login";
const OTP_PURPOSE_MASTER_ACCESS = "master_access";
const OTP_TTL_MINUTES = 10;
const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_WINDOW_MINUTES = 30;
const OTP_MAX_PER_WINDOW = 5;
const SESSION_TTL_DAYS = Math.max(
  1,
  Math.trunc(Number(process.env.CENTRAL_ACCESS_SESSION_DAYS || 1))
);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const MASTER_UNLOCK_TTL_MINUTES = 15;
const MASTER_UNLOCK_TTL_MS = MASTER_UNLOCK_TTL_MINUTES * 60 * 1000;
const CENTRAL_OWNER_EMAIL_FILE = stockLensScannerConfigPaths.centralOwnerEmailFile;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function readConfiguredOwnerEmail() {
  try {
    const raw = fs.readFileSync(CENTRAL_OWNER_EMAIL_FILE, "utf8");
    return normalizeEmail(raw);
  } catch {
    return "";
  }
}

function normalizeDeviceId(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  return /^[A-Za-z0-9:_-]{12,160}$/.test(candidate) ? candidate : "";
}

function normalizeDeviceLabel(value, fallback = "Unknown device") {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (raw) return raw.slice(0, 120);
  return fallback;
}

function normalizeUserAgent(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 255) : null;
}

function normalizeIpAddress(value) {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 120) : null;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getUserSummary(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    canAccessMasterData: user.canAccessMasterData,
  };
}

async function createAuditLog({
  userId = null,
  email = null,
  eventType,
  success = true,
  deviceId = null,
  ipAddress = null,
  userAgent = null,
  detail = null,
}) {
  try {
    await centralPrisma.accessAuditLog.create({
      data: {
        userId: userId || null,
        email: normalizeEmail(email) || null,
        eventType: String(eventType || "").trim() || "unknown",
        success: Boolean(success),
        deviceId: normalizeDeviceId(deviceId) || null,
        ipAddress: normalizeIpAddress(ipAddress),
        userAgent: normalizeUserAgent(userAgent),
        detail: detail ? String(detail).slice(0, 500) : null,
      },
    });
  } catch {
    // Ignore audit log failures so auth flow does not break.
  }
}

async function getAccessUserCount() {
  return centralPrisma.accessUser.count();
}

async function getAccessUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return centralPrisma.accessUser.findUnique({
    where: { email: normalizedEmail },
  });
}

async function ensureCentralDevice(deviceIdInput, metadata = {}) {
  const deviceId = normalizeDeviceId(deviceIdInput);
  if (!deviceId) {
    throw new Error("Device ID is required");
  }

  const deviceLabel = normalizeDeviceLabel(
    metadata.deviceLabel,
    metadata.userAgent || "Browser device"
  );
  const userAgent = normalizeUserAgent(metadata.userAgent);
  const lastSeenEmail = normalizeEmail(metadata.email) || null;
  const now = new Date();
  const existing = await centralPrisma.accessDevice.findUnique({
    where: { deviceId },
  });

  if (existing) {
    return centralPrisma.accessDevice.update({
      where: { id: existing.id },
      data: {
        deviceLabel: deviceLabel || existing.deviceLabel,
        userAgent,
        lastSeenEmail,
        lastSeenAt: now,
      },
    });
  }

  return centralPrisma.accessDevice.create({
    data: {
      deviceId,
      deviceLabel,
      userAgent,
      lastSeenEmail,
      lastSeenAt: now,
      active: false,
      canAccessMasterData: false,
    },
  });
}

async function getCentralDevice(deviceIdInput) {
  const deviceId = normalizeDeviceId(deviceIdInput);
  if (!deviceId) return null;
  return centralPrisma.accessDevice.findUnique({
    where: { deviceId },
  });
}

async function listCentralDevices() {
  return centralPrisma.accessDevice.findMany({
    orderBy: [{ active: "desc" }, { canAccessMasterData: "desc" }, { lastSeenAt: "desc" }],
  });
}

async function updateCentralDeviceAccess(idInput, payload, actorEmail) {
  const id = Number(idInput);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid device id");
  }

  const existing = await centralPrisma.accessDevice.findUnique({ where: { id: Math.trunc(id) } });
  if (!existing) {
    throw new Error("Device not found");
  }

  const nextActive =
    payload.active === undefined ? existing.active : Boolean(payload.active);
  const nextMaster =
    payload.canAccessMasterData === undefined
      ? existing.canAccessMasterData
      : Boolean(payload.canAccessMasterData);

  const updated = await centralPrisma.accessDevice.update({
    where: { id: existing.id },
    data: {
      active: nextActive,
      canAccessMasterData: nextActive ? nextMaster : false,
      approvedAt: nextActive ? existing.approvedAt || new Date() : null,
      approvedByEmail: nextActive ? normalizeEmail(actorEmail) || null : null,
    },
  });

  await createAuditLog({
    email: actorEmail,
    eventType: "device_update",
    success: true,
    deviceId: updated.deviceId,
    detail: `active=${updated.active}; master=${updated.canAccessMasterData}`,
  });

  if (!updated.active || !updated.canAccessMasterData) {
    await centralPrisma.accessSession.updateMany({
      where: {
        deviceId: updated.deviceId,
        revokedAt: null,
      },
      data: {
        masterAccessUntil: null,
      },
    });
  }

  return updated;
}

async function bootstrapOwner(email) {
  const normalizedEmail = normalizeEmail(email) || readConfiguredOwnerEmail();
  if (!normalizedEmail) {
    throw new Error("Owner email is required");
  }

  const userCount = await getAccessUserCount();
  if (userCount > 0) {
    throw new Error("Central access is already configured");
  }

  const user = await centralPrisma.accessUser.create({
    data: {
      email: normalizedEmail,
      role: "owner",
      active: true,
      canAccessMasterData: true,
    },
  });

  await createAuditLog({
    userId: user.id,
    email: user.email,
    eventType: "owner_bootstrap",
    success: true,
  });

  return user;
}

async function createOtpChallenge(userId, purpose) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await centralPrisma.accessOtpChallenge.create({
    data: {
      userId,
      purpose,
      otpHash: hashValue(otp),
      expiresAt,
    },
  });
  return {
    otp,
    expiresAt: expiresAt.toISOString(),
  };
}

async function enforceOtpThrottle(user, purpose) {
  const now = Date.now();
  const cooldownEdge = new Date(now - OTP_RESEND_COOLDOWN_SECONDS * 1000);
  const windowEdge = new Date(now - OTP_WINDOW_MINUTES * 60 * 1000);

  const [latestChallenge, recentCount] = await Promise.all([
    centralPrisma.accessOtpChallenge.findFirst({
      where: {
        userId: user.id,
        purpose,
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    centralPrisma.accessOtpChallenge.count({
      where: {
        userId: user.id,
        purpose,
        createdAt: {
          gte: windowEdge,
        },
      },
    }),
  ]);

  if (latestChallenge && latestChallenge.createdAt.getTime() >= cooldownEdge.getTime()) {
    throw new Error(`Please wait ${OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting a new OTP`);
  }
  if (recentCount >= OTP_MAX_PER_WINDOW) {
    throw new Error(`Too many OTP requests. Try again after ${OTP_WINDOW_MINUTES} minutes`);
  }
}

async function requestOtpForPurpose(user, purpose, metadata = {}) {
  await enforceOtpThrottle(user, purpose);

  const challenge = await createOtpChallenge(user.id, purpose);
  await sendCentralOtpEmail({
    to: user.email,
    otp: challenge.otp,
    expiresInMinutes: OTP_TTL_MINUTES,
  });

  await createAuditLog({
    userId: user.id,
    email: user.email,
    eventType: purpose === OTP_PURPOSE_MASTER_ACCESS ? "master_otp_requested" : "login_otp_requested",
    success: true,
    deviceId: metadata.deviceId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  return {
    email: user.email,
    expiresAt: challenge.expiresAt,
  };
}

async function requestLoginOtp(email, metadata = {}) {
  const user = await getAccessUserByEmail(email);
  if (!user || !user.active) {
    await createAuditLog({
      email,
      eventType: "login_otp_requested",
      success: false,
      deviceId: metadata.deviceId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      detail: "email_not_allowed",
    });
    throw new Error("This email is not allowed for central access");
  }

  const deviceId = normalizeDeviceId(metadata.deviceId);
  if (!deviceId) {
    throw new Error("This browser is missing a device ID");
  }

  await ensureCentralDevice(deviceId, {
    deviceLabel: metadata.deviceLabel,
    userAgent: metadata.userAgent,
    email: user.email,
  });

  return requestOtpForPurpose(user, OTP_PURPOSE_LOGIN, metadata);
}

async function verifyOtpChallenge(user, purpose, otp) {
  const challenge = await centralPrisma.accessOtpChallenge.findFirst({
    where: {
      userId: user.id,
      purpose,
      consumedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  if (!challenge) {
    throw new Error("OTP not found. Request a new OTP.");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new Error("OTP expired. Request a new OTP.");
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    throw new Error("Too many wrong attempts. Request a new OTP.");
  }

  if (hashValue(otp) !== challenge.otpHash) {
    await centralPrisma.accessOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new Error("Invalid OTP");
  }

  await centralPrisma.accessOtpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
}

async function verifyLoginOtp(email, otp, metadata = {}) {
  const user = await getAccessUserByEmail(email);
  if (!user || !user.active) {
    await createAuditLog({
      email,
      eventType: "login_otp_verified",
      success: false,
      deviceId: metadata.deviceId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      detail: "email_not_allowed",
    });
    throw new Error("This email is not allowed for central access");
  }

  const deviceId = normalizeDeviceId(metadata.deviceId);
  if (!deviceId) {
    throw new Error("This browser is missing a device ID");
  }

  await ensureCentralDevice(deviceId, {
    deviceLabel: metadata.deviceLabel,
    userAgent: metadata.userAgent,
    email: user.email,
  });

  try {
    await verifyOtpChallenge(user, OTP_PURPOSE_LOGIN, otp);
  } catch (error) {
    await createAuditLog({
      userId: user.id,
      email: user.email,
      eventType: "login_otp_verified",
      success: false,
      deviceId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      detail: error instanceof Error ? error.message : "otp_failed",
    });
    throw error;
  }

  const rawToken = generateSessionToken();
  const tokenHash = hashValue(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await centralPrisma.accessSession.create({
    data: {
      userId: user.id,
      tokenHash,
      deviceId,
      expiresAt,
    },
  });

  await createAuditLog({
    userId: user.id,
    email: user.email,
    eventType: "login_otp_verified",
    success: true,
    deviceId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    detail: `session_id=${session.id}`,
  });

  return {
    token: rawToken,
    expiresAt: expiresAt.toISOString(),
    user: getUserSummary(user),
    session: {
      id: session.id,
      expiresAt: expiresAt.toISOString(),
      masterAccessUntil: null,
      deviceId,
    },
  };
}

async function validateCentralSession(tokenInput, deviceIdInput, metadata = {}) {
  const token = String(tokenInput || "").trim();
  if (!token) {
    return { ok: false, message: "Missing central session token" };
  }

  const tokenHash = hashValue(token);
  const session = await centralPrisma.accessSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return { ok: false, message: "Invalid central session" };
  }
  if (session.revokedAt) {
    return { ok: false, message: "Central session revoked" };
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    return { ok: false, message: "Central session expired" };
  }
  if (!session.user?.active) {
    return { ok: false, message: "Central user is inactive" };
  }

  const deviceId = normalizeDeviceId(deviceIdInput);
  if (!deviceId) {
    return { ok: false, message: "Device ID is required" };
  }
  if (session.deviceId && session.deviceId !== deviceId) {
    return { ok: false, message: "Session can only be used from the original device" };
  }

  await ensureCentralDevice(deviceId, {
    deviceLabel: metadata.deviceLabel,
    userAgent: metadata.userAgent,
    email: session.user.email,
  });

  await centralPrisma.accessSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: new Date(),
      deviceId,
    },
  });

  return {
    ok: true,
    session: {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
      masterAccessUntil: session.masterAccessUntil ? session.masterAccessUntil.toISOString() : null,
      deviceId,
    },
    user: getUserSummary(session.user),
  };
}

async function revokeSession(tokenInput, metadata = {}) {
  const token = String(tokenInput || "").trim();
  if (!token) return;
  const tokenHash = hashValue(token);
  const sessions = await centralPrisma.accessSession.findMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    include: { user: true },
  });
  if (!sessions.length) return;

  await centralPrisma.accessSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      masterAccessUntil: null,
    },
  });

  await Promise.all(
    sessions.map((session) =>
      createAuditLog({
        userId: session.userId,
        email: session.user?.email,
        eventType: "logout",
        success: true,
        deviceId: session.deviceId || metadata.deviceId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      })
    )
  );
}

async function revokeAllCentralSessions(actor) {
  const revokedAt = new Date();
  const result = await centralPrisma.accessSession.updateMany({
    where: { revokedAt: null },
    data: { revokedAt, masterAccessUntil: null },
  });
  await createAuditLog({
    userId: actor?.id || null,
    email: actor?.email || null,
    eventType: "revoke_all_sessions",
    success: true,
    detail: `revoked=${result.count}`,
  });
  return { revokedCount: result.count, revokedAt: revokedAt.toISOString() };
}

async function listActiveCentralSessions() {
  const sessions = await centralPrisma.accessSession.findMany({
    where: {
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    include: { user: true },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });

  const deviceIds = Array.from(
    new Set(
      sessions
        .map((session) => normalizeDeviceId(session.deviceId))
        .filter(Boolean)
    )
  );
  const devices = deviceIds.length
    ? await centralPrisma.accessDevice.findMany({
        where: {
          deviceId: {
            in: deviceIds,
          },
        },
      })
    : [];
  const deviceMap = new Map(devices.map((device) => [device.deviceId, device]));

  return sessions.map((session) => {
    const deviceId = normalizeDeviceId(session.deviceId);
    const device = deviceId ? deviceMap.get(deviceId) : null;
    return {
      id: session.id,
      userId: session.userId,
      email: session.user?.email || null,
      role: session.user?.role || null,
      userActive: Boolean(session.user?.active),
      userCanAccessMasterData: Boolean(session.user?.canAccessMasterData),
      deviceId: deviceId || null,
      deviceLabel: device?.deviceLabel || null,
      deviceActive: device ? Boolean(device.active) : false,
      deviceCanAccessMasterData: device ? Boolean(device.canAccessMasterData) : false,
      expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
      masterAccessUntil: session.masterAccessUntil ? session.masterAccessUntil.toISOString() : null,
      lastSeenAt: session.lastSeenAt ? session.lastSeenAt.toISOString() : null,
      createdAt: session.createdAt ? session.createdAt.toISOString() : null,
    };
  });
}

async function revokeCentralSessionById(sessionIdInput, actor = {}) {
  const sessionId = Number(sessionIdInput);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    throw new Error("Invalid session id");
  }

  const session = await centralPrisma.accessSession.findUnique({
    where: { id: Math.trunc(sessionId) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new Error("Session not found");
  }

  await centralPrisma.accessSession.update({
    where: { id: session.id },
    data: {
      revokedAt: new Date(),
      masterAccessUntil: null,
    },
  });

  await createAuditLog({
    userId: actor?.id || null,
    email: actor?.email || null,
    eventType: "session_revoked",
    success: true,
    deviceId: actor?.deviceId || session.deviceId || null,
    detail: `session_id=${session.id}; target=${session.user?.email || "unknown"}`,
  });

  return {
    revokedSessionId: session.id,
    email: session.user?.email || null,
  };
}

async function revokeCentralSessionsByDevice(deviceIdInput, actor = {}) {
  const deviceId = normalizeDeviceId(deviceIdInput);
  if (!deviceId) {
    throw new Error("Invalid device id");
  }

  const activeSessions = await centralPrisma.accessSession.findMany({
    where: {
      deviceId,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    include: { user: true },
  });

  if (!activeSessions.length) {
    return {
      deviceId,
      revokedCount: 0,
    };
  }

  await centralPrisma.accessSession.updateMany({
    where: {
      deviceId,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    data: {
      revokedAt: new Date(),
      masterAccessUntil: null,
    },
  });

  await createAuditLog({
    userId: actor?.id || null,
    email: actor?.email || null,
    eventType: "device_sessions_revoked",
    success: true,
    deviceId: actor?.deviceId || deviceId,
    detail: `target_device=${deviceId}; revoked=${activeSessions.length}`,
  });

  return {
    deviceId,
    revokedCount: activeSessions.length,
  };
}

async function updateOwnerEmail(userId, email, actor) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Owner email is required");
  }

  const updated = await centralPrisma.accessUser.update({
    where: { id: userId },
    data: { email: normalizedEmail },
  });

  await createAuditLog({
    userId: actor?.id || updated.id,
    email: updated.email,
    eventType: "owner_email_updated",
    success: true,
    detail: normalizedEmail,
  });

  return updated;
}

async function requestMasterAccessOtp(currentUser, session, metadata = {}) {
  if (!currentUser?.canAccessMasterData) {
    throw new Error("This user cannot access master data");
  }
  const deviceId = normalizeDeviceId(metadata.deviceId || session?.deviceId);
  if (!deviceId) {
    throw new Error("Approved device is required");
  }

  const device = await ensureCentralDevice(deviceId, {
    deviceLabel: metadata.deviceLabel,
    userAgent: metadata.userAgent,
    email: currentUser.email,
  });
  if (!device.active || !device.canAccessMasterData) {
    throw new Error("This device is not approved for master data");
  }

  return requestOtpForPurpose(currentUser, OTP_PURPOSE_MASTER_ACCESS, {
    deviceId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });
}

async function verifyMasterAccessOtp(currentUser, session, otp, metadata = {}) {
  if (!currentUser?.canAccessMasterData) {
    throw new Error("This user cannot access master data");
  }
  if (!session?.id) {
    throw new Error("Session is required");
  }
  const deviceId = normalizeDeviceId(metadata.deviceId || session?.deviceId);
  if (!deviceId) {
    throw new Error("Approved device is required");
  }

  const device = await getCentralDevice(deviceId);
  if (!device || !device.active || !device.canAccessMasterData) {
    throw new Error("This device is not approved for master data");
  }

  try {
    await verifyOtpChallenge(currentUser, OTP_PURPOSE_MASTER_ACCESS, otp);
  } catch (error) {
    await createAuditLog({
      userId: currentUser.id,
      email: currentUser.email,
      eventType: "master_otp_verified",
      success: false,
      deviceId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      detail: error instanceof Error ? error.message : "otp_failed",
    });
    throw error;
  }

  const masterAccessUntil = new Date(Date.now() + MASTER_UNLOCK_TTL_MS);
  await centralPrisma.accessSession.update({
    where: { id: session.id },
    data: { masterAccessUntil },
  });

  await createAuditLog({
    userId: currentUser.id,
    email: currentUser.email,
    eventType: "master_otp_verified",
    success: true,
    deviceId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    detail: `master_access_until=${masterAccessUntil.toISOString()}`,
  });

  return {
    expiresAt: masterAccessUntil.toISOString(),
  };
}

async function revokeMasterAccess(sessionId, actor) {
  if (!sessionId) return;
  await centralPrisma.accessSession.update({
    where: { id: sessionId },
    data: { masterAccessUntil: null },
  });
  await createAuditLog({
    userId: actor?.id || null,
    email: actor?.email || null,
    eventType: "master_access_revoked",
    success: true,
    deviceId: actor?.deviceId || null,
  });
}

async function getMasterAccessStatus(currentUser, session, deviceIdInput) {
  const deviceId = normalizeDeviceId(deviceIdInput || session?.deviceId);
  const device = deviceId ? await getCentralDevice(deviceId) : null;
  const masterAccessUntil = session?.masterAccessUntil || null;
  return {
    userCanAccessMasterData: Boolean(currentUser?.canAccessMasterData),
    deviceId: deviceId || null,
    device: device
      ? {
          id: device.id,
          deviceId: device.deviceId,
          deviceLabel: device.deviceLabel,
          active: device.active,
          canAccessMasterData: device.canAccessMasterData,
          approvedByEmail: device.approvedByEmail,
          approvedAt: device.approvedAt ? device.approvedAt.toISOString() : null,
          lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
          createdAt: device.createdAt ? device.createdAt.toISOString() : null,
        }
      : null,
    unlocked: Boolean(masterAccessUntil && new Date(masterAccessUntil).getTime() > Date.now()),
    expiresAt: masterAccessUntil || null,
    unlockTtlMinutes: MASTER_UNLOCK_TTL_MINUTES,
  };
}

async function getAccessAuthStatus(tokenInput, deviceIdInput, metadata = {}) {
  const userCount = await getAccessUserCount();
  const mailConfig = readMailConfig();
  const configuredOwnerEmail = readConfiguredOwnerEmail() || null;
  if (userCount === 0) {
    return {
      configured: false,
      needsBootstrap: true,
      mailConfigured: mailConfig.configured,
      configuredOwnerEmail,
      sessionDays: SESSION_TTL_DAYS,
      masterUnlockMinutes: MASTER_UNLOCK_TTL_MINUTES,
    };
  }

  const validation = await validateCentralSession(tokenInput, deviceIdInput, metadata);
  return {
    configured: true,
    needsBootstrap: false,
    mailConfigured: mailConfig.configured,
    configuredOwnerEmail,
    sessionDays: SESSION_TTL_DAYS,
    masterUnlockMinutes: MASTER_UNLOCK_TTL_MINUTES,
    authenticated: validation.ok,
    user: validation.ok ? validation.user : null,
    expiresAt: validation.ok ? validation.session.expiresAt : null,
    masterAccessUntil: validation.ok ? validation.session.masterAccessUntil : null,
  };
}

module.exports = {
  CENTRAL_SESSION_HEADER,
  CENTRAL_SESSION_COOKIE,
  CENTRAL_DEVICE_HEADER,
  CENTRAL_DEVICE_LABEL_HEADER,
  SESSION_TTL_DAYS,
  OTP_TTL_MINUTES,
  MASTER_UNLOCK_TTL_MINUTES,
  bootstrapOwner,
  requestLoginOtp,
  verifyLoginOtp,
  validateCentralSession,
  revokeSession,
  revokeAllCentralSessions,
  updateOwnerEmail,
  requestMasterAccessOtp,
  verifyMasterAccessOtp,
  revokeMasterAccess,
  getMasterAccessStatus,
  getAccessAuthStatus,
  listActiveCentralSessions,
  revokeCentralSessionById,
  revokeCentralSessionsByDevice,
  listCentralDevices,
  updateCentralDeviceAccess,
  ensureCentralDevice,
  getCentralDevice,
};
