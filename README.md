# 🐶 Rover Dumper 💩

Bulk download your pet's photos from [Rover.com](https://www.rover.com). One click, one zip file, full quality.

Rover.com has no bulk photo download -- you can only view photos one at a time. This bookmarklet paginates Rover's internal API, fetches every image at full quality, zips them up, and triggers a single download.

## Quick Start

1. **Install** -- Drag the "Rover Dumper" button from the [landing page](https://j-256.github.io/rover-dumper/) to your bookmarks bar
2. **Navigate** -- Go to your pet's profile page on Rover.com (e.g. `rover.com/members/.../dogs/...`)
3. **Click** -- Click the "Rover Dumper" bookmark

## Features

- **Full quality** -- Downloads original images, not thumbnails
- **Filter by date or range** -- Pick a date range or photo range before downloading
- **Progress tracking** -- Live progress bar with download size and elapsed time
- **Cancel anytime** -- Cancel mid-download and optionally save what's been collected so far
- **Privacy first** -- Runs entirely in your browser. No data is sent anywhere. Open source

## Installation

### Drag and drop (recommended)

Visit the [landing page](https://j-256.github.io/rover-dumper/) and drag the green "Rover Dumper" button to your bookmarks bar.

### Manual installation

1. Visit the [landing page](https://j-256.github.io/rover-dumper/) and click "Copy bookmarklet code"
2. Create a new bookmark in your browser
3. Set the name to "Rover Dumper"
4. Paste the copied code as the URL

## How It Works

1. Extracts the pet identifier from the Rover.com URL
2. Paginates the Rover photo API to collect all photo metadata
3. Shows a confirmation screen with photo count, date range, and optional filters
4. Downloads each photo sequentially at full quality
5. Packages everything into a zip file using [JSZip](https://stuk.github.io/jszip/)
6. Triggers a browser download of the zip

## Privacy & Security

- **No server** -- Everything runs in your browser tab
- **No tracking** -- No analytics, no cookies, no external requests beyond Rover's own API
- **No data leaves your browser** -- Photos go straight from Rover's CDN into a local zip file
- **Open source** -- Read every line of code in `src/rover-dumper.js`
- **Your credentials stay local** -- Uses your existing Rover.com login session; no passwords are accessed or stored

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome  | Supported |
| Firefox | Supported |
| Edge    | Supported |
| Safari  | Supported (drag-to-install may vary) |
| Mobile  | Not supported (bookmarklets require a desktop browser) |

## RAM Note

Each photo is held in memory while building the zip. For very large photo sets (1000+), this may use significant RAM. Use the photo range filter to download in smaller batches if needed.

## Development

```bash
npm install          # Install dependencies
npm run build        # Bundle + minify -> dist/rover-dumper.min.js
npm version patch    # Bump version, then npm run build to rebuild
```

The build script uses esbuild to bundle JSZip into the bookmarklet as a self-contained IIFE, then prepends the `javascript:` protocol and version comment.

## License

[MIT](LICENSE)
