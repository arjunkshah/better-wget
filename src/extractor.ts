import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

import { load } from "cheerio";
import prettier from "prettier";

import type { AssetRecord, ExtractOptions, ExtractSummary } from "./types.js";

const TRACKER_HOST_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "segment.com",
  "mixpanel.com",
  "hotjar.com",
  "sentry.io"
];

const NON_HTML_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".avif",
  ".pdf",
  ".zip",
  ".gz",
  ".rar",
  ".7z",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml"
]);

interface PagePaths {
  htmlPath: string;
  cssPath: string;
  routeKey: string;
}

function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizePageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";

    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return null;
  }
}

function toSafeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "asset";
}

async function formatMaybe(content: string, parser: "html" | "css"): Promise<string> {
  try {
    return await prettier.format(content, { parser });
  } catch {
    return content;
  }
}

async function saveTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function buildAssetFilePath(assetUrl: string, outputRoot: string, fallbackExt = ""): string {
  const urlObj = new URL(assetUrl);
  const ext = path.extname(urlObj.pathname) || fallbackExt;
  const base = toSafeFileName(path.basename(urlObj.pathname, ext) || "asset");
  const host = toSafeFileName(urlObj.hostname);
  const dir = path.join(outputRoot, "assets", host);
  return path.join(dir, `${base}${ext}`);
}

function getPagePaths(pageUrl: string, outDir: string): PagePaths {
  const u = new URL(pageUrl);
  const segments = u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => toSafeFileName(s));

  if (segments.length === 0) {
    return {
      routeKey: "/",
      htmlPath: path.join(outDir, "src", "index.html"),
      cssPath: path.join(outDir, "src", "styles.css")
    };
  }

  const dir = path.join(outDir, "src", "pages", ...segments);
  return {
    routeKey: `/${segments.join("/")}`,
    htmlPath: path.join(dir, "index.html"),
    cssPath: path.join(dir, "styles.css")
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number, userAgent?: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          userAgent ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadTextAsset(
  assetUrl: string,
  outDir: string,
  timeoutMs: number,
  userAgent: string | undefined,
  fallbackExt: string,
  assetMap: Map<string, string>
): Promise<{ savedPath: string; text: string } | null> {
  const existingPath = assetMap.get(assetUrl);
  if (existingPath) {
    const res = await fetchWithTimeout(assetUrl, timeoutMs, userAgent);
    if (!res.ok) return null;
    return { savedPath: existingPath, text: await res.text() };
  }

  const res = await fetchWithTimeout(assetUrl, timeoutMs, userAgent);
  if (!res.ok) return null;

  const text = await res.text();
  const targetPath = buildAssetFilePath(assetUrl, outDir, fallbackExt);
  await saveTextFile(targetPath, text);

  const savedPath = path.relative(outDir, targetPath);
  assetMap.set(assetUrl, savedPath);
  return { savedPath, text };
}

async function downloadBinaryAsset(
  assetUrl: string,
  outDir: string,
  timeoutMs: number,
  userAgent: string | undefined,
  assetMap: Map<string, string>
): Promise<string | null> {
  const existingPath = assetMap.get(assetUrl);
  if (existingPath) return existingPath;

  const res = await fetchWithTimeout(assetUrl, timeoutMs, userAgent);
  if (!res.ok) return null;

  const bytes = Buffer.from(await res.arrayBuffer());
  const targetPath = buildAssetFilePath(assetUrl, outDir);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);

  const savedPath = path.relative(outDir, targetPath);
  assetMap.set(assetUrl, savedPath);
  return savedPath;
}

function maybeAddAsset(
  assets: AssetRecord[],
  seen: Set<string>,
  record: AssetRecord
): void {
  const key = `${record.kind}:${record.savedPath}`;
  if (seen.has(key)) return;
  seen.add(key);
  assets.push(record);
}

function isSameOriginHtmlLink(candidateUrl: string, rootOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (parsed.origin !== rootOrigin) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const ext = path.extname(parsed.pathname.toLowerCase());
  if (ext && NON_HTML_EXTENSIONS.has(ext)) return false;

  return true;
}

