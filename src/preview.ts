import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

interface PreviewOptions {
  dir: string;
  port: number;
  host: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function tryRead(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

function sanitizePathname(pathname: string): string {
  const decoded = decodeURIComponent(pathname || "/");
  const normalized = path.posix.normalize(decoded.startsWith("/") ? decoded : `/${decoded}`);
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function resolveFromRoute(rootDir: string, reqPath: string): string[] {
  const direct = path.join(rootDir, reqPath.slice(1));

  if (reqPath === "/") {
    return [path.join(rootDir, "src", "index.html"), direct];
  }

  if (reqPath === "/manifest.json") {
    return [path.join(rootDir, "manifest.json"), direct];
  }

  if (reqPath.startsWith("/assets/") || reqPath.startsWith("/src/")) {
    return [direct];
  }

  if (reqPath === "/styles.css") {
    return [path.join(rootDir, "src", "styles.css"), direct];
  }

  if (reqPath.endsWith("/styles.css")) {
    const route = reqPath.slice(1, -"styles.css".length - 1).replace(/\/+$/, "");
    if (!route) return [path.join(rootDir, "src", "styles.css"), direct];
    return [path.join(rootDir, "src", "pages", ...route.split("/"), "styles.css"), direct];
  }

  if (reqPath.endsWith(".html")) {
    if (reqPath === "/index.html") return [path.join(rootDir, "src", "index.html"), direct];
    const route = reqPath.slice(1, -".html".length).replace(/\/+$/, "");
    return [
      path.join(rootDir, "src", "pages", ...route.split("/"), "index.html"),
      path.join(rootDir, "src", reqPath.slice(1)),
      direct
    ];
  }

  if (path.extname(reqPath) === "") {
    const route = reqPath.slice(1).replace(/\/+$/, "");
    if (!route) return [path.join(rootDir, "src", "index.html"), direct];
    return [path.join(rootDir, "src", "pages", ...route.split("/"), "index.html"), direct];
  }

  return [direct];
}

export async function startPreviewServer(options: PreviewOptions): Promise<Server> {
  const rootDir = path.resolve(options.dir);

  const server = createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    const reqPath = sanitizePathname(parsedUrl.pathname);

    if (reqPath.includes("..")) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const candidates = resolveFromRoute(rootDir, reqPath);

    for (const filePath of candidates) {
      const data = await tryRead(filePath);
      if (!data) continue;
      res.statusCode = 200;
      res.setHeader("Content-Type", contentTypeFor(filePath));
      res.end(data);
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  return server;
}
