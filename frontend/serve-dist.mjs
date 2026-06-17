import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8765);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = process.env.STATIC_ROOT ? resolve(process.env.STATIC_ROOT) : join(scriptDir, "dist");
const tradingViewRoot = process.env.TRADINGVIEW_ROOT
  ? resolve(process.env.TRADINGVIEW_ROOT)
  : join(scriptDir, "lightweight-charts", "website", "build");
const apiTarget = process.env.API_URL || process.env.VITE_API_URL || "http://127.0.0.1:8899";

const apiPrefixes = [
  "/alpha",
  "/auth",
  "/correlation",
  "/crypto",
  "/health",
  "/live",
  "/mandate",
  "/runs",
  "/sessions",
  "/settings/data-sources",
  "/settings/llm",
  "/shadow-reports",
  "/strategies",
  "/swarm/presets",
  "/swarm/runs",
  "/upload",
];

const spaHtmlExactPaths = new Set([
  "/correlation",
  "/strategies",
]);

const spaHtmlPathPatterns = [
  /^\/runs\/[^/]+\/?$/,
];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".vue": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

function resolveRequestPath(urlPath) {
  return resolveStaticRequestPath(urlPath, root);
}

function resolveStaticRequestPath(urlPath, staticRoot) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0] || "/");
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(join(staticRoot, safePath));

  if (!candidate.startsWith(staticRoot)) {
    return join(staticRoot, "index.html");
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  const htmlCandidate = `${candidate}.html`;
  if (existsSync(htmlCandidate) && statSync(htmlCandidate).isFile()) {
    return htmlCandidate;
  }

  const indexCandidate = join(candidate, "index.html");
  if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
    return indexCandidate;
  }

  return join(staticRoot, "index.html");
}

function resolveTradingViewRequestPath(urlPath) {
  const pathname = new URL(urlPath || "/", "http://localhost").pathname;
  const relativePath = pathname === "/tradingview"
    ? "/"
    : pathname.replace(/^\/tradingview\/?/, "/");
  return resolveStaticRequestPath(relativePath, tradingViewRoot);
}

function acceptsHtml(request) {
  return request.method === "GET" && request.headers.accept?.includes("text/html");
}

function isSpaHtmlRoute(urlPath) {
  const pathname = new URL(urlPath || "/", "http://localhost").pathname;
  if (spaHtmlExactPaths.has(pathname)) {
    return true;
  }
  return spaHtmlPathPatterns.some((pattern) => pattern.test(pathname));
}

function isApiRequest(request) {
  if (acceptsHtml(request) && isSpaHtmlRoute(request.url)) {
    return false;
  }

  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  return apiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isTradingViewRequest(urlPath) {
  const pathname = new URL(urlPath || "/", "http://localhost").pathname;
  return pathname === "/tradingview" || pathname.startsWith("/tradingview/");
}

function proxyApiRequest(request, response) {
  const target = new URL(request.url || "/", apiTarget);
  const headers = { ...request.headers, host: target.host };

  const upstream = fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
    duplex: "half",
    redirect: "manual",
  });

  upstream
    .then((upstreamResponse) => {
      response.writeHead(
        upstreamResponse.status,
        Object.fromEntries(upstreamResponse.headers.entries()),
      );
      if (!upstreamResponse.body) {
        response.end();
        return;
      }
      upstreamResponse.body.pipeTo(
        new WritableStream({
          write(chunk) {
            response.write(chunk);
          },
          close() {
            response.end();
          },
          abort(error) {
            response.destroy(error);
          },
        }),
      );
    })
    .catch((error) => {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ detail: `API proxy failed: ${error.message}` }));
    });
}

const server = createServer((request, response) => {
  if (isApiRequest(request)) {
    proxyApiRequest(request, response);
    return;
  }

  const filePath = isTradingViewRequest(request.url)
    ? resolveTradingViewRequestPath(request.url || "/")
    : resolveRequestPath(request.url || "/");
  if (!existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Static file not found: ${filePath}`);
    return;
  }

  const contentType = contentTypes[extname(filePath)] || "application/octet-stream";

  response.writeHead(200, {
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Type": contentType,
  });

  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
  console.log(`Proxying API requests to ${apiTarget}`);
});
