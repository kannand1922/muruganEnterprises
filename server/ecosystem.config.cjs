const path = require("path");

module.exports = {
  apps: [
    {
      name: "stocklens-backend",
      script: "./server.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 1000,
      min_uptime: "1s",
      max_restarts: 1000,
      time: true,
      watch: [
        path.join(__dirname, "server.js"),
        path.join(__dirname, "server-printer"),
        path.join(__dirname, "server-scanner"),
        path.join(__dirname, "../shared/config"),
        path.join(__dirname, "../shared/data"),
      ],
      ignore_watch: [
        "node_modules",
        ".git",
        "tmp",
        "logs",
        "*.log",
      ],
      watch_delay: 500,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
