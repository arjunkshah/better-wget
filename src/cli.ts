#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { extractFrontend } from "./extractor.js";
import { startPreviewServer } from "./preview.js";
import type { ExportMode } from "./types.js";

interface CliOptions {
  out: string;
  mode: string;
  everything?: boolean;
  strictClean?: boolean;
  timeout: string;
  depth: string;
  maxPages: string;
  userAgent?: string;
}

interface RunOptions {
  port: string;
  host: string;
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
  console.log(`Everything: ${opts.everything !== false ? "yes" : "no"}`);
  console.log(`Strict clean: ${opts.strictClean ? "yes" : "no"}`);
  console.log(`Depth: ${crawlDepth}`);
  console.log(`Max pages: ${maxPages}`);
  console.log(`Output: ${outDir}`);

  try {
    const summary = await extractFrontend({
      url,
      outDir,
      mode,
      everything: opts.everything !== false,
      strictClean: Boolean(opts.strictClean),
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
    console.log(
      `Verify: pages=${summary.verification.pages} assets=${summary.verification.assets} scripts=${summary.verification.scripts} styles=${summary.verification.stylesheets} fonts=${summary.verification.fonts} images=${summary.verification.images} others=${summary.verification.others} remote_urls_remaining=${summary.verification.remoteUrlsRemaining}`
    );

    if (summary.warnings.length > 0) {
      console.log("\nWarnings:");
      for (const warning of summary.warnings) {
        console.log(`- ${warning}`);
      }
    }

    console.log(`\nPreview with: cleanscrape run ${outDir}`);
  } catch (error) {
    console.error("Extraction failed:");
    console.error(error);
    process.exit(1);
  }
}

async function runPreview(dirArg: string | undefined, opts: RunOptions): Promise<void> {
  const dir = path.resolve(dirArg || "./output");
  const port = Number(opts.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${opts.port}`);
    process.exit(1);
  }

  const host = String(opts.host || "127.0.0.1");
  const server = await startPreviewServer({ dir, port, host });

  console.log(`Serving scraped site from ${dir}`);
  console.log(`Open: http://${host}:${port}`);
  console.log("Press Ctrl+C to stop.");

  const stop = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const defaultOptions: CliOptions = {
  out: "./output",
  mode: "clean",
  everything: true,
  timeout: "60000",
  depth: "3",
  maxPages: "100"
};

const invokedAs = path.basename(fileURLToPath(import.meta.url));
const argv0 = path.basename(process.argv[1] || "");
const cliAliases = new Set(["scrapify", "scraper", "cleanscrape"]);
const activeCliName = cliAliases.has(argv0) ? argv0 : "scrapify";
const isScrapify = cliAliases.has(argv0) || cliAliases.has(invokedAs.replace(/\.js$/, ""));

if (isScrapify) {
  if (process.argv[2] === "help") {
    const helpProgram = new Command();
    helpProgram
      .name(activeCliName)
      .description("Scrape a site into clean editable frontend code")
      .argument("<url>", "Website URL")
      .option("-o, --out <dir>", "Output directory", defaultOptions.out)
      .option("-m, --mode <mode>", "Export mode: clean or mirror", defaultOptions.mode)
      .option("--everything", "Capture all discoverable assets/code and keep scripts")
      .option("--no-everything", "Disable full capture mode")
      .option("--strict-clean", "Aggressively strip noisy attributes/comments for cleaner manual edits")
      .option("-t, --timeout <ms>", "Timeout in milliseconds", defaultOptions.timeout)
      .option("-d, --depth <n>", "Internal link crawl depth", defaultOptions.depth)
      .option("--max-pages <n>", "Maximum pages to crawl", defaultOptions.maxPages)
      .option("--user-agent <ua>", "Custom user agent");
    helpProgram.outputHelp();
    process.exit(0);
  }

  if (process.argv[2] === "run") {
    const runProgram = new Command();
    runProgram
      .name(`${activeCliName} run`)
      .description("Serve a scraped output folder locally")
      .argument("[dir]", "Scraped output directory", "./output")
      .option("-p, --port <port>", "Port", "4173")
      .option("--host <host>", "Host", "127.0.0.1")
      .action(async (dir, opts) => {
        await runPreview(typeof dir === "string" ? dir : undefined, opts as RunOptions);
      });

    runProgram.parseAsync(["node", activeCliName, ...process.argv.slice(3)]).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    const program = new Command();
    program
      .name(activeCliName)
      .description("Scrape a site into clean editable frontend code")
      .argument("<url>", "Website URL")
      .option("-o, --out <dir>", "Output directory", defaultOptions.out)
      .option("-m, --mode <mode>", "Export mode: clean or mirror", defaultOptions.mode)
      .option("--everything", "Capture all discoverable assets/code and keep scripts")
      .option("--no-everything", "Disable full capture mode")
      .option("--strict-clean", "Aggressively strip noisy attributes/comments for cleaner manual edits")
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
    .option("--everything", "Capture all discoverable assets/code and keep scripts")
    .option("--no-everything", "Disable full capture mode")
    .option("--strict-clean", "Aggressively strip noisy attributes/comments for cleaner manual edits")
    .option("-t, --timeout <ms>", "Timeout in milliseconds", defaultOptions.timeout)
    .option("-d, --depth <n>", "Internal link crawl depth", defaultOptions.depth)
    .option("--max-pages <n>", "Maximum pages to crawl", defaultOptions.maxPages)
    .option("--user-agent <ua>", "Custom user agent")
    .action(async (url, opts) => {
      await runExtraction(url, opts as CliOptions);
    });

  program
    .command("run")
    .description("Serve a scraped output folder locally")
    .argument("[dir]", "Scraped output directory", "./output")
    .option("-p, --port <port>", "Port", "4173")
    .option("--host <host>", "Host", "127.0.0.1")
    .action(async (dir, opts) => {
      await runPreview(typeof dir === "string" ? dir : undefined, opts as RunOptions);
    });

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
