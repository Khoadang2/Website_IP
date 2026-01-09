import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: 5500, 
    allowedHosts: ["web.tythac.com.vn", "125.234.111.198","localhost"],
    proxy: {
      "/api": {
        target: "http://localhost:5501",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
