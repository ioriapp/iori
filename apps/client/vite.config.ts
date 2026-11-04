import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "node:path";
import { thirdPartyLicenses } from "../../scripts/licenses/vite.mjs";

export default defineConfig(({ command, mode }) => ({
  base: "./",
  plugins: [react(), tailwindcss(), thirdPartyLicenses()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Only the explicit development server can reach the browser bridge.
      // Even `vite build --mode web` resolves the product's Tauri adapter.
      "#native-platform": path.resolve(
        import.meta.dirname,
        command === "serve" && mode === "web"
          ? "src/native-platform-web.ts"
          : "src/native-platform-tauri.ts",
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
}));
