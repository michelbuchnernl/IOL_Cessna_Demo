import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [basicSsl()],
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
