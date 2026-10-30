import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverPort = Number.parseInt(process.env.MUSES_PORT ?? "3001", 10);

// Mirror of the runtime HTML injection (src/server/foundation/static-files.ts)
// for the DEV server only: the same strict parser, the same global name. The
// production shell is never touched at build time — the serving process
// injects the hint per boot, so a flag-off deployment ships/serves the exact
// v0.6 shell bytes. `apply: "serve"` keeps this hook out of vite build.
const isTruthyFlag = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

const v07Features = {
  selfTrack: isTruthyFlag(process.env.MUSES_V07),
  replay:
    isTruthyFlag(process.env.MUSES_V07) &&
    isTruthyFlag(process.env.MUSES_V07_REPLAY),
};

const v07DevFeatureHint = {
  name: "muses-v07-dev-feature-hint",
  apply: "serve" as const,
  transformIndexHtml(html: string): string {
    if (!v07Features.selfTrack && !v07Features.replay) {
      return html;
    }
    // Same meta transport as the production server (CSP-safe).
    const injection = `<meta name="muses-features" content='${JSON.stringify(
      v07Features,
    )}'>`;
    return html.includes("</head>")
      ? html.replace("</head>", `${injection}</head>`)
      : `${html}${injection}`;
  },
};

export default defineConfig({
  plugins: [react(), v07DevFeatureHint],
  build: {
    outDir: "dist/web",
    sourcemap: true,
    rollupOptions: {
      output: {
        // R2 bundling arbitration (2026-10-21): app-router now imports the
        // player route from its leaf module (../player/route.js), so the
        // crossfade/deck engine ships only inside the lazy route chunks and
        // the first screen stops downloading it. That graph change also made
        // rollup merge the i18n runtime into the entry script; this rule
        // restores the R1 delivery shape — its own chunk that index.html
        // modulepreloads (react itself rode along in the R1 i18n chunk, so
        // it is grouped here to reproduce that split).
        manualChunks(id: string) {
          if (
            id.includes("/src/web/i18n/") ||
            id.includes("/node_modules/react/")
          ) {
            return "i18n";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
      },
    },
  },
});
