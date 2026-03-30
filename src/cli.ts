#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { Command } from "commander";

import { extractFrontend } from "./extractor.js";
import { startPreviewServer } from "./preview.js";
import type { ExportMode } from "./types.js";

interface CliOptions {
  out: string;
  mode: string;
  everything?: boolean;
  strictClean?: boolean;
  singlePage?: boolean;
  timeout: string;
  depth: string;
  maxPages: string;
  userAgent?: string;
  saveDefault?: boolean;
  quiet?: boolean;
}

interface RunOptions {
  port: string;
  host: string;
}

interface StoredConfig {
  defaultUrl?: string;
  mode?: "clean" | "mirror";
  out?: string;
  everything?: boolean;
  strictClean?: boolean;
  timeout?: string;
  depth?: string;
  maxPages?: string;
}

const CONFIG_PATH = path.join(os.homedir(), ".cleanscrape", "config.json");

async function readConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return {};
  }
}

async function writeConfig(config: StoredConfig): Promise<void> {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function setDefaultUrl(url: string): Promise<void> {
  const config = await readConfig();
  config.defaultUrl = url;
  await writeConfig(config);
}

async function askInteractive(promptLabel: string, fallback = ""): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const suffix = fallback ? ` [${fallback}]` : "";
    const answer = (await rl.question(`${promptLabel}${suffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function askYesNo(promptLabel: string, fallback: boolean): Promise<boolean> {
  const defaultText = fallback ? "Y/n" : "y/N";
  const answer = (await askInteractive(`${promptLabel} (${defaultText})`, "")).toLowerCase();
  if (!answer) return fallback;
  return answer === "y" || answer === "yes";
}

async function resolveInteractiveRun(
  urlArg: string | undefined,
  opts: CliOptions,
  config: StoredConfig
): Promise<{ url: string; opts: CliOptions }> {
  const modeDefault = String(opts.mode || config.mode || "clean");
  const outDefault = String(opts.out || config.out || "./output");
  const timeoutDefault = String(opts.timeout || config.timeout || "60000");
  const depthDefault = String(opts.depth || config.depth || "3");
  const maxPagesDefault = String(opts.maxPages || config.maxPages || "100");
  const everythingDefault =
    typeof opts.everything === "boolean" ? opts.everything : typeof config.everything === "boolean" ? config.everything : true;
  const strictDefault =
    typeof opts.strictClean === "boolean" ? opts.strictClean : typeof config.strictClean === "boolean" ? config.strictClean : false;

  if (urlArg) {
    return {
      url: urlArg,
      opts: {
        ...opts,
        mode: String(opts.mode || config.mode || "clean"),
        out: String(opts.out || config.out || "./output"),
        timeout: String(opts.timeout || config.timeout || "60000"),
        depth: String(opts.depth || config.depth || "3"),
        maxPages: String(opts.maxPages || config.maxPages || "100"),
        everything: typeof opts.everything === "boolean" ? opts.everything : config.everything ?? true,
        strictClean: typeof opts.strictClean === "boolean" ? opts.strictClean : config.strictClean ?? false
      }
    };
  }

  const url = await askInteractive("Website URL (example: https://your-app.vercel.app)", config.defaultUrl || "");
  if (!url) {
    console.error("No URL provided.");
    process.exit(1);
  }

  let mode = modeDefault;
  while (mode !== "clean" && mode !== "mirror") {
    mode = await askInteractive("Mode (clean|mirror)", "clean");
  }

  const out = await askInteractive("Output directory", outDefault);
  const timeout = await askInteractive("Timeout (ms)", timeoutDefault);
  const depth = await askInteractive("Crawl depth", depthDefault);
  const maxPages = await askInteractive("Max pages", maxPagesDefault);
  const everything = await askYesNo("Capture everything", everythingDefault);
  const strictClean = await askYesNo("Enable strict clean", strictDefault);
  const saveDefault = await askYesNo("Save these as defaults", false);

  const mergedOpts: CliOptions = {
    ...opts,
    mode,
    out,
    timeout,
    depth,
    maxPages,
    everything,
    strictClean,
    saveDefault
  };

  return { url, opts: mergedOpts };
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

  const crawlDepthRaw = Number(opts.depth);
  const maxPagesRaw = Number(opts.maxPages);

  const crawlDepth = opts.singlePage ? 0 : crawlDepthRaw;
  const maxPages = opts.singlePage ? 1 : maxPagesRaw;

  if (!Number.isFinite(crawlDepth) || crawlDepth < 0) {
    console.error(`Invalid depth: ${opts.depth}`);
    process.exit(1);
  }

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
  if (opts.singlePage) {
    console.log("Single page: yes");
  }
  console.log(`Output: ${outDir}`);

  try {
    const summary = await extractFrontend({
      url,
      outDir,
      mode,
      everything: opts.everything !== false,
      strictClean: Boolean(opts.strictClean),
      onProgress: opts.quiet ? undefined : (message) => console.log(message),
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

    if (opts.saveDefault) {
      await writeConfig({
        defaultUrl: url,
        mode,
        out: opts.out,
        everything: opts.everything !== false,
        strictClean: Boolean(opts.strictClean),
        timeout: opts.timeout,
        depth: opts.depth,
        maxPages: opts.maxPages
      });
      console.log(`Saved defaults to ${CONFIG_PATH}`);
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
const activeCliName = cliAliases.has(argv0) ? argv0 : "cleanscrape";
const isScrapify = cliAliases.has(argv0) || cliAliases.has(invokedAs.replace(/\.js$/, ""));

if (isScrapify) {
  if (process.argv[2] === "default") {
    const defaultProgram = new Command();
    defaultProgram
      .name(`${activeCliName} default`)
      .description("Set default URL used by interactive mode")
      .argument("[url]", "Default website URL")
      .action(async (url) => {
        const resolved = typeof url === "string" && url.trim() ? url.trim() : await askInteractive("Default URL");
        if (!resolved) {
          console.error("No default URL provided.");
          process.exit(1);
        }
        await setDefaultUrl(resolved);
        console.log(`Default URL set: ${resolved}`);
        console.log(`Config: ${CONFIG_PATH}`);
      });

    defaultProgram.parseAsync(["node", activeCliName, ...process.argv.slice(3)]).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else if (process.argv[2] === "help") {
    const helpProgram = new Command();
    helpProgram
      .name(activeCliName)
      .description("Scrape a site into clean editable frontend code")
      .argument("[url]", "Website URL")
      .option("-o, --out <dir>", "Output directory", defaultOptions.out)
      .option("-m, --mode <mode>", "Export mode: clean or mirror", defaultOptions.mode)
      .option("--everything", "Capture all discoverable assets/code and keep scripts")
      .option("--no-everything", "Disable full capture mode")
      .option("--strict-clean", "Aggressively strip noisy attributes/comments for cleaner manual edits")
      .option("--single-page", "Scrape only the provided page (no internal page crawl)")
      .option("--quiet", "Hide per-file streaming logs")
      .option("--save-default", "Save this run's URL/options as defaults")
      .option("-t, --timeout <ms>", "Timeout in milliseconds", defaultOptions.timeout)
      .option("-d, --depth <n>", "Internal link crawl depth", defaultOptions.depth)
      .option("--max-pages <n>", "Maximum pages to crawl", defaultOptions.maxPages)
      .option("--user-agent <ua>", "Custom user agent");
    helpProgram.outputHelp();
    process.exit(0);
  } else if (process.argv[2] === "run") {
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
      .argument("[url]", "Website URL")
      .option("-o, --out <dir>", "Output directory", defaultOptions.out)
      .option("-m, --mode <mode>", "Export mode: clean or mirror", defaultOptions.mode)
      .option("--everything", "Capture all discoverable assets/code and keep scripts")
      .option("--no-everything", "Disable full capture mode")
      .option("--strict-clean", "Aggressively strip noisy attributes/comments for cleaner manual edits")
      .option("--single-page", "Scrape only the provided page (no internal page crawl)")
      .option("--quiet", "Hide per-file streaming logs")
      .option("--save-default", "Save this run's URL/options as defaults")
      .option("-t, --timeout <ms>", "Timeout in milliseconds", defaultOptions.timeout)
      .option("-d, --depth <n>", "Internal link crawl depth", defaultOptions.depth)
      .option("--max-pages <n>", "Maximum pages to crawl", defaultOptions.maxPages)
      .option("--user-agent <ua>", "Custom user agent")
      .action(async (url, opts) => {
        const config = await readConfig();
        const resolved = await resolveInteractiveRun(
          typeof url === "string" && url.trim() ? url.trim() : undefined,
          opts as CliOptions,
          config
        );
        await runExtraction(resolved.url, resolved.opts);
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
