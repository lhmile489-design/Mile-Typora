import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cspPlugin } from "./vite-plugins/csp";

export default defineConfig({
  plugins: [react(), cspPlugin()],
  server: {
    // The app loads this address during `mygo dev` (devUrl in mygo.config.ts).
    // 5273 rather than 5173 so it does not clash with other mygo projects.
    port: 5273,
    strictPort: true,
    // The development app and the packaged builds are not the page's.
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
