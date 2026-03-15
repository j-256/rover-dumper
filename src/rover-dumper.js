import JSZip from 'jszip';

// ============================================================================
// Configuration
// ============================================================================

const PAGE_SIZE = 100; // request large pages; server may cap lower
const EST_AVG_PHOTO_MB = 1.4; // derived from real Rover photo data

// ============================================================================
// URL Validation & Pet Identification
// ============================================================================

// Extract the pet's opk from the pathname (e.g. /dogs/N0Bq9aaQ/ -> N0Bq9aaQ)
function getOpk() {
  const match = window.location.pathname.match(/\/dogs\/([^/]+)/);
  return match ? match[1] : null;
}

// Extract the pet's name from the page heading
function getPetName() {
  const h3 = document.querySelector('h3');
  if (!h3) return null;
  const raw = h3.textContent.trim();
  // Strip emoji and special chars, replace spaces with underscores
  const sanitized = raw
    .replace(/[\u{1F600}-\u{1FFFF}]/gu, '') // emoji
    .replace(/[^\w\s-]/g, '') // special chars
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return sanitized || null;
}

// ============================================================================
// API Helpers
// ============================================================================

function getCsrfToken() {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : '';
}

async function fetchPage(opk, pageNum, signal) {
  const url = `https://www.rover.com/api/v7/pets/${opk}/images/?page=${pageNum}&page_size=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: { 'X-CSRFToken': getCsrfToken() },
    credentials: 'include',
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('AUTH');
  }
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// API Pagination
// ============================================================================

// Fetch all photo metadata, calling onProgress(loadedCount, total) as pages arrive
async function fetchAllMetadata(opk, signal, onProgress) {
  const first = await fetchPage(opk, 1, signal);
  const total = first.count;

  if (total === 0) {
    throw new Error('NO_PHOTOS');
  }

  const photos = first.results.slice();
  if (onProgress) onProgress(photos.length, total);

  // Follow the `next` URL rather than computing page count, since the
  // server may return fewer results per page than requested
  let pageNum = 2;
  while (photos.length < total) {
    const page = await fetchPage(opk, pageNum++, signal);
    if (page.results.length === 0) break;
    photos.push(...page.results);
    if (onProgress) onProgress(photos.length, total);
  }

  return photos;
}

// ============================================================================
// Image URL Extraction
// ============================================================================

// Grab any available image URL, strip query params for full-quality original
function getFullQualityUrl(photo) {
  const fields = ['large_uncropped_retina', 'large_uncropped', 'medium', 'small'];
  let url = null;
  for (const field of fields) {
    if (photo[field]) {
      url = photo[field];
      break;
    }
  }
  if (!url) return null;
  // Strip all query params -- the bare URL returns the original image
  return url.split('?')[0];
}

// ============================================================================
// Date Helpers
// ============================================================================

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ============================================================================
// UI: Theme Detection
// ============================================================================

function isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getTheme() {
  const dark = isDarkMode();
  return {
    bg: dark ? '#1e1e1e' : '#ffffff',
    text: dark ? '#e0e0e0' : '#1a1a1a',
    textSecondary: dark ? '#a0a0a0' : '#666666',
    border: dark ? '#333333' : '#e0e0e0',
    inputBg: dark ? '#2a2a2a' : '#f5f5f5',
    inputBorder: dark ? '#444444' : '#cccccc',
    backdrop: dark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.4)',
    progressBg: dark ? '#333333' : '#e0e0e0',
    progressFill: '#22c55e',
    btnPrimary: '#22c55e',
    btnPrimaryText: '#ffffff',
    btnSecondary: dark ? '#333333' : '#e0e0e0',
    btnSecondaryText: dark ? '#e0e0e0' : '#1a1a1a',
    errorText: '#ef4444',
  };
}

// ============================================================================
// UI: DOM Helpers
// ============================================================================

function el(tag, styles, attrs) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'textContent') e.textContent = v;
      else e.setAttribute(k, v);
    }
  }
  return e;
}

function createButton(text, theme, primary, onClick) {
  const btn = el('button', {
    padding: '10px 24px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: primary ? theme.btnPrimary : theme.btnSecondary,
    color: primary ? theme.btnPrimaryText : theme.btnSecondaryText,
  });
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

// ============================================================================
// UI: Overlay Shell
// ============================================================================

function createOverlay(theme) {
  // Backdrop
  const backdrop = el('div', {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: theme.backdrop,
    zIndex: '2147483646',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  });

  // Card
  const card = el(
    'div',
    {
      backgroundColor: theme.bg,
      color: theme.text,
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      padding: '28px 32px',
      maxWidth: '480px',
      width: '90%',
      zIndex: '2147483647',
      position: 'relative',
      lineHeight: '1.5',
    },
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'rd-title',
    },
  );

  // Title
  const title = el(
    'div',
    {
      fontSize: '20px',
      fontWeight: '700',
      marginBottom: '20px',
    },
    { textContent: 'Rover Dumper', id: 'rd-title' },
  );

  card.appendChild(title);
  backdrop.appendChild(card);

  // Close on Escape
  const onKeyDown = (e) => {
    if (e.key === 'Escape') backdrop.remove();
  };
  window.addEventListener('keydown', onKeyDown);

  // Cleanup listener when backdrop is removed
  const observer = new MutationObserver(() => {
    if (!document.body.contains(backdrop)) {
      window.removeEventListener('keydown', onKeyDown);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  return { backdrop, card, title };
}

// ============================================================================
// UI: Confirmation Screen
// ============================================================================

function showConfirmation(photos, petName, theme, onDownload, onCancel) {
  const { backdrop, card } = createOverlay(theme);

  // Compute date range from photo metadata
  const dates = photos
    .map(p => parseDate(p.added))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const minDate = dates.length > 0 ? dates[0] : null;
  const maxDate = dates.length > 0 ? dates[dates.length - 1] : null;

  // Display name
  const displayName = petName ? petName.charAt(0).toUpperCase() + petName.slice(1) : 'this pet';

  // Summary line
  const summary = el('div', { marginBottom: '6px', fontSize: '15px' });
  summary.textContent = `Found ${photos.length} photos for ${displayName}`;
  card.appendChild(summary);

  // Date range line
  if (minDate && maxDate) {
    const dateRange = el('div', {
      marginBottom: '6px',
      fontSize: '14px',
      color: theme.textSecondary,
    });
    dateRange.textContent = `Date range: ${formatDateShort(minDate)} -- ${formatDateShort(maxDate)}`;
    card.appendChild(dateRange);
  }

  // Size estimate line
  const sizeEstimate = el('div', {
    marginBottom: '20px',
    fontSize: '14px',
    color: theme.textSecondary,
  });
  card.appendChild(sizeEstimate);

  // Filter section
  const filterLabel = el('div', {
    fontSize: '13px',
    color: theme.textSecondary,
    marginBottom: '8px',
  }, { textContent: 'Filter (optional):' });
  card.appendChild(filterLabel);

  const filterGrid = el('div', {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto 1fr',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '16px',
    fontSize: '14px',
  });

  const inputStyle = {
    padding: '6px 8px',
    border: `1px solid ${theme.inputBorder}`,
    borderRadius: '4px',
    backgroundColor: theme.inputBg,
    color: theme.text,
    fontSize: '13px',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  };

  // Date range inputs
  const dateFromLabel = el('span', { whiteSpace: 'nowrap' }, { textContent: 'Date range:' });
  const dateFrom = el('input', inputStyle, { type: 'date', 'aria-label': 'Date from' });
  const dateToLabel = el('span', { textAlign: 'center' }, { textContent: 'to' });
  const dateTo = el('input', inputStyle, { type: 'date', 'aria-label': 'Date to' });

  if (minDate) dateFrom.value = formatDateISO(minDate);
  if (maxDate) dateTo.value = formatDateISO(maxDate);

  filterGrid.appendChild(dateFromLabel);
  filterGrid.appendChild(dateFrom);
  filterGrid.appendChild(dateToLabel);
  filterGrid.appendChild(dateTo);

  // Photo range inputs
  const rangeFromLabel = el('span', { whiteSpace: 'nowrap' }, { textContent: 'Photo range:' });
  const rangeFrom = el('input', inputStyle, {
    type: 'number',
    min: '1',
    max: String(photos.length),
    value: '1',
    'aria-label': 'Photo range start',
  });
  const rangeToLabel = el('span', { textAlign: 'center' }, { textContent: 'to' });
  const rangeTo = el('input', inputStyle, {
    type: 'number',
    min: '1',
    max: String(photos.length),
    value: String(photos.length),
    'aria-label': 'Photo range end',
  });

  filterGrid.appendChild(rangeFromLabel);
  filterGrid.appendChild(rangeFrom);
  filterGrid.appendChild(rangeToLabel);
  filterGrid.appendChild(rangeTo);

  card.appendChild(filterGrid);

  // "X of Y selected" summary
  const showingSummary = el('div', {
    marginBottom: '20px',
    fontSize: '14px',
    fontWeight: '600',
  });
  card.appendChild(showingSummary);

  // Filter logic: returns indices of photos that pass the current filters
  function getFilteredIndices() {
    const fromDate = dateFrom.value ? new Date(dateFrom.value + 'T00:00:00') : null;
    const toDate = dateTo.value ? new Date(dateTo.value + 'T23:59:59') : null;
    const fromIdx = Math.max(1, parseInt(rangeFrom.value) || 1) - 1; // 0-based
    const toIdx = Math.min(photos.length, parseInt(rangeTo.value) || photos.length); // exclusive

    const indices = [];
    for (let i = fromIdx; i < toIdx; i++) {
      const photo = photos[i];
      const photoDate = parseDate(photo.added);
      if (fromDate && photoDate && photoDate < fromDate) continue;
      if (toDate && photoDate && photoDate > toDate) continue;
      indices.push(i);
    }
    return indices;
  }

  function updateSummary() {
    const filtered = getFilteredIndices();
    const estMB = (filtered.length * EST_AVG_PHOTO_MB).toFixed(0);
    showingSummary.textContent = `${filtered.length} of ${photos.length} photos selected (~${estMB} MB)`;
    sizeEstimate.textContent = `Estimated size: ~${(photos.length * EST_AVG_PHOTO_MB).toFixed(0)} MB`;
  }

  // Update live on filter change
  dateFrom.addEventListener('input', updateSummary);
  dateTo.addEventListener('input', updateSummary);
  rangeFrom.addEventListener('input', updateSummary);
  rangeTo.addEventListener('input', updateSummary);
  updateSummary();

  // Buttons
  const btnRow = el('div', {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  });

  const cancelBtn = createButton('Cancel', theme, false, () => {
    backdrop.remove();
    if (onCancel) onCancel();
  });

  const downloadBtn = createButton('Download', theme, true, () => {
    const filtered = getFilteredIndices();
    if (filtered.length === 0) {
      showingSummary.style.color = theme.errorText;
      showingSummary.textContent = 'No photos match the current filters';
      return;
    }
    const selectedPhotos = filtered.map(i => photos[i]);
    onDownload(selectedPhotos, backdrop);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(downloadBtn);
  card.appendChild(btnRow);

  document.body.appendChild(backdrop);
  return backdrop;
}

// ============================================================================
// UI: Progress Screen
// ============================================================================

function showProgress(totalPhotos, petName, theme, onCancel) {
  const { backdrop, card, title } = createOverlay(theme);

  // Cancel button in the title row
  const cancelBtn = createButton('Cancel', theme, false, onCancel);
  cancelBtn.style.position = 'absolute';
  cancelBtn.style.top = '20px';
  cancelBtn.style.right = '24px';
  cancelBtn.style.padding = '6px 14px';
  cancelBtn.style.fontSize = '13px';
  card.appendChild(cancelBtn);

  // Display name
  const displayName = petName ? petName.charAt(0).toUpperCase() + petName.slice(1) : 'your pet';

  // Status text
  const status = el('div', {
    marginBottom: '16px',
    fontSize: '15px',
  });
  status.textContent = `Downloading ${displayName}'s photos...`;
  card.appendChild(status);

  // Progress bar container
  const barOuter = el('div', {
    width: '100%',
    height: '24px',
    backgroundColor: theme.progressBg,
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: '6px',
  });

  const barInner = el('div', {
    width: '0%',
    height: '100%',
    backgroundColor: theme.progressFill,
    borderRadius: '12px',
    transition: 'width 0.2s ease',
  });

  barOuter.appendChild(barInner);
  card.appendChild(barOuter);

  // Count text (right-aligned under bar)
  const countText = el('div', {
    fontSize: '14px',
    textAlign: 'right',
    marginBottom: '12px',
    color: theme.textSecondary,
  });
  countText.textContent = `0 / ${totalPhotos}`;
  card.appendChild(countText);

  // Size + elapsed text
  const detailText = el('div', {
    fontSize: '13px',
    color: theme.textSecondary,
    marginBottom: '4px',
  });
  card.appendChild(detailText);

  const elapsedText = el('div', {
    fontSize: '13px',
    color: theme.textSecondary,
  });
  card.appendChild(elapsedText);

  document.body.appendChild(backdrop);

  const startTime = Date.now();

  return {
    backdrop,
    update(downloaded, downloadedBytes) {
      const pct = Math.round((downloaded / totalPhotos) * 100);
      barInner.style.width = pct + '%';
      countText.textContent = `${downloaded} / ${totalPhotos}`;

      const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
      const estMB = (totalPhotos * EST_AVG_PHOTO_MB).toFixed(0);
      detailText.textContent = `${dlMB} MB downloaded (~${estMB} MB estimated)`;

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      elapsedText.textContent = `Elapsed: ${formatElapsed(elapsed)}`;
    },
    setStatus(text) {
      status.textContent = text;
    },
    setProgress(pct) {
      barInner.style.width = pct + '%';
    },
    disableCancel() {
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.5';
      cancelBtn.style.cursor = 'default';
    },
    showOK() {
      cancelBtn.remove();
      const okBtn = createButton('OK', theme, true, () => backdrop.remove());
      okBtn.style.position = 'absolute';
      okBtn.style.top = '20px';
      okBtn.style.right = '24px';
      okBtn.style.padding = '6px 14px';
      okBtn.style.fontSize = '13px';
      card.appendChild(okBtn);
    },
  };
}

