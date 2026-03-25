import JSZip from 'jszip';
import {
  ErrorCategory,
  RETRY_PHASE_BACKOFF,
  classifyError,
  sleep,
  getErrorMessage,
  getFullQualityUrl,
  parseDate,
  formatDateISO,
  formatDateShort,
  formatElapsed,
} from './utils.js';

// ============================================================================
// Configuration
// ============================================================================

const PAGE_SIZE = 100; // request large pages; server may cap lower
const EST_AVG_PHOTO_MB = 0.8; // conservative middle ground across varied photo resolutions
const MIN_SAMPLES = 10; // minimum fetch samples before using running averages
const CONCURRENCY = 3; // parallel image fetches
const MAX_INLINE_RETRIES = 2; // retries per photo during initial pass (transient only)
const MAX_TOTAL_ATTEMPTS = 5; // across both phases
const INLINE_BACKOFF = [1000, 2000]; // ms delays for inline retries
const MAX_RETRY_AFTER_MS = 60000; // cap Retry-After at 60s (metadata only)
const ERR_AUTH = 'AUTH';
const ERR_NO_PHOTOS = 'NO_PHOTOS';

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
  let res;
  try {
    res = await fetch(url, {
      headers: { 'X-CSRFToken': getCsrfToken() },
      credentials: 'include',
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw { error: e, response: null };
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(ERR_AUTH);
  }
  if (!res.ok) {
    throw { error: new Error('API error: ' + res.status), response: res };
  }
  return res.json();
}

// ============================================================================
// API Pagination
// ============================================================================

// Fetch all photo metadata, calling onProgress(loadedCount, total) as pages arrive
async function fetchAllMetadata(opk, signal, onProgress, onRetry) {
  async function fetchPageWithRetry(pageNum) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchPage(opk, pageNum, signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (e instanceof Error && e.message === ERR_AUTH) throw e;

        const res = e.response || null;
        const { category, retryAfterMs } = classifyError(e.error || e, res);

        if (category === ErrorCategory.PERMANENT) break;

        if (attempt < 2) {
          let delayMs;
          if (category === ErrorCategory.RATE_LIMITED && retryAfterMs) {
            delayMs = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
          } else {
            delayMs = INLINE_BACKOFF[attempt];
          }
          if (onRetry) onRetry(true);
          await sleep(delayMs, signal);
          if (onRetry) onRetry(false);
        }
      }
    }
    throw new Error('Failed to load photo metadata (page ' + pageNum + '). Try again later.');
  }

  const first = await fetchPageWithRetry(1);
  const total = first.count;

  if (total === 0) {
    throw new Error(ERR_NO_PHOTOS);
  }

  const photos = first.results.slice();
  if (onProgress) onProgress(photos.length, total);

  let pageNum = 2;
  while (photos.length < total) {
    const page = await fetchPageWithRetry(pageNum++);
    if (page.results.length === 0) break;
    photos.push(...page.results);
    if (onProgress) onProgress(photos.length, total);
  }

  return photos;
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

