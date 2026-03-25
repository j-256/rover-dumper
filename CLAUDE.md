# CLAUDE.md

## Overview

Rover Dumper is a browser bookmarklet that bulk-downloads pet photos from Rover.com. It paginates the internal API, fetches every image at full quality, zips them with JSZip, and triggers a single download.

## Key Commands

```bash
npm install                       # Install dependencies (jszip + esbuild)
npm run build                     # Bundle + minify src -> dist, update index.html
npm version <major|minor|patch>   # Bump version, rebuild, commit + tag
```

## Architecture

- `src/rover-dumper.js` -- readable source with `import JSZip from 'jszip'`
- `build.sh` -- esbuild bundles JSZip into a single IIFE, outputs to `dist/rover-dumper.min.js`, and injects it into `index.html`
- `index.html` -- GitHub Pages landing page served at `rover-dumper.jklein.dev`; bookmarklet href is auto-updated by build
- `CNAME` -- custom domain for GitHub Pages (`rover-dumper.jklein.dev`)
- Bookmarklet is entirely client-side; no server, no data sent anywhere

## Build Pipeline Details

The build has several layers to make bookmarklets work correctly in browser bookmark URLs:

1. esbuild bundles with `--supported:template-literal=false` (downlevels template literals so no literal newlines survive -- browsers corrupt newlines in bookmark URLs)
2. esbuild bundles with `--legal-comments=none` (strips JSZip/pako license comment block)
3. Output is collapsed to a single line via `tr -d '\n'`
4. `javascript:/*version*/` prefix is prepended
5. When injecting into `index.html` href:
   - `%` is encoded as `%25` (prevents browsers from interpreting `%` + hex digits in minified code as URL percent-encoding)
   - `&` is encoded as `&amp;` (prevents HTML parser from decoding `&lt` as `<` entity)
   - `"` is encoded as `&quot;` (prevents breaking the href attribute)
   - Replacement uses `() => tag` function form to avoid `$&` expansion in JSZip's minified code

## Conventions

- Version lives in `package.json`; build reads it from there
- Bookmarklet href in index.html is between `<!-- BOOKMARKLET_START -->` and `<!-- BOOKMARKLET_END -->` marker comments
- API endpoint: `/api/v7/pets/{opk}/images/` (not `/images-cached/`; the non-cached endpoint respects `page_size`)
- Image URL strategy: strip all query params from any available URL field (bare URL returns the original)
- Limited parallel image fetches (CONCURRENCY = 3) to balance speed vs rate-limiting risk
- Zip uses `compression: 'STORE'` since JPEGs are already compressed
- Copy button decodes `%25` back to `%` so manual-paste installation gets raw JS
- After feature changes, review and update README.md "How It Works" section and index.html descriptions to match implementation

## Commit Style

- Descriptive header summarizing the change (not just the filename)
- Bullet points for details
- Function-level changes: `functionName(): Description`
- Group by logical change, not by file

## GitHub

- Repo: `j-256/rover-dumper`
- GitHub Pages deploys from `main` branch, root (`/`)
- Custom domain: `rover-dumper.jklein.dev` (CNAME record -> `j-256.github.io`)
