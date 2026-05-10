import { readFileSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

const disableSsl = process.env.VITE_DISABLE_SSL === "1";
const httpsKeyPath = process.env.VITE_HTTPS_KEY;
const httpsCertPath = process.env.VITE_HTTPS_CERT;
const hasCustomHttpsConfig = Boolean(httpsKeyPath || httpsCertPath);

if (hasCustomHttpsConfig && (!httpsKeyPath || !httpsCertPath)) {
  throw new Error("Set both VITE_HTTPS_KEY and VITE_HTTPS_CERT to use a custom HTTPS certificate.");
}

const customHttps = httpsKeyPath && httpsCertPath
  ? {
      key: readFileSync(httpsKeyPath),
      cert: readFileSync(httpsCertPath)
    }
  : undefined;

export default defineConfig({
  plugins: disableSsl || customHttps ? [] : [basicSsl()],
  server: {
    host: "0.0.0.0",
    https: customHttps,
    port: 5173,
    proxy: {
      "/classroom-ws": {
        target: "ws://localhost:8787",
        ws: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});
