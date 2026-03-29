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
npm install
npm run build
```

## Usage

```bash
# direct command
scrapify https://example.com -o ./output/example

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

## Roadmap

- component inference (`Hero`, `Navbar`, `Footer`) into framework templates
- CSS deduplication and naming normalization
- JS de-minification and source-map aware rewriting
- multi-page crawl with route graph export
