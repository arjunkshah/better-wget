# better-wget

`better-wget` is a frontend-first alternative to wget/curl for design and product work.

Instead of dumping low-quality scraped output, it crawls a live site and exports:

- cleaned, formatted HTML
- merged, editable CSS
- downloaded image/font/media assets
- a machine-readable `manifest.json`

## Why this exists

Traditional download tools optimize for raw bytes. This tool optimizes for **clean editable frontend code**.

## Install

```bash
# global install
npm install -g cleanscrape

# local development
npm install
npm run build
npm link
```

## Usage

```bash
# direct command
cleanscrape https://example.com -o ./output/example

# interactive mode (prompts for URL/mode/etc.)
cleanscrape

# set and reuse a default URL (for example a Vercel URL)
cleanscrape default https://your-app.vercel.app

# run the scraped site locally
cleanscrape run ./output/example --port 4173

# same preview server via npm script
npm run dev

# everything mode is now default; disable with --no-everything
cleanscrape https://example.com -o ./output/example --mode clean

# strict clean pass for ultra-editable output
cleanscrape https://example.com -o ./output/example --strict-clean

# save this run as your default template
cleanscrape https://example.com --save-default

# whole-site clean crawl (default): follows internal links and strips scripts/tracker junk
node dist/cli.js frontend https://example.com -o ./output/example --mode clean

# mirror mode: keeps script tags and fetches script files when possible
node dist/cli.js frontend https://example.com -o ./output/example-mirror --mode mirror

# tune crawl scope
node dist/cli.js frontend https://example.com -o ./output/example --depth 4 --max-pages 250
```

## Output structure

```text
output/example/
  manifest.json
  src/
    index.html
    styles.css
    pages/
      about/
        index.html
        styles.css
      pricing/
        index.html
        styles.css
  assets/
    <hostname>/...
```

CLI prints a verification report after each scrape:
- pages/assets/scripts/styles/fonts/images/others counts
- `remote_urls_remaining` so you can quickly see if anything external is still referenced

## Roadmap

- component inference (`Hero`, `Navbar`, `Footer`) into framework templates
- CSS deduplication and naming normalization
- JS de-minification and source-map aware rewriting
- multi-page crawl with route graph export
