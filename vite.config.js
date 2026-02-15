import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import checker from "vite-plugin-checker";
import { existsSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    checker({
      typescript: {
        tsconfigPath: "./tsconfig.json",
        buildMode: false, // Only check in dev mode
      },
      eslint: {
        lintCommand: 'eslint "src/**/*.{ts,tsx}"',
      },
    }),
    {
      name: "return-404-for-missing-files",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const urlPath = req.url.split("?")[0]; // Remove query string

          // Skip root path and index.html
          if (urlPath === "/" || urlPath === "/index.html") {
            return next();
          }

          // Skip Vite internal routes and source files
          // These are handled by Vite's dev server
          if (
            urlPath.startsWith("/src/") ||
            urlPath.startsWith("/node_modules/") ||
            urlPath.startsWith("/@") ||
            urlPath.startsWith("/@vite/") ||
            urlPath.startsWith("/@react-refresh") ||
            urlPath.startsWith("/@vite-plugin-checker-runtime")
          ) {
            return next();
          }

          // Only check for actual files (with extensions) in the public directory
          // This allows SPA routing to work while returning 404 for missing assets
          const hasExtension = /\.[^./]+$/.test(urlPath);

          if (hasExtension) {
            // Check if the file exists in the public directory
            const publicPath = join(process.cwd(), "public", urlPath);
            const fileExists = existsSync(publicPath);

            if (!fileExists) {
              // Return 404 for missing files
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/plain");
              res.end("File not found");
              return;
            }
          }

          next();
        });
      },
    },
  ],
  resolve: {
    dedupe: ["three"],
  },
  base: "./",
  server: {
    host: true,
    // Add MIME type for .wasm files
    mimeTypes: {
      "application/wasm": ["wasm"],
    },
    // Add headers for WASM files
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  // Ensure WASM files are served with correct headers
  optimizeDeps: {
    exclude: ["@kolarz3/zenkit"],
    include: ["react-window"],
  },
  // Configure assets handling for WASM
  assetsInclude: ["**/*.wasm"],
  build: {
    rollupOptions: {
      external: (id) => {
        // Don't bundle zenkit WASM, let it be served as asset
        if (id.includes("@kolarz3/zenkit") && id.includes(".wasm")) {
          return false;
        }
        return false;
      },
    },
  },
});