function toRelativeWebPath(fromDir: string, toPath: string): string {
  const rel = path.relative(fromDir, toPath).split(path.sep).join("/");
  if (rel === "") return "./";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export async function extractFrontend(options: ExtractOptions): Promise<ExtractSummary> {
  const outDir = path.resolve(options.outDir);
  await mkdir(path.join(outDir, "src"), { recursive: true });

  const normalizedRootUrl = normalizePageUrl(options.url);
  if (!normalizedRootUrl) {
    throw new Error(`Invalid URL: ${options.url}`);
  }

  const rootOrigin = new URL(normalizedRootUrl).origin;
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizedRootUrl, depth: 0 }];
  const visited = new Set<string>();

  const assets: AssetRecord[] = [];
  const warnings: string[] = [];
  const pages: Array<{ url: string; htmlPath: string; cssPath: string }> = [];

  const assetMap = new Map<string, string>();
  const seenAssetRecords = new Set<string>();

  while (queue.length > 0 && visited.size < options.maxPages) {
    const current = queue.shift();
    if (!current) break;
    if (visited.has(current.url)) continue;

    visited.add(current.url);

    let htmlRes: Response;
    try {
      htmlRes = await fetchWithTimeout(current.url, options.timeoutMs, options.userAgent);
    } catch (error) {
      warnings.push(`Failed to fetch page: ${current.url} (${String(error)})`);
      continue;
    }

    if (!htmlRes.ok) {
      warnings.push(`Failed to fetch page: ${current.url} (HTTP ${htmlRes.status})`);
      continue;
    }

    const contentType = htmlRes.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      warnings.push(`Skipped non-HTML page: ${current.url} (${contentType || "unknown content-type"})`);
      continue;
    }

    const domHtml = await htmlRes.text();
    const $ = load(domHtml);

    if (current.depth < options.crawlDepth) {
      const discovered = new Set<string>();
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
          return;
        }

        const absolute = normalizeUrl(href, current.url);
        if (!absolute) return;
        const normalized = normalizePageUrl(absolute);
        if (!normalized) return;
        if (!isSameOriginHtmlLink(normalized, rootOrigin)) return;
        if (visited.has(normalized) || discovered.has(normalized)) return;

        discovered.add(normalized);
        queue.push({ url: normalized, depth: current.depth + 1 });
      });
    }

    const pagePaths = getPagePaths(current.url, outDir);
    const pageDir = path.dirname(pagePaths.htmlPath);

    const cssBlocks: string[] = [];
    $("style").each((_, el) => {
      const text = $(el).html();
      if (text?.trim()) cssBlocks.push(text.trim());
    });

    const stylesheetLinks = $("link[rel='stylesheet']").toArray();
    for (const el of stylesheetLinks) {
      const href = $(el).attr("href");
      if (!href) continue;
      const absolute = normalizeUrl(href, current.url);
      if (!absolute) continue;

      try {
        const result = await downloadTextAsset(
          absolute,
          outDir,
          options.timeoutMs,
          options.userAgent,
          ".css",
          assetMap
        );
        if (!result) {
          warnings.push(`Failed to fetch stylesheet: ${absolute}`);
          continue;
        }

        cssBlocks.push(result.text);
        maybeAddAsset(assets, seenAssetRecords, {
          url: absolute,
          kind: "stylesheet",
          savedPath: result.savedPath
        });
      } catch (error) {
        warnings.push(`Failed to fetch stylesheet: ${absolute} (${String(error)})`);
      }
    }

    $("style").remove();
    $("link[rel='stylesheet']").remove();

    const cssHref = toRelativeWebPath(pageDir, pagePaths.cssPath);
    $("head").append(`<link rel="stylesheet" href="${cssHref}">`);

    const mediaNodes = $("img[src], source[src], source[srcset], video[poster]").toArray();
    for (const el of mediaNodes) {
      if ($(el).attr("srcset") !== undefined) {
        const srcsetValue = $(el).attr("srcset") || "";
        const first = srcsetValue
          .split(",")
          .map((item) => item.trim().split(/\s+/)[0])
          .find(Boolean);
        if (first) {
          $(el).attr("src", first);
        }
        $(el).removeAttr("srcset");
      }

      const attr = $(el).attr("src") !== undefined ? "src" : "poster";
      const value = $(el).attr(attr);
      if (!value) continue;

      const absolute = normalizeUrl(value, current.url);
      if (!absolute) continue;

      try {
        const savedPath = await downloadBinaryAsset(absolute, outDir, options.timeoutMs, options.userAgent, assetMap);
        if (!savedPath) {
          warnings.push(`Failed to fetch media: ${absolute}`);
          continue;
        }

        const localPath = path.join(outDir, savedPath);
        const rel = toRelativeWebPath(pageDir, localPath);
        $(el).attr(attr, rel);

        maybeAddAsset(assets, seenAssetRecords, {
          url: absolute,
          kind: "image",
          savedPath
        });
      } catch (error) {
        warnings.push(`Failed to fetch media: ${absolute} (${String(error)})`);
      }
    }

    if (options.mode === "clean") {
      $("script").remove();
      $("noscript").remove();
      $("*[data-reactroot], *[data-reactid], *[data-v-app], *[ng-version]").removeAttr(
        "data-reactroot data-reactid data-v-app ng-version"
      );
    } else {
      const scripts = $("script[src]").toArray();
      for (const el of scripts) {
        const src = $(el).attr("src");
        if (!src) continue;
        const absolute = normalizeUrl(src, current.url);
        if (!absolute) continue;

        try {
          const host = new URL(absolute).hostname;
          if (TRACKER_HOST_PATTERNS.some((pattern) => host.includes(pattern))) {
            $(el).remove();
            continue;
          }
        } catch {
          // ignore parse failures
        }

        try {
          const result = await downloadTextAsset(
            absolute,
            outDir,
            options.timeoutMs,
            options.userAgent,
            ".js",
            assetMap
          );
          if (!result) {
            warnings.push(`Failed to fetch script: ${absolute}`);
            continue;
          }

          const localPath = path.join(outDir, result.savedPath);
          const rel = toRelativeWebPath(pageDir, localPath);
          $(el).attr("src", rel);

          maybeAddAsset(assets, seenAssetRecords, {
            url: absolute,
            kind: "script",
            savedPath: result.savedPath
          });
        } catch (error) {
          warnings.push(`Failed to fetch script: ${absolute} (${String(error)})`);
        }
      }
    }

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
        return;
      }

      const absolute = normalizeUrl(href, current.url);
      if (!absolute) return;
      const normalized = normalizePageUrl(absolute);
      if (!normalized) return;
      if (!isSameOriginHtmlLink(normalized, rootOrigin)) return;

      const targetPage = getPagePaths(normalized, outDir);
      const targetHtml = targetPage.htmlPath;
      const relHref = toRelativeWebPath(pageDir, targetHtml);
      $(el).attr("href", relHref);
    });

    const cssMerged = cssBlocks.join("\n\n");
    const finalHtml = $.html();

    await saveTextFile(pagePaths.htmlPath, await formatMaybe(finalHtml, "html"));
    await saveTextFile(pagePaths.cssPath, await formatMaybe(cssMerged, "css"));

    pages.push({
      url: current.url,
      htmlPath: path.relative(outDir, pagePaths.htmlPath),
      cssPath: path.relative(outDir, pagePaths.cssPath)
    });
  }

  await saveTextFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        sourceUrl: options.url,
        mode: options.mode,
        exportedAt: new Date().toISOString(),
        crawlDepth: options.crawlDepth,
        maxPages: options.maxPages,
        pageCount: pages.length,
        pages,
        assetCount: assets.length,
        warnings
      },
      null,
      2
    )
  );

  const rootPagePaths = getPagePaths(normalizedRootUrl, outDir);

  return {
    url: options.url,
    outDir,
    htmlPath: rootPagePaths.htmlPath,
    cssPath: rootPagePaths.cssPath,
    pageCount: pages.length,
    pages,
    assets,
    warnings
  };
}