// ============================================================================
// UI: Error Display
// ============================================================================

function showError(message, theme) {
  const { backdrop, card } = createOverlay(theme);

  const msg = el('div', {
    marginBottom: '20px',
    fontSize: '15px',
  }, { textContent: message });
  card.appendChild(msg);

  const btnRow = el('div', { display: 'flex', justifyContent: 'flex-end' });
  const okBtn = createButton('OK', theme, true, () => backdrop.remove());
  btnRow.appendChild(okBtn);
  card.appendChild(btnRow);

  document.body.appendChild(backdrop);
}

// ============================================================================
// UI: Partial Download Offer
// ============================================================================

function showPartialOffer(collectedBlobs, photos, petName, theme) {
  const { backdrop, card } = createOverlay(theme);

  const msg = el('div', {
    marginBottom: '20px',
    fontSize: '15px',
  });
  msg.textContent = `Download cancelled. ${collectedBlobs.length} of ${photos.length} photos were collected.`;
  card.appendChild(msg);

  const btnRow = el('div', { display: 'flex', gap: '12px', justifyContent: 'flex-end' });

  const discardBtn = createButton('Discard', theme, false, () => backdrop.remove());
  const downloadBtn = createButton(`Download ${collectedBlobs.length} photos`, theme, true, async () => {
    btnRow.remove();
    msg.textContent = 'Building zip...';
    try {
      const zipSize = await buildAndDownloadZip(collectedBlobs, petName, theme, null);
      const zipMB = (zipSize / (1024 * 1024)).toFixed(1);
      msg.textContent = `Done! ${collectedBlobs.length} photos downloaded -- ${zipMB} MB`;
    } catch (e) {
      msg.textContent = 'Failed to build zip: ' + e.message;
    }
    const okBtn = createButton('OK', theme, true, () => backdrop.remove());
    card.appendChild(el('div', { display: 'flex', justifyContent: 'flex-end' }));
    card.lastChild.appendChild(okBtn);
  });

  btnRow.appendChild(discardBtn);
  btnRow.appendChild(downloadBtn);
  card.appendChild(btnRow);

  document.body.appendChild(backdrop);
}

