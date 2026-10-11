import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  // webdsp's worklet-url subpath resolves its worklet asset via a relative import.meta.url
  // lookup that Vite's dev-time dependency pre-bundling breaks (confirmed necessary in
  // practice by webseq, a sibling project depending on the same package).
  optimizeDeps: {
    exclude: ["webdsp", "webdsp/worklet-url", "webdsp/sequencing"],
  },
});
