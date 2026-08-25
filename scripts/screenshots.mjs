#!/usr/bin/env node
// Generate the README screenshot of the confirmation dialog.
//
// The dialog is the whole pitch in one frame -- photo count, date range, size
// estimate, and the filter controls -- so it is the shot worth having. It is
// also the only screen that renders BEFORE any image is fetched, which is what
// makes an offline capture possible.
//
// The tool is a bookmarklet that only runs against a logged-in Rover.com pet
// page, so there is nothing to point a browser at. Instead we reproduce the one
// thing the dialog needs -- a successful metadata fetch -- and let the real code
// draw the real UI:
//
//   - Serve a minimal pet page AT https://www.rover.com/dogs/<opk>/ (via route
//     fulfillment) so getOpk() and the <h3> pet-name read both succeed, and so
//     the API call the bookmarklet makes is SAME-ORIGIN -- no CORS preflight to
//     satisfy for a cross-site fetch carrying an X-CSRFToken header.
//   - Fulfill the images API with fabricated metadata: a realistic photo count
//     spread across a plausible date range, so the summary and date inputs are
//     populated with something worth showing.
//   - Inject the built bundle (prefix stripped) and let its own main() run.
//
// Nothing in rover-dumper's source is touched or mocked: showConfirmation() is a
// pure DOM builder driven entirely by the metadata we supply, so the card in the
// screenshot is byte-for-byte what a real run draws.
//
// Usage:  node scripts/screenshots.mjs [outDir]
// Default outDir is docs/.

import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = process.argv[2] || join(ROOT, 'docs');
const COVER = join(ROOT, 'docs', 'screenshots', 'cover.png');

// A pet page lives at /dogs/<opk>/; the opk is arbitrary but must be URL-safe.
const OPK = 'N0Bq9aaQ';
const PET_NAME = 'Buddy';
const BASE = 'https://www.rover.com';
const PET_URL = `${BASE}/dogs/${OPK}/`;

// The fabricated library. 247 photos reads as a real, long-tenured account -- big
// enough that the bulk-download pitch lands, not so big the size estimate looks
// invented. The date span drives the pre-filled date inputs.
const PHOTO_COUNT = 247;
const FIRST_PHOTO = '2023-01-03T09:15:00Z';
const LAST_PHOTO = '2026-06-02T18:40:00Z';

// A 1x1 JPEG. The confirmation dialog never fetches images (that is the Download
// step), but giving every photo a valid-looking URL keeps the metadata honest.
const PIXEL_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

// Evenly space PHOTO_COUNT timestamps across the span so parseDate() has a real
// min and max to render, and each photo carries a full-quality URL field.
function buildMetadata() {
  const start = new Date(FIRST_PHOTO).getTime();
  const end = new Date(LAST_PHOTO).getTime();
  const step = (end - start) / (PHOTO_COUNT - 1);
  const results = [];
  for (let i = 0; i < PHOTO_COUNT; i++) {
    results.push({
      pk: 1000 + i,
      added: new Date(start + step * i).toISOString(),
      large_uncropped_retina: `${PIXEL_JPEG}#${i}`,
    });
  }
  return { count: PHOTO_COUNT, results };
}

const PET_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${PET_NAME} on Rover</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff}</style>
</head>
<body><h3>${PET_NAME}</h3></body>
</html>`;

// The bundle ships with the javascript: bookmarklet prefix; strip it so the rest
// can be evaluated as ordinary page script. The outer IIFE self-invokes, so
// evaluating it runs main() exactly as clicking the bookmarklet would.
function loadBookmarkletBody() {
  const raw = readFileSync(join(ROOT, 'dist', 'rover-dumper.min.js'), 'utf8');
  return raw.replace(/^javascript:\/\*[^*]*\*\//, '');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const metadata = buildMetadata();
  const bookmarklet = loadBookmarkletBody();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 900, height: 900 },
    deviceScaleFactor: 2, // retina: the card's small type is the point, keep it crisp
    colorScheme: 'dark', // the dialog reads prefers-color-scheme; dark is the default here
  });

  // Serve the pet page and the images API from the real origin. Route matching
  // runs before the network, so nothing actually leaves the machine.
  await context.route(`${BASE}/dogs/${OPK}/`, (route) =>
    route.fulfill({ contentType: 'text/html', body: PET_PAGE_HTML }),
  );
  await context.route(`${BASE}/api/v7/pets/${OPK}/images/**`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(metadata) }),
  );

  const page = await context.newPage();
  await page.goto(PET_URL);

  // Run the bookmarklet. main() shows a brief loading overlay, fetches the
  // (stubbed) metadata, then renders the confirmation dialog.
  await page.addScriptTag({ content: bookmarklet });

  // Wait for the dialog itself, not just any overlay: the summary line only
  // exists once metadata has resolved and showConfirmation() has drawn the card.
  const card = page.locator('[role="dialog"]');
  await card.waitFor({ state: 'visible' });
  await page.getByText(`Found ${PHOTO_COUNT} photos for ${PET_NAME}`).waitFor();

  console.log('capturing into', OUT);
  // Element crop: the card only, no dimmed backdrop. The backdrop is mostly empty
  // space that GitHub would shrink the card inside of; the card alone stays legible.
  await card.screenshot({ path: join(OUT, 'confirm.png') });
  console.log('  wrote confirm.png');
  if (process.argv[2] === undefined) {
    mkdirSync(dirname(COVER), { recursive: true });
    copyFileSync(join(OUT, 'confirm.png'), COVER);
    console.log('  wrote screenshots/cover.png');
  }

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
