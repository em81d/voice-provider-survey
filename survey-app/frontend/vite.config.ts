import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only proxy so the frontend (Vite on :5173) can talk to the backend
// (Express on :5000) without CORS hassles or hardcoding the backend origin
// into fetch/WebSocket calls everywhere. In production these would instead
// be two separately deployed services, with VITE_API_BASE/VITE_WS_BASE set
// to the real backend URL at build time.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/stream": {
        target: "ws://localhost:5000",
        ws: true,
      },
    },
  },
});