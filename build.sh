#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

# Read version + canonical URL from package.json
version=$(node -p "require('./package.json').version")
homepage=$(node -p "require('./package.json').homepage")

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
printf '%s' "javascript:/*rover-dumper@${version}*/" > dist/rover-dumper.min.js
tr -d '\n' < dist/rover-dumper.bundle.js >> dist/rover-dumper.min.js
rm dist/rover-dumper.bundle.js

# Update index.html (bookmarklet href + canonical URLs)
if [[ -f index.html ]]; then
  HOMEPAGE="$homepage" node <<'SCRIPT'
const fs = require('fs');
const homepage = process.env.HOMEPAGE;
const bkmk = fs.readFileSync('dist/rover-dumper.min.js', 'utf8').trim();
let html = fs.readFileSync('index.html', 'utf8');
const re = /<!-- BOOKMARKLET_START -->.*?<!-- BOOKMARKLET_END -->/s;
const href = bkmk.replace(/%/g, '%25').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tag = `<!-- BOOKMARKLET_START --><a id="bookmarklet" href="${href}" class="bookmarklet-btn" onclick="return false;">Rover Dumper</a><!-- BOOKMARKLET_END -->`;
html = html.replace(re, () => tag);
html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (_, a, b) => a + homepage + b);
html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, (_, a, b) => a + homepage + b);
html = html.replace(/("url":\s*")[^"]*(")/, (_, a, b) => a + homepage + b);
fs.writeFileSync('index.html', html);
SCRIPT
  echo "Updated index.html bookmarklet href + canonical URLs"
fi

# Update README.md install link
if [[ -f README.md ]]; then
  HOMEPAGE="$homepage" node <<'SCRIPT'
const fs = require('fs');
const homepage = process.env.HOMEPAGE;
let md = fs.readFileSync('README.md', 'utf8');
md = md.replace(/(\[Install it here\]\()[^)]*(\))/, (_, a, b) => a + homepage + b);
fs.writeFileSync('README.md', md);
SCRIPT
  echo "Updated README.md install link"
fi

# Generate sitemap.xml + robots.txt from package.json homepage
today=$(date -u +%Y-%m-%d)
cat > sitemap.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${homepage}</loc>
    <lastmod>${today}</lastmod>
  </url>
</urlset>
XML
cat > robots.txt <<TXT
User-agent: *
Allow: /

Sitemap: ${homepage}sitemap.xml
TXT
echo "Generated sitemap.xml + robots.txt for ${homepage}"

size=$(wc -c < dist/rover-dumper.min.js | tr -d ' ')
echo "Output: dist/rover-dumper.min.js (${size} bytes)"
echo "Done."
