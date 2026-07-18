import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
      "~/components": path.resolve(__dirname, "./app/components"),
      "~/components/ui": path.resolve(__dirname, "./app/components/ui"),
      "~/components/game": path.resolve(__dirname, "./app/components/game"),
      "~/components/layout": path.resolve(__dirname, "./app/components/layout"),
      "~/components/player": path.resolve(__dirname, "./app/components/player"),
      "~/components/shop": path.resolve(__dirname, "./app/components/shop"),
      "~/hooks": path.resolve(__dirname, "./app/hooks"),
      "~/lib": path.resolve(__dirname, "./app/lib"),
      "~/store": path.resolve(__dirname, "./app/store"),
      "~/routes": path.resolve(__dirname, "./app/routes"),
    },
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
  },
  server: {
    middlewareMode: false,
    port: 5173,
    strictPort: false,
    open: true,
  },
  build: {
    target: "ES2022",
    minify: "terser",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("node_modules/react")) {
            return "vendor";
          }
          if (id.includes("node_modules/convex")) {
            return "convex";
          }
          if (id.includes("components/ui")) {
            return "ui";
          }
        },
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
