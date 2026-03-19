import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => {
  const useHttps = mode === "https";
  const defaultPort = 5175;
  const certPath = path.resolve(process.cwd(), "certs/dev-cert.pem");
  const keyPath = path.resolve(process.cwd(), "certs/dev-key.pem");
  const hasCustomCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

  const plugins = [react()];
  let httpsConfig: Record<string, unknown> | undefined;

  if (useHttps) {
    if (hasCustomCerts) {
      httpsConfig = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
    } else {
      plugins.push(basicSsl());
      httpsConfig = {};
    }
  }

  return {
    plugins,
    server: {
      host: true,
      port: defaultPort,
      strictPort: true,
      https: httpsConfig,
      hmr: useHttps ? { protocol: "wss", clientPort: defaultPort } : undefined,
      proxy: {
        "/new": {
          target: process.env.BACKEND_PROXY_TARGET || "http://localhost:4000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
