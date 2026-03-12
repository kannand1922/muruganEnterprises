const DEFAULT_ACTIVE_WINDOW_MS = 3 * 60 * 1000;

function getActiveDeviceWindowMs() {
  const raw = Number(process.env.FCM_ACTIVE_WINDOW_MS || DEFAULT_ACTIVE_WINDOW_MS);
  if (!Number.isFinite(raw) || raw < 30_000) {
    return DEFAULT_ACTIVE_WINDOW_MS;
  }
  return Math.trunc(raw);
}

function getActiveDeviceCutoff(now = new Date()) {
  return new Date(now.getTime() - getActiveDeviceWindowMs());
}

module.exports = {
  getActiveDeviceWindowMs,
  getActiveDeviceCutoff,
};
