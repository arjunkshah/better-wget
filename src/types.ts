export type ExportMode = "clean" | "mirror";

export interface ExtractOptions {
  url: string;
  outDir: string;
  mode: ExportMode;
  everything?: boolean;
  timeoutMs: number;
  crawlDepth: number;
  maxPages: number;
  userAgent?: string;
}

export interface AssetRecord {
  url: string;
  kind: "stylesheet" | "script" | "image" | "font" | "other";
  savedPath: string;
  skipped?: string;
}

export interface ExtractSummary {
  url: string;
  outDir: string;
  htmlPath: string;
  cssPath?: string;
  pageCount: number;
  pages: Array<{
    url: string;
    htmlPath: string;
    cssPath: string;
  }>;
  assets: AssetRecord[];
  warnings: string[];
}
