import { createServer, request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("dist/web"),
  port = Number(process.env.WEB_PORT ?? 4317),
  api = new URL(process.env.API_URL ?? "http://127.0.0.1:4318");
const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), xr-spatial-tracking=(self)",
  "Cross-Origin-Opener-Policy": "same-origin",
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
createServer(async (req, res) => {
  for (const [name, value] of Object.entries(headers))
    res.setHeader(name, value);
  if (req.url?.startsWith("/v1/") || req.url === "/health") {
    const proxy = request(
      new URL(req.url, api),
      { method: req.method, headers: { ...req.headers, host: api.host } },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502);
      res.end("API unavailable");
    });
    req.pipe(proxy);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://local").pathname,
    );
    if (pathname.includes("\\") || pathname.includes("\0")) throw Error();
    let path = resolve(root, "." + pathname);
    if (path !== root && !path.startsWith(root + sep)) throw Error();
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const bytes = await readFile(path);
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      "Cache-Control":
        extname(path) === ".html" ? "no-store" : "public, max-age=86400",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, process.env.WEB_HOST ?? "127.0.0.1", () =>
  process.stdout.write(`Orbital http://127.0.0.1:${port}\n`),
);
