<<<<<<< SEARCH
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
=======
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
>>>>>>> REPLACE
