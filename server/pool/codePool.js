const fs = require("fs");
const path = require("path");
const { codePoolPaths } = require("../path/path");

const POOL_MAX = 999;
const LOCK_TTL_MS = parseInt(process.env.CODE_LOCK_TTL_MS || "600000", 10);

const APP_CONFIGS = {
  myapp: {
    prefix: "S",
    poolFile: codePoolPaths.myAppPoolFile,
    logFile: codePoolPaths.myAppLogFile,
  },
  goddown: {
    prefix: "G",
    poolFile: codePoolPaths.goddownPoolFile,
    logFile: codePoolPaths.goddownLogFile,
  },
};

const stateByApp = new Map();
const lockByApp = new Map();

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const buildInitialState = () => ({
  cycle: 1,
  available: Array.from({ length: POOL_MAX }, (_, index) => index + 1),
  locked: {},
  printed: {},
  updatedAt: new Date().toISOString(),
});

const loadState = (appId) => {
  const config = APP_CONFIGS[appId];
  if (!config) {
    throw new Error(`Unknown appId: ${appId}`);
  }

  const filePath = config.poolFile;
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    const state = buildInitialState();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return state;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.available)) {
      throw new Error("Invalid pool state");
    }
    return parsed;
  } catch (error) {
    const fallback = buildInitialState();
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
};

const persistState = (appId, state) => {
  const config = APP_CONFIGS[appId];
  ensureDir(path.dirname(config.poolFile));
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(config.poolFile, JSON.stringify(state, null, 2));
};

const appendLog = (appId, entry) => {
  const config = APP_CONFIGS[appId];
  ensureDir(codePoolPaths.logsDir);

  const header =
    "timestamp,appId,action,code,number,cycle,details" + "\n";
  if (!fs.existsSync(config.logFile)) {
    fs.writeFileSync(config.logFile, header);
  }

  const line = [
    entry.timestamp,
    entry.appId,
    entry.action,
    entry.code || "",
    entry.number ?? "",
    entry.cycle ?? "",
    entry.details || "",
  ]
    .map((value) => `"${String(value).replace(/\"/g, '""')}"`)
    .join(",")
    .concat("\n");

  fs.appendFileSync(config.logFile, line);
};

const cleanupExpiredLocks = (appId, state) => {
  const now = Date.now();
  let releasedCount = 0;
  Object.entries(state.locked).forEach(([code, lock]) => {
    const expiresAt = Date.parse(lock.expiresAt || "");
    if (!expiresAt || expiresAt <= now) {
      delete state.locked[code];
      if (!state.printed[code]) {
        state.available.push(lock.number);
      }
      releasedCount += 1;
      appendLog(appId, {
        timestamp: new Date().toISOString(),
        appId,
        action: "expired",
        code,
        number: lock.number,
        cycle: state.cycle,
        details: "lock expired",
      });
    }
  });

  if (releasedCount > 0) {
    state.available = Array.from(new Set(state.available)).sort((a, b) => a - b);
  }
};

const withAppLock = async (appId, fn) => {
  const prior = lockByApp.get(appId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  lockByApp.set(appId, prior.then(() => current));
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (lockByApp.get(appId) === current) {
      lockByApp.delete(appId);
    }
  }
};

const getState = (appId) => {
  if (!stateByApp.has(appId)) {
    stateByApp.set(appId, loadState(appId));
  }
  return stateByApp.get(appId);
};

const formatCode = (prefix, number) =>
  `${prefix}${String(number).padStart(3, "0")}`;

const parseNumberFromCode = (code, prefix) => {
  if (!code || !code.startsWith(prefix)) {
    return null;
  }
  const raw = code.slice(prefix.length);
  const number = Number.parseInt(raw, 10);
  return Number.isFinite(number) ? number : null;
};

const resetPool = (appId, state, reason) => {
  state.cycle = (state.cycle || 1) + 1;
  state.available = Array.from({ length: POOL_MAX }, (_, index) => index + 1);
  state.locked = {};
  state.printed = {};
  appendLog(appId, {
    timestamp: new Date().toISOString(),
    appId,
    action: "reset",
    code: "",
    number: "",
    cycle: state.cycle,
    details: reason || "pool reset",
  });
};

const allocateCode = async (appId, options = {}) =>
  withAppLock(appId, () => {
    const config = APP_CONFIGS[appId];
    if (!config) {
      throw new Error(`Unknown appId: ${appId}`);
    }

    const state = getState(appId);
    cleanupExpiredLocks(appId, state);

    if (!state.available.length) {
      resetPool(appId, state, "all numbers used");
    }

    state.available.sort((a, b) => a - b);
    const number = state.available.shift();
    const code = formatCode(config.prefix, number);
    const now = Date.now();
    const lock = {
      code,
      number,
      lockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
    };

    state.locked[code] = lock;
    appendLog(appId, {
      timestamp: new Date().toISOString(),
      appId,
      action: "locked",
      code,
      number,
      cycle: state.cycle,
      details: options.reason || "",
    });
    persistState(appId, state);

    return {
      code,
      number,
      cycle: state.cycle,
      expiresAt: lock.expiresAt,
    };
  });

const releaseCode = async (appId, code, reason = "released") =>
  withAppLock(appId, () => {
    const config = APP_CONFIGS[appId];
    if (!config) {
      throw new Error(`Unknown appId: ${appId}`);
    }
    if (!code) {
      return { released: false };
    }

    const state = getState(appId);
    cleanupExpiredLocks(appId, state);

    const lock = state.locked[code];
    if (!lock) {
      return { released: false };
    }

    delete state.locked[code];
    if (!state.printed[code]) {
      state.available.push(lock.number);
      state.available = Array.from(new Set(state.available)).sort((a, b) => a - b);
    }

    appendLog(appId, {
      timestamp: new Date().toISOString(),
      appId,
      action: "released",
      code,
      number: lock.number,
      cycle: state.cycle,
      details: reason,
    });
    persistState(appId, state);

    return { released: true };
  });

const markPrinted = async (appId, code, reason = "printed") =>
  withAppLock(appId, () => {
    const config = APP_CONFIGS[appId];
    if (!config) {
      throw new Error(`Unknown appId: ${appId}`);
    }
    if (!code) {
      return { printed: false };
    }

    const state = getState(appId);
    cleanupExpiredLocks(appId, state);

    const lock = state.locked[code];
    let number = lock?.number;
    if (!number) {
      number = parseNumberFromCode(code, config.prefix);
    }

    if (lock) {
      delete state.locked[code];
    }

    if (number && state.available.includes(number)) {
      state.available = state.available.filter((value) => value !== number);
    }

    state.printed[code] = {
      number,
      printedAt: new Date().toISOString(),
    };

    appendLog(appId, {
      timestamp: new Date().toISOString(),
      appId,
      action: "printed",
      code,
      number,
      cycle: state.cycle,
      details: reason,
    });
    persistState(appId, state);

    return { printed: true };
  });

const getStatus = (appId) => {
  const state = getState(appId);
  cleanupExpiredLocks(appId, state);
  return {
    cycle: state.cycle,
    availableCount: state.available.length,
    lockedCount: Object.keys(state.locked).length,
    printedCount: Object.keys(state.printed).length,
    nextAvailable: state.available.slice(0, 5),
  };
};

module.exports = {
  allocateCode,
  releaseCode,
  markPrinted,
  getStatus,
  APP_CONFIGS,
};
