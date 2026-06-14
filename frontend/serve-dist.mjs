import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8765);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = process.env.STATIC_ROOT ? resolve(process.env.STATIC_ROOT) : join(scriptDir, "dist");
const apiTarget = process.env.API_URL || process.env.VITE_API_URL || "http://127.0.0.1:8899";

const apiPrefixes = [
  "/alpha",
  "/health",
];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0] || "/");
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(join(root, safePath));

  if (!candidate.startsWith(root)) {
    return join(root, "index.html");
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return join(root, "index.html");
}

function isApiRequest(urlPath) {
  const pathname = new URL(urlPath || "/", "http://localhost").pathname;
  return apiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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
  if (isApiRequest(request.url)) {
    proxyApiRequest(request, response);
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");
  if (!existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Static file not found: ${filePath}`);
    return;
  }

  const contentType = contentTypes[extname(filePath)] || "application/octet-stream";

  response.writeHead(200, {
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Type": contentType,
  });

  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
  console.log(`Proxying API requests to ${apiTarget}`);
});
