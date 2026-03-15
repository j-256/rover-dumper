# 🐶 Rover Dumper 💩

A client-side bookmarklet to bulk download high-resolution pet photos from [Rover.com](https://www.rover.com).

🚀 **Looking to use this? Visit the [Landing Page](https://j-256.github.io/rover-dumper/) for easy installation.**

## Overview

Rover's web interface lacks a bulk download feature. This tool provides a seamless, privacy-preserving way to export your pet's entire photo history by interacting directly with Rover's internal API from within your browser session.

## Core Principles

- **Zero-Server Architecture**: Runs entirely in the client's browser. No data is ever transmitted to external servers.
- **Full Quality**: Bypasses thumbnails to fetch original high-resolution assets.
- **User Agency**: Includes features like date-range filtering, real-time progress tracking, and the ability to cancel and save partial results.
- **Transparency**: Open-source code (under 500 lines) with no tracking or analytics.

## Technical Workflow

1.  **Identity Extraction**: Parses the pet ID and member ID from the active `rover.com` URL.
2.  **API Pagination**: Recursively fetches the pet's photo metadata from the internal JSON API using the user's existing session cookies.
3.  **Client-Side Processing**:
    *   Maps metadata to high-resolution asset URLs (stripping query params and forcing `quality=100`).
    *   Downloads assets sequentially to respect rate limits.
    *   Generates an in-memory ZIP archive using [JSZip](https://stuk.github.io/jszip/) with `STORE` compression (since JPEGs are already compressed).
4.  **Blob Trigger**: Creates a local Blob URL and triggers a browser download of the generated `.zip` file.

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
