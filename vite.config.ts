import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

const disableSsl = process.env.VITE_DISABLE_SSL === "1";

export default defineConfig({
  plugins: disableSsl ? [] : [basicSsl()],
  server: {
    host: "0.0.0.0",
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