// ============================================================================
// Zip Generation & Download
// ============================================================================

async function buildAndDownloadZip(blobs, petName, theme, progress) {
  const zip = new JSZip();
  const name = petName || 'pet';

  for (let i = 0; i < blobs.length; i++) {
    const { blob, date, id } = blobs[i];
    const num = String(i + 1).padStart(4, '0');
    const dateStr = date ? formatDateISO(date) : 'unknown';
    const filename = `${name}_${num}_${dateStr}_${id}.jpg`;
    zip.file(filename, blob);
  }

  if (progress) {
    progress.setStatus('Building zip...');
    progress.disableCancel();
  }

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => {
      if (progress) {
        progress.setProgress(Math.round(meta.percent));
        progress.setStatus(`Building zip... ${Math.round(meta.percent)}%`);
      }
    },
  );

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_rover_photos.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke after a short delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return zipBlob.size;
}

// ============================================================================
// Image Download Loop
// ============================================================================

async function downloadPhotos(photos, petName, theme, confirmBackdrop) {
  // Remove confirmation screen
  if (confirmBackdrop) confirmBackdrop.remove();

  const controller = new AbortController();
  let cancelled = false;

  const progress = showProgress(photos.length, petName, theme, () => {
    cancelled = true;
    controller.abort();
  });

  const blobs = [];
  let totalBytes = 0;
  let failCount = 0;

  for (let i = 0; i < photos.length; i++) {
    if (cancelled) break;

    const photo = photos[i];
    const url = getFullQualityUrl(photo);
    if (!url) {
      failCount++;
      progress.update(i + 1, totalBytes);
      continue;
    }

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        failCount++;
        progress.update(i + 1, totalBytes);
        continue;
      }
      const blob = await res.blob();
      totalBytes += blob.size;
      const photoDate = parseDate(photo.added);
      blobs.push({ blob, date: photoDate, id: photo.pk || photo.id || i });
    } catch (e) {
      if (e.name === 'AbortError') break;
      failCount++;
    }

    progress.update(i + 1, totalBytes);
  }

  // Handle cancel
  if (cancelled) {
    progress.backdrop.remove();
    if (blobs.length > 0) {
      showPartialOffer(blobs, photos, petName, theme);
    }
    return;
  }

  // Build zip and download
  try {
    const zipSize = await buildAndDownloadZip(blobs, petName, theme, progress);
    const zipMB = (zipSize / (1024 * 1024)).toFixed(1);

    if (failCount > 0) {
      progress.setStatus(`Done! ${blobs.length} of ${photos.length} photos (${failCount} failed) -- ${zipMB} MB`);
    } else {
      progress.setStatus(`Done! ${blobs.length} photos downloaded -- ${zipMB} MB`);
    }

    progress.showOK();
  } catch (e) {
    progress.setStatus('Failed to build zip: ' + e.message);
    progress.showOK();
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

(async function main() {
  const theme = getTheme();

  // Validate we're on a pet profile page
  const opk = getOpk();
  if (!opk) {
    showError('Navigate to a pet\'s profile on Rover.com first.', theme);
    return;
  }

  const petName = getPetName();

  // Show loading state
  const { backdrop: loadingBackdrop, card: loadingCard } = createOverlay(theme);
  const loadingMsg = el('div', { fontSize: '15px' }, { textContent: 'Loading photo metadata...' });
  loadingCard.appendChild(loadingMsg);
  document.body.appendChild(loadingBackdrop);

  try {
    const photos = await fetchAllMetadata(opk, null, (loaded, total) => {
      loadingMsg.textContent = `Loading photo metadata... ${loaded} / ${total}`;
    });

    // Remove loading screen
    loadingBackdrop.remove();

    // Show confirmation with filters
    showConfirmation(photos, petName, theme, (selectedPhotos, confirmBackdrop) => {
      downloadPhotos(selectedPhotos, petName, theme, confirmBackdrop);
    });
  } catch (e) {
    loadingBackdrop.remove();

    if (e.message === 'AUTH') {
      showError('Please log into Rover.com and try again.', theme);
    } else if (e.message === 'NO_PHOTOS') {
      const displayName = petName ? petName.charAt(0).toUpperCase() + petName.slice(1) : 'this pet';
      showError(`No photos found for ${displayName}.`, theme);
    } else {
      showError('Something went wrong: ' + e.message, theme);
    }
  }
})();
