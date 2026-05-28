import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const rechartsCompat = (name: string) =>
  fileURLToPath(
    new URL(`./src/lib/recharts-es-toolkit-compat/${name}.ts`, import.meta.url)
  );
const rechartsUseSyncExternalStore = fileURLToPath(
  new URL("./src/lib/recharts-use-sync-with-selector.ts", import.meta.url)
);

export default defineConfig({
  server: { port: 5174 },
  resolve: {
    alias: {
      "es-toolkit/compat/get": rechartsCompat("get"),
      "es-toolkit/compat/isPlainObject": rechartsCompat("isPlainObject"),
      "es-toolkit/compat/last": rechartsCompat("last"),
      "es-toolkit/compat/maxBy": rechartsCompat("maxBy"),
      "es-toolkit/compat/minBy": rechartsCompat("minBy"),
      "es-toolkit/compat/omit": rechartsCompat("omit"),
      "es-toolkit/compat/range": rechartsCompat("range"),
      "es-toolkit/compat/sortBy": rechartsCompat("sortBy"),
      "es-toolkit/compat/sumBy": rechartsCompat("sumBy"),
      "es-toolkit/compat/throttle": rechartsCompat("throttle"),
      "es-toolkit/compat/uniqBy": rechartsCompat("uniqBy"),
      "use-sync-external-store/shim/with-selector":
        rechartsUseSyncExternalStore,
      "use-sync-external-store/shim/with-selector.js":
        rechartsUseSyncExternalStore,
      "use-sync-external-store/with-selector": rechartsUseSyncExternalStore,
      "use-sync-external-store/with-selector.js": rechartsUseSyncExternalStore
    }
  },
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      quoteStyle: "double"
    }),
    react(),
    tailwindcss()
  ]
});
