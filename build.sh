#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Read version from package.json
version=$(node -p "require('./package.json').version")

echo "Building rover-dumper v${version}..."

# Bundle JSZip + minify into a single IIFE
# --supported:template-literal=false  downlevels template literals to string
#   concatenation so literal newlines become \n escapes (browsers corrupt real
#   newlines in bookmark URLs)
# --legal-comments=none  strips the JSZip/pako license comment block
npx esbuild src/rover-dumper.js \
  --bundle \
  --minify \
  --format=iife \
  --supported:template-literal=false \
  --legal-comments=none \
  --outfile=dist/rover-dumper.bundle.js

# Prepend bookmarklet prefix, collapse to a single line, write final output
printf '%s' "javascript:/*${version}*/" > dist/rover-dumper.min.js
tr -d '\n' < dist/rover-dumper.bundle.js >> dist/rover-dumper.min.js
rm dist/rover-dumper.bundle.js

# Update index.html bookmarklet href
if [[ -f index.html ]]; then
  node <<'SCRIPT'
const fs = require('fs');
const bkmk = fs.readFileSync('dist/rover-dumper.min.js', 'utf8').trim();
let html = fs.readFileSync('index.html', 'utf8');
const re = /<!-- BOOKMARKLET_START -->.*?<!-- BOOKMARKLET_END -->/s;
const href = bkmk.replace(/%/g, '%25').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tag = `<!-- BOOKMARKLET_START --><a id="bookmarklet" href="${href}" class="bookmarklet-btn" onclick="return false;">Rover Dumper</a><!-- BOOKMARKLET_END -->`;
html = html.replace(re, () => tag);
fs.writeFileSync('index.html', html);
SCRIPT
  echo "Updated index.html bookmarklet href"
fi

size=$(wc -c < dist/rover-dumper.min.js | tr -d ' ')
echo "Output: dist/rover-dumper.min.js (${size} bytes)"
echo "Done."
