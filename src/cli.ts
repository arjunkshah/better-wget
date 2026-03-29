#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { extractFrontend } from "./extractor.js";
import type { ExportMode } from "./types.js";

interface CliOptions {
  out: string;
  mode: string;
  timeout: string;
  depth: string;
  maxPages: string;
  userAgent?: string;
}

async function runExtraction(url: string, opts: CliOptions): Promise<void> {
  const mode = String(opts.mode) as ExportMode;
  if (mode !== "clean" && mode !== "mirror") {
    console.error(`Invalid mode: ${opts.mode}. Use clean or mirror.`);
    process.exit(1);
  }

  const outDir = path.resolve(String(opts.out));
  const timeoutMs = Number(opts.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    console.error(`Invalid timeout: ${opts.timeout}`);
    process.exit(1);
  }

  const crawlDepth = Number(opts.depth);
  if (!Number.isFinite(crawlDepth) || crawlDepth < 0) {
    console.error(`Invalid depth: ${opts.depth}`);
    process.exit(1);
  }

  const maxPages = Number(opts.maxPages);
  if (!Number.isFinite(maxPages) || maxPages < 1) {
    console.error(`Invalid max-pages: ${opts.maxPages}`);
    process.exit(1);
  }

  console.log(`Extracting ${url}`);
  console.log(`Mode: ${mode}`);
  console.log(`Depth: ${crawlDepth}`);
  console.log(`Max pages: ${maxPages}`);
  console.log(`Output: ${outDir}`);

  try {
    const summary = await extractFrontend({
      url,
      outDir,
      mode,
      timeoutMs,
      crawlDepth,
      maxPages,
      userAgent: opts.userAgent ? String(opts.userAgent) : undefined
    });

    console.log("\nDone.");
    console.log(`Root HTML: ${summary.htmlPath}`);
    if (summary.cssPath) {
      console.log(`Root CSS:  ${summary.cssPath}`);
    }
    console.log(`Pages exported: ${summary.pageCount}`);
    console.log(`Assets downloaded: ${summary.assets.length}`);

    if (summary.warnings.length > 0) {
      console.log("\nWarnings:");
      for (const warning of summary.warnings) {
        console.log(`- ${warning}`);
      }
    }
  } catch (error) {
    console.error("Extraction failed:");
    console.error(error);
    process.exit(1);
  }
}

const defaultOptions: CliOptions = {
  out: "./output",
  mode: "clean",
  timeout: "60000",
  depth: "3",
  maxPages: "100"
};

const invokedAs = path.basename(fileURLToPath(import.meta.url));
const argv0 = path.basename(process.argv[1] || "");
const isScrapify = argv0 === "scrapify" || invokedAs === "scrapify.js";

if (isScrapify) {
  const program = new Command();
  program
    .name("scrapify")
    .description("Scrape a site into clean editable frontend code")
    .argument("<url>", "Website URL")
    .option("-o, --out <dir>", "Output directory", defaultOptions.out)
    .option("-m, --mode <mode>", "Export mode: clean or mirror", defaultOptions.mode)
    .option("-t, --timeout <ms>", "Timeout in milliseconds", defaultOptions.timeout)
    .option("-d, --depth <n>", "Internal link crawl depth", defaultOptions.depth)
    .option("--max-pages <n>", "Maximum pages to crawl", defaultOptions.maxPages)
    .option("--user-agent <ua>", "Custom user agent")
    .action(async (url, opts) => {
      await runExtraction(url, opts as CliOptions);
    });

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  const program = new Command();
  program
    .name("better-wget")
    .description("Capture clean, editable frontend code from a live website")
    .version("0.1.0");

  program
    .command("frontend")
    .description("Export a frontend snapshot as clean HTML/CSS/assets")
    .argument("<url>", "Website URL")
    .option("-o, --out <dir>", "Output directory", defaultOptions.out)
    .option("-m, --mode <mode>", "Export mode: clean or mirror", defaultOptions.mode)
    .option("-t, --timeout <ms>", "Timeout in milliseconds", defaultOptions.timeout)
    .option("-d, --depth <n>", "Internal link crawl depth", defaultOptions.depth)
    .option("--max-pages <n>", "Maximum pages to crawl", defaultOptions.maxPages)
    .option("--user-agent <ua>", "Custom user agent")
    .action(async (url, opts) => {
      await runExtraction(url, opts as CliOptions);
    });

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
