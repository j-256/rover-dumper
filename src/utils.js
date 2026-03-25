// ============================================================================
// Configuration (retry)
// ============================================================================

export const ErrorCategory = Object.freeze({
  PERMANENT: 'permanent',
  RATE_LIMITED: 'rate-limited',
  TRANSIENT: 'transient',
});

export const RETRY_PHASE_BACKOFF = [2000, 4000, 8000, 16000, 32000];

// ============================================================================
// Error Classification & Retry Helpers
// ============================================================================

export function parseRetryAfter(res) {
  if (!res || !res.headers) return null;
  const val = res.headers.get('Retry-After');
  if (!val) return null;
  const seconds = Number(val);
  if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(val);
  if (!isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : null;
  }
  return null;
}

export function classifyError(error, res) {
  if (res) {
    const s = res.status;
    if (s === 400 || s === 403 || s === 404 || s === 410) {
      return { category: ErrorCategory.PERMANENT, retryAfterMs: null };
    }
    if (s === 429 || (s === 503 && res.headers.get('Retry-After'))) {
      const retryAfterMs = parseRetryAfter(res) || RETRY_PHASE_BACKOFF[0];
      return { category: ErrorCategory.RATE_LIMITED, retryAfterMs };
    }
    if (s >= 500) {
      return { category: ErrorCategory.TRANSIENT, retryAfterMs: null };
    }
  }
  return { category: ErrorCategory.TRANSIENT, retryAfterMs: null };
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); return; }
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function getErrorMessage(track) {
  const last = track.attempts[track.attempts.length - 1];
  if (!last) return 'Unknown error';
  const s = last.status;
  const n = track.attempts.length;
  if (s === null) return 'No image URL available';
  if (s === 404) return 'Not found (404) -- photos may have been deleted';
  if (s === 410) return 'Gone (410) -- photos have been removed';
  if (s === 400 || s === 403) return 'Access denied (' + s + ')';
  if (s === 'network') return 'Network error -- failed after ' + n + ' attempts';
  if (typeof s === 'number' && s >= 500) return 'Server error (' + s + ') -- failed after ' + n + ' attempts';
  return 'Error (' + s + ') -- failed after ' + n + ' attempts';
}

// ============================================================================
// Image URL Extraction
// ============================================================================

export function getFullQualityUrl(photo) {
  const fields = ['large_uncropped_retina', 'large_uncropped', 'medium', 'small'];
  let url = null;
  for (const field of fields) {
    if (photo[field]) {
      url = photo[field];
      break;
    }
  }
  if (!url) return null;
  return url.split('?')[0];
}

// ============================================================================
// Date Helpers
// ============================================================================

export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function formatDateShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? m + 'm ' + s + 's' : s + 's';
}
