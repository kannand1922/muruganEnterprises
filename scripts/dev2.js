const { spawnSync } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

const steps = [
  { cmd: "git", args: ["stash"], cwd: rootDir },
  { cmd: "git", args: ["pull"], cwd: rootDir },
  { cmd: "git", args: ["stash", "pop"], cwd: rootDir },
  { cmd: "npm", args: ["i"], cwd: rootDir },
  { cmd: "npm", args: ["i"], cwd: path.join(rootDir, "server") },
  { cmd: "npm", args: ["i"], cwd: path.join(rootDir, "server", "server-scanner") },
  { cmd: "npx", args: ["prisma", "db", "push"], cwd: path.join(rootDir, "server", "server-scanner") },
  { cmd: "npx", args: ["prisma", "generate"], cwd: path.join(rootDir, "server", "server-scanner") },
];

for (const step of steps) {
  const label = `${step.cmd} ${step.args.join(" ")}`;
  console.log(`\n[dev2] ${label}`);
  const result = spawnSync(step.cmd, step.args, {
    cwd: step.cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("\n[dev2] Starting backend: npm run dev (server)");
const startResult = spawnSync("npm", ["run", "dev"], {
  cwd: path.join(rootDir, "server"),
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(startResult.status || 0);
