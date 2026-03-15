# CLAUDE.md

## Overview

Rover Dumper is a browser bookmarklet that bulk-downloads pet photos from Rover.com. It paginates the internal API, fetches every image at full quality, zips them with JSZip, and triggers a single download.

## Key Commands

```bash
npm install        # Install dependencies (jszip + esbuild)
npm run build      # Bundle + minify src -> dist, update site
npm version patch  # Bump version (then npm run build to rebuild)
```

## Architecture

- `src/rover-dumper.js` -- readable source with `import JSZip from 'jszip'`
- `build.sh` -- esbuild bundles JSZip into a single IIFE, prepends `javascript:/*version*/`, outputs to `dist/rover-dumper.min.js`, and updates `index.html`
- `index.html` -- self-contained GitHub Pages landing page; bookmarklet href is auto-updated by build
- Bookmarklet is entirely client-side; no server, no data sent anywhere

## Conventions

- Version lives in `package.json`; build reads it from there
- Bookmarklet href in index.html is between `<!-- BOOKMARKLET_START -->` and `<!-- BOOKMARKLET_END -->` marker comments
- Image URL strategy: strip all query params from any available URL field, append `?quality=100`
- Sequential image fetches (not parallel) to avoid rate limiting
- Zip uses `compression: 'STORE'` since JPEGs are already compressed
