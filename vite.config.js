import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Serves correctly both from the dev server root and from GitHub Pages' project-site
  // subpath (https://lwojas.github.io/webtrack/) — GITHUB_ACTIONS is set automatically by
  // the CI runner that builds for Pages (.github/workflows/deploy-pages.yml), never set
  // locally, so `npm run dev`/`npm run build` outside CI keep using root-relative paths.
  base: process.env.GITHUB_ACTIONS ? "/webtrack/" : "/",
  server: { port: 5175 },
  // webdsp's worklet-url subpath resolves its worklet asset via a relative import.meta.url
  // lookup that Vite's dev-time dependency pre-bundling breaks (confirmed necessary in
  // practice by webseq, a sibling project depending on the same package).
  optimizeDeps: {
    exclude: ["webdsp", "webdsp/worklet-url", "webdsp/sequencing"],
  },
});
