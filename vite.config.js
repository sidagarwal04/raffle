import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        // Keep the browser host so Google’s redirect_uri is localhost:5173,
        // not the API port behind this proxy.
        changeOrigin: false,
      },
    },
  },
});
