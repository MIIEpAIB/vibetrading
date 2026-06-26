import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const PROXY_PATHS = [
  "/sessions",
  "/auth",
  "/swarm/presets",
  "/swarm/runs",
  "/settings/llm",
  "/settings/data-sources",
  "/strategies",
  "/crypto",
  "/mandate",
  "/live",
  "/upload",
  "/shadow-reports",
];

function cleanBuildArtifacts() {
  const outDir = path.resolve(__dirname, "dist");
  const removable = ["assets", "coin-icons", "favicon.svg", "index.html", "logo.svg"];
  return {
    name: "clean-build-artifacts",
    apply: "build",
    buildStart() {
      for (const entry of removable) {
        fs.rmSync(path.join(outDir, entry), { force: true, recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_URL || "http://127.0.0.1:8899";
  const devProxyAuth = env.VIBE_DEV_PROXY_AUTH || "";
  const apiProxy = {
    target: apiTarget,
    changeOrigin: true,
    configure(proxy: { on: (event: "proxyReq", handler: (proxyReq: { setHeader: (name: string, value: string) => void }) => void) => void }) {
      if (!devProxyAuth) return;
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("x-vibe-dev-proxy-auth", devProxyAuth);
      });
    },
  };
  const apiProxyWithHtmlFallback = {
    ...apiProxy,
    bypass(req: { headers: { accept?: string } }) {
      if (req.headers.accept?.includes("text/html")) {
        return "/index.html";
      }
    },
  };

  return {
    plugins: [cleanBuildArtifacts(), react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      host: "0.0.0.0",
      port: 8765,
      proxy: {
        ...Object.fromEntries(PROXY_PATHS.map((p) => [p, apiProxy])),
        "^/shadow(?:/|$)": apiProxy,
        // SPA RunDetail page — only the two-segment ``/runs/{id}``
        // form should fall back to ``index.html`` on browser navigation.
        // ``/runs/{id}/code`` and ``/runs/{id}/pine`` are API-only and
        // must keep proxying to the backend even when Accept is text/html.
        "^/runs/[^/]+/?$": apiProxyWithHtmlFallback,
        "/runs": apiProxy,
        "/correlation": apiProxyWithHtmlFallback,
        "^/alpha(?:/|$)": apiProxy,
      },
    },
    build: {
      emptyOutDir: false,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-charts": ["echarts"],
          },
        },
      },
    },
  };
});