function createOverlay(theme, onEscape) {
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
  const card = el('div', {
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
  }, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rd-title' });

  // Title
  const title = el('div', {
    fontSize: '20px',
    fontWeight: '700',
    marginBottom: '20px',
  }, { textContent: 'Rover Dumper', id: 'rd-title' });

  card.appendChild(title);
  backdrop.dataset.roverDumper = '';
  backdrop.appendChild(card);

  // Escape key dismisses the overlay (or delegates to custom handler)
  let escHandler = onEscape;
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (escHandler) escHandler();
      else backdrop.remove();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(backdrop)) {
      window.removeEventListener('keydown', onKeyDown);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  return { backdrop, card, title, setEscapeHandler(fn) { escHandler = fn; } };
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
    dateRange.textContent = `Date range: ${formatDateShort(minDate)} \u2013 ${formatDateShort(maxDate)}`;
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
  const rangeFrom = el('input', inputStyle, { type: 'number', min: '1', max: String(photos.length), value: '1', 'aria-label': 'Photo range start' });
  const rangeToLabel = el('span', { textAlign: 'center' }, { textContent: 'to' });
  const rangeTo = el('input', inputStyle, { type: 'number', min: '1', max: String(photos.length), value: String(photos.length), 'aria-label': 'Photo range end' });

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

function showProgress(totalPhotos, petName, theme, onCancel, resumeStartTime) {
  const { backdrop, card, title, setEscapeHandler } = createOverlay(theme, onCancel);

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

  const startTime = resumeStartTime || Date.now();

  return {
    backdrop,
    update(downloaded, downloadedBytes, fetchCount, totalFetchTime, failCount) {
      const pct = Math.round((downloaded / totalPhotos) * 100);
      barInner.style.width = pct + '%';
      countText.textContent = downloaded + ' / ' + totalPhotos + (failCount > 0 ? ' (' + failCount + ' failed)' : '');

      const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
      let estMB;
      if (fetchCount >= MIN_SAMPLES) {
        estMB = ((downloadedBytes / fetchCount) * totalPhotos / (1024 * 1024)).toFixed(0);
      } else {
        estMB = (totalPhotos * EST_AVG_PHOTO_MB).toFixed(0);
      }
      detailText.textContent = `${dlMB} MB downloaded (~${estMB} MB estimated)`;

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      let timeStr = `Elapsed: ${formatElapsed(elapsed)}`;
      if (fetchCount >= MIN_SAMPLES && downloaded < totalPhotos) {
        const avgMs = totalFetchTime / fetchCount;
        const remaining = totalPhotos - downloaded;
        const estSec = Math.ceil((remaining * avgMs) / (CONCURRENCY * 1000));
        timeStr += ` -- ~${formatElapsed(estSec)} remaining`;
      }
      elapsedText.textContent = timeStr;
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
      setEscapeHandler(() => {});
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
      setEscapeHandler(() => backdrop.remove());
    },
    showCancelConfirm(collected, total, failCount, onContinue, onDownload, onDiscard) {
      // Dim overlay covers progress content
      const dim = el('div', {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderRadius: '12px',
        zIndex: '1',
      });
      card.appendChild(dim);

      // Compact confirmation popup
      const popup = el('div', {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: theme.bg,
        borderRadius: '10px',
        padding: '20px 24px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        border: `1px solid ${theme.border}`,
        zIndex: '2',
        width: '80%',
        maxWidth: '340px',
        boxSizing: 'border-box',
      });

      const xBtn = el('button', {
        position: 'absolute',
        top: '8px',
        right: '10px',
        background: 'none',
        border: 'none',
        fontSize: '20px',
        lineHeight: '1',
        cursor: 'pointer',
        color: theme.textSecondary,
        padding: '2px 6px',
        fontFamily: 'inherit',
      }, { textContent: '\u00d7', 'aria-label': 'Resume download' });
      xBtn.addEventListener('click', doResume);
      popup.appendChild(xBtn);

      const msg = el('div', {
        marginBottom: '16px',
        marginRight: '20px',
        fontSize: '14px',
        lineHeight: '1.4',
      });
      msg.textContent = collected + ' of ' + total + ' photos collected.' + (failCount > 0 ? ' (' + failCount + ' failed)' : '');
      popup.appendChild(msg);

      const btnRow = el('div', { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

      const discardBtn = createButton('Discard', theme, false, onDiscard);
      discardBtn.style.padding = '7px 14px';
      discardBtn.style.fontSize = '13px';

      const dlBtn = createButton(`Download ${collected}`, theme, false, () => {
        dim.remove();
        popup.remove();
        onDownload();
      });
      dlBtn.style.padding = '7px 14px';
      dlBtn.style.fontSize = '13px';

      const contBtn = createButton('Continue', theme, true, doResume);
      contBtn.style.padding = '7px 14px';
      contBtn.style.fontSize = '13px';

      btnRow.appendChild(discardBtn);
      btnRow.appendChild(dlBtn);
      btnRow.appendChild(contBtn);
      popup.appendChild(btnRow);

      card.appendChild(popup);
      setEscapeHandler(doResume);

      function doResume() {
        dim.remove();
        popup.remove();
        setEscapeHandler(onCancel);
        onContinue();
      }
    },
    showFailureReport(errorTracks) {
      const failed = [...errorTracks.values()].filter(t => t.finalCategory);
      if (failed.length === 0) return;

      const groups = new Map();
      for (const track of failed) {
        const msg = getErrorMessage(track);
        if (!groups.has(msg)) groups.set(msg, []);
        groups.get(msg).push('#' + String(track.photoIndex + 1).padStart(4, '0'));
      }

      const details = el('details', {
        marginTop: '12px',
        fontSize: '13px',
        color: theme.textSecondary,
        cursor: 'pointer',
      });

      const summaryEl = document.createElement('summary');
      summaryEl.style.fontWeight = '600';
      summaryEl.style.marginBottom = '8px';
      summaryEl.textContent = failed.length + ' photo' + (failed.length === 1 ? '' : 's') + ' failed permanently';
      details.appendChild(summaryEl);

      for (const [msg, indices] of groups) {
        const groupDiv = el('div', { marginBottom: '8px', paddingLeft: '8px' });
        const label = el('div', { fontWeight: '600' });
        label.textContent = indices.length + ' x ' + msg;
        groupDiv.appendChild(label);
        const idxDiv = el('div', { paddingLeft: '8px', wordBreak: 'break-word' });
        idxDiv.textContent = indices.join(', ');
        groupDiv.appendChild(idxDiv);
        details.appendChild(groupDiv);
      }

      card.appendChild(details);
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
// Zip Generation & Download
// ============================================================================

async function buildAndDownloadZip(blobs, petName, theme, progress) {
  const zip = new JSZip();
  const name = petName || 'pet';

  for (let i = 0; i < blobs.length; i++) {
    const { blob, date, id } = blobs[i];
    const num = String(blobs[i].sortIdx + 1).padStart(4, '0');
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
  if (confirmBackdrop) confirmBackdrop.remove();

  let controller = new AbortController();
  let cancelled = false;
  const blobs = [];
  let totalBytes = 0;
  let totalFetchTime = 0;
  let fetchCount = 0;
  const completedIndices = new Set();
  const errorTracks = new Map();
  const retryQueue = [];
  const overallStartTime = Date.now();

  function trackError(idx, status, category) {
    if (!errorTracks.has(idx)) {
      errorTracks.set(idx, { photoIndex: idx, attempts: [], finalCategory: null, eligibleAt: null });
    }
    const track = errorTracks.get(idx);
    track.attempts.push({ status, category, timestamp: Date.now() });
    return track;
  }

  function getFailCount() {
    let count = 0;
    for (const track of errorTracks.values()) {
      if (!completedIndices.has(track.photoIndex) || track.finalCategory) count++;
    }
    return count;
  }

  function handleCancel() {
    cancelled = true;
    controller.abort();
  }

  const progress = showProgress(photos.length, petName, theme, handleCancel, overallStartTime);

  function updateProgress() {
    progress.update(completedIndices.size, totalBytes, fetchCount, totalFetchTime, getFailCount());
  }

  async function attemptFetch(idx, signal) {
    const photo = photos[idx];
    const url = getFullQualityUrl(photo);
    if (!url) {
      const track = trackError(idx, null, ErrorCategory.PERMANENT);
      track.finalCategory = ErrorCategory.PERMANENT;
      completedIndices.add(idx);
      return null;
    }

    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return { ok: false, error: e, response: null, elapsed: Date.now() - t0 };
    }

    if (!res.ok) {
      return { ok: false, error: new Error('HTTP ' + res.status), response: res, elapsed: Date.now() - t0 };
    }

    const blob = await res.blob();
    return { ok: true, blob, response: res, elapsed: Date.now() - t0 };
  }

  async function initialPass() {
    cancelled = false;
    controller = new AbortController();

    if (completedIndices.size > 0) updateProgress();

    const queue = [];
    for (let idx = 0; idx < photos.length; idx++) {
      if (!completedIndices.has(idx)) queue.push(idx);
    }
    let queuePos = 0;

    async function worker() {
      while (!cancelled && queuePos < queue.length) {
        const idx = queue[queuePos++];
        const photo = photos[idx];

        let succeeded = false;
        for (let attempt = 0; attempt <= MAX_INLINE_RETRIES; attempt++) {
          let result;
          try {
            result = await attemptFetch(idx, controller.signal);
          } catch (e) {
            if (e.name === 'AbortError') { cancelled = true; return; }
            throw e;
          }

          if (result === null) {
            updateProgress();
            succeeded = true;
            break;
          }

          if (result.ok) {
            totalFetchTime += result.elapsed;
            fetchCount++;
            totalBytes += result.blob.size;
            const photoDate = parseDate(photo.added);
            blobs.push({ blob: result.blob, date: photoDate, id: photo.pk || photo.id || idx, sortIdx: idx });
            completedIndices.add(idx);
            if (errorTracks.has(idx)) errorTracks.delete(idx);
            succeeded = true;
            updateProgress();
            break;
          }

          const { category, retryAfterMs } = classifyError(result.error, result.response);
          const status = result.response ? result.response.status : 'network';
          const track = trackError(idx, status, category);

          if (category === ErrorCategory.PERMANENT) {
            track.finalCategory = ErrorCategory.PERMANENT;
            completedIndices.add(idx);
            succeeded = true;
            updateProgress();
            break;
          }

          if (category === ErrorCategory.RATE_LIMITED) {
            track.eligibleAt = Date.now() + (retryAfterMs || RETRY_PHASE_BACKOFF[0]);
            retryQueue.push(idx);
            succeeded = true;
            updateProgress();
            break;
          }

          // Transient -- inline retry if attempts remain
          if (attempt < MAX_INLINE_RETRIES) {
            try {
              await sleep(INLINE_BACKOFF[attempt], controller.signal);
            } catch (e) {
              if (e.name === 'AbortError') { cancelled = true; return; }
            }
          } else {
            retryQueue.push(idx);
            succeeded = true;
            updateProgress();
          }
        }

        if (!succeeded) updateProgress();
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  }

  async function retryPhase() {
    if (retryQueue.length === 0) return;

    cancelled = false;
    controller = new AbortController();

    retryQueue.sort((a, b) => {
      const aTime = (errorTracks.get(a) || {}).eligibleAt || 0;
      const bTime = (errorTracks.get(b) || {}).eligibleAt || 0;
      return aTime - bTime;
    });

    progress.setStatus('Retrying ' + retryQueue.length + ' photos...');

    let i = 0;
    while (!cancelled && i < retryQueue.length) {
      const idx = retryQueue[i];
      const track = errorTracks.get(idx);

      if (!track || track.finalCategory || track.attempts.length >= MAX_TOTAL_ATTEMPTS) {
        i++;
        continue;
      }

      // Wait for eligibility with countdown
      const now = Date.now();
      if (track.eligibleAt && track.eligibleAt > now) {
        const countdownEnd = track.eligibleAt;
        while (Date.now() < countdownEnd && !cancelled) {
          const remaining = Math.ceil((countdownEnd - Date.now()) / 1000);
          const photosLeft = retryQueue.length - i;
          progress.setStatus('Retrying ' + photosLeft + ' photos (next attempt in ' + remaining + 's...)');
          try {
            await sleep(Math.min(1000, countdownEnd - Date.now()), controller.signal);
          } catch (e) {
            if (e.name === 'AbortError') { cancelled = true; break; }
          }
        }
        if (cancelled) break;
      }

      const retryPhaseAttempt = track.attempts.length - Math.min(track.attempts.length, 3);
      const photo = photos[idx];

      let result;
      try {
        result = await attemptFetch(idx, controller.signal);
      } catch (e) {
        if (e.name === 'AbortError') { cancelled = true; break; }
        throw e;
      }

      if (result === null) {
        track.finalCategory = ErrorCategory.PERMANENT;
        completedIndices.add(idx);
        i++;
        updateProgress();
        continue;
      }

      if (result.ok) {
        totalFetchTime += result.elapsed;
        fetchCount++;
        totalBytes += result.blob.size;
        const photoDate = parseDate(photo.added);
        blobs.push({ blob: result.blob, date: photoDate, id: photo.pk || photo.id || idx, sortIdx: idx });
        completedIndices.add(idx);
        errorTracks.delete(idx);
        i++;
        updateProgress();
        progress.setStatus('Retrying ' + Math.max(0, retryQueue.length - i) + ' photos...');
        continue;
      }

      const { category, retryAfterMs } = classifyError(result.error, result.response);
      const status = result.response ? result.response.status : 'network';
      trackError(idx, status, category);

      if (category === ErrorCategory.PERMANENT) {
        track.finalCategory = ErrorCategory.PERMANENT;
        completedIndices.add(idx);
        i++;
        updateProgress();
        const remaining = retryQueue.slice(i).filter(qi => {
          const t = errorTracks.get(qi);
          return t && !t.finalCategory && t.attempts.length < MAX_TOTAL_ATTEMPTS;
        });
        if (remaining.length === 0) break;
        continue;
      }

      if (track.attempts.length >= MAX_TOTAL_ATTEMPTS) {
        track.finalCategory = track.attempts[track.attempts.length - 1].category;
        completedIndices.add(idx);
        i++;
        updateProgress();
        continue;
      }

      // Still retryable -- update eligibility and move to end
      if (category === ErrorCategory.RATE_LIMITED && retryAfterMs) {
        track.eligibleAt = Date.now() + retryAfterMs;
      } else {
        const backoffIdx = Math.min(retryPhaseAttempt, RETRY_PHASE_BACKOFF.length - 1);
        track.eligibleAt = Date.now() + RETRY_PHASE_BACKOFF[backoffIdx];
      }
      retryQueue.push(retryQueue.splice(i, 1)[0]);
    }

    // Mark remaining queued items as final
    for (let j = i; j < retryQueue.length; j++) {
      const track = errorTracks.get(retryQueue[j]);
      if (track && !track.finalCategory) {
        track.finalCategory = track.attempts.length > 0 ? track.attempts[track.attempts.length - 1].category : ErrorCategory.TRANSIENT;
        completedIndices.add(retryQueue[j]);
      }
    }
  }

  function handleCancelUI() {
    if (blobs.length > 0) {
      const permFails = [...errorTracks.values()].filter(t => t.finalCategory).length;
      const queuedFails = [...errorTracks.values()].filter(t => !t.finalCategory).length;
      const totalFails = permFails + queuedFails;
      progress.showCancelConfirm(
        blobs.length,
        photos.length,
        totalFails,
        () => run(),
        downloadPartial,
        () => progress.backdrop.remove(),
      );
    } else {
      progress.backdrop.remove();
    }
  }

  async function downloadPartial() {
    const sorted = blobs.slice().sort((a, b) => a.sortIdx - b.sortIdx);
    try {
      const zipSize = await buildAndDownloadZip(sorted, petName, theme, progress);
      const zipMB = (zipSize / (1024 * 1024)).toFixed(1);
      const permFails = [...errorTracks.values()].filter(t => t.finalCategory).length;
      const queuedFails = [...errorTracks.values()].filter(t => !t.finalCategory).length;
      const totalFails = permFails + queuedFails;
      if (totalFails > 0) {
        progress.setStatus('Done! ' + blobs.length + ' photos downloaded (' + totalFails + ' failed) \u2014 ' + zipMB + ' MB');
        progress.showFailureReport(errorTracks, theme);
      } else {
        progress.setStatus('Done! ' + blobs.length + ' photos downloaded \u2014 ' + zipMB + ' MB');
      }
      progress.showOK();
    } catch (e) {
      progress.setStatus('Failed to build zip: ' + e.message);
      progress.showOK();
    }
  }

  async function run() {
    await initialPass();

    if (cancelled) {
      handleCancelUI();
      return;
    }

    await retryPhase();

    if (cancelled) {
      handleCancelUI();
      return;
    }

    blobs.sort((a, b) => a.sortIdx - b.sortIdx);

    try {
      const zipSize = await buildAndDownloadZip(blobs, petName, theme, progress);
      const zipMB = (zipSize / (1024 * 1024)).toFixed(1);
      const permFails = getFailCount();

      if (permFails > 0) {
        progress.setStatus('Done! ' + blobs.length + ' of ' + photos.length + ' photos (' + permFails + ' failed) \u2014 ' + zipMB + ' MB');
        progress.showFailureReport(errorTracks, theme);
      } else {
        progress.setStatus('Done! ' + blobs.length + ' photos downloaded \u2014 ' + zipMB + ' MB');
      }

      progress.showOK();
    } catch (e) {
      progress.setStatus('Failed to build zip: ' + e.message);
      progress.showOK();
    }
  }

  await run();
}

// ============================================================================
// Main Entry Point
// ============================================================================

(async function main() {
  if (document.querySelector('[data-rover-dumper]')) return;

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
    let retrying = false;
    const photos = await fetchAllMetadata(opk, null, (loaded, total) => {
      loadingMsg.textContent = 'Loading photo metadata... ' + loaded + ' / ' + total + (retrying ? ' (retrying...)' : '');
    }, (isRetrying) => {
      retrying = isRetrying;
      const current = loadingMsg.textContent;
      if (isRetrying && !current.includes('(retrying...)')) {
        loadingMsg.textContent = current + ' (retrying...)';
      } else if (!isRetrying) {
        loadingMsg.textContent = current.replace(' (retrying...)', '');
      }
    });

    // Remove loading screen
    loadingBackdrop.remove();

    // Show confirmation with filters
    showConfirmation(photos, petName, theme, (selectedPhotos, confirmBackdrop) => {
      downloadPhotos(selectedPhotos, petName, theme, confirmBackdrop);
    });
  } catch (e) {
    loadingBackdrop.remove();

    if (e.message === ERR_AUTH) {
      showError('Please log into Rover.com and try again.', theme);
    } else if (e.message === ERR_NO_PHOTOS) {
      const displayName = petName ? petName.charAt(0).toUpperCase() + petName.slice(1) : 'this pet';
      showError(`No photos found for ${displayName}.`, theme);
    } else {
      showError('Something went wrong: ' + e.message, theme);
    }
  }
})();
