import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const viteBin = path.resolve(rootDir, "node_modules", "vite", "bin", "vite.js");

function spawnVite(label, args, extraEnv = {}) {
  return spawn(process.execPath, [viteBin, ...args], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      ...extraEnv,
    },
  });
}

const children = [
  spawnVite("http", ["--host", "--port", "5175"]),
  spawnVite("https", ["--mode", "https", "--host", "--port", "5176"]),
];

let shuttingDown = false;

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shutdown();
    if (signal) {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});
