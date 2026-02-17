import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  console.log("[vite.config] loading proxy /api -> http://localhost:3000");
  return {
    // Use relative paths for Capacitor (file:// URLs in native app)
    base: "./",
    plugins: [react()],
    build: {
      // Ensure assets are chunked appropriately
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            // Split vendor code for better caching
            vendor: ["react", "react-dom"],
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});