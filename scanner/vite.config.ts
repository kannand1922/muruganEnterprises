/// <reference types="vitest" />

import fs from "node:fs";
import path from "node:path";
import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const useHttps = mode === "https";
  const certPath = path.resolve(process.cwd(), "certs/dev-cert.pem");
  const keyPath = path.resolve(process.cwd(), "certs/dev-key.pem");
  const hasCustomCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

  const plugins = [react(), legacy()];
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
      port: 5173,
      strictPort: true,
      https: httpsConfig,
      hmr: useHttps ? { protocol: "wss", clientPort: 5173 } : undefined,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
    },
  };
});
