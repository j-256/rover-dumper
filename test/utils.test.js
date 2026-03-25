import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErrorCategory,
  classifyError,
  parseRetryAfter,
  getErrorMessage,
  getFullQualityUrl,
  sleep,
  parseDate,
  formatDateISO,
  formatElapsed,
} from '../src/utils.js';

// Minimal mock for Response-like objects
function mockRes(status, headers = {}) {
  return {
    status,
    headers: { get: (k) => headers[k] || null },
  };
}

// ============================================================================
// classifyError
// ============================================================================

describe('classifyError', () => {
  it('classifies 404 as permanent', () => {
    const { category } = classifyError(null, mockRes(404));
    assert.equal(category, ErrorCategory.PERMANENT);
  });

  it('classifies 400, 403, 410 as permanent', () => {
    for (const status of [400, 403, 410]) {
      const { category } = classifyError(null, mockRes(status));
      assert.equal(category, ErrorCategory.PERMANENT, 'status ' + status);
    }
  });

  it('classifies 429 as rate-limited', () => {
    const { category } = classifyError(null, mockRes(429));
    assert.equal(category, ErrorCategory.RATE_LIMITED);
  });

  it('classifies 503 with Retry-After as rate-limited', () => {
    const { category } = classifyError(null, mockRes(503, { 'Retry-After': '30' }));
    assert.equal(category, ErrorCategory.RATE_LIMITED);
  });

  it('classifies 503 without Retry-After as transient', () => {
    const { category } = classifyError(null, mockRes(503));
    assert.equal(category, ErrorCategory.TRANSIENT);
  });

  it('classifies 500, 502, 504 as transient', () => {
    for (const status of [500, 502, 504]) {
      const { category } = classifyError(null, mockRes(status));
      assert.equal(category, ErrorCategory.TRANSIENT, 'status ' + status);
    }
  });

  it('classifies network errors (no response) as transient', () => {
    const { category } = classifyError(new Error('network'), null);
    assert.equal(category, ErrorCategory.TRANSIENT);
  });

  it('returns retryAfterMs for 429 with Retry-After header', () => {
    const { retryAfterMs } = classifyError(null, mockRes(429, { 'Retry-After': '10' }));
    assert.equal(retryAfterMs, 10000);
  });

  it('returns default backoff when 429 has no Retry-After', () => {
    const { retryAfterMs } = classifyError(null, mockRes(429));
    assert.equal(retryAfterMs, 2000); // RETRY_PHASE_BACKOFF[0]
  });

  it('returns null retryAfterMs for permanent errors', () => {
    const { retryAfterMs } = classifyError(null, mockRes(404));
    assert.equal(retryAfterMs, null);
  });

  it('returns null retryAfterMs for transient errors', () => {
    const { retryAfterMs } = classifyError(null, mockRes(500));
    assert.equal(retryAfterMs, null);
  });
});

// ============================================================================
// parseRetryAfter
// ============================================================================

describe('parseRetryAfter', () => {
  it('parses numeric seconds', () => {
    assert.equal(parseRetryAfter(mockRes(429, { 'Retry-After': '30' })), 30000);
  });

  it('returns null for zero', () => {
    assert.equal(parseRetryAfter(mockRes(429, { 'Retry-After': '0' })), null);
  });

  it('returns null for negative', () => {
    assert.equal(parseRetryAfter(mockRes(429, { 'Retry-After': '-5' })), null);
  });

  it('returns null for missing header', () => {
    assert.equal(parseRetryAfter(mockRes(429)), null);
  });

  it('returns null for malformed value', () => {
    assert.equal(parseRetryAfter(mockRes(429, { 'Retry-After': 'garbage' })), null);
  });

  it('returns null for null/undefined response', () => {
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter(undefined), null);
  });

  it('parses future HTTP-date', () => {
    const future = new Date(Date.now() + 60000).toUTCString();
    const ms = parseRetryAfter(mockRes(429, { 'Retry-After': future }));
    assert.ok(ms > 50000 && ms <= 60000, 'expected ~60000ms, got ' + ms);
  });

  it('returns null for past HTTP-date', () => {
    const past = new Date(Date.now() - 10000).toUTCString();
    assert.equal(parseRetryAfter(mockRes(429, { 'Retry-After': past })), null);
  });
});

// ============================================================================
// getErrorMessage
// ============================================================================

describe('getErrorMessage', () => {
  it('returns message for null status (no URL)', () => {
    const track = { attempts: [{ status: null, category: ErrorCategory.PERMANENT }] };
    assert.equal(getErrorMessage(track), 'No image URL available');
  });

  it('returns message for 404', () => {
    const track = { attempts: [{ status: 404, category: ErrorCategory.PERMANENT }] };
    assert.match(getErrorMessage(track), /Not found \(404\)/);
  });

  it('returns message for 410', () => {
    const track = { attempts: [{ status: 410, category: ErrorCategory.PERMANENT }] };
    assert.match(getErrorMessage(track), /Gone \(410\)/);
  });

  it('returns message for 403', () => {
    const track = { attempts: [{ status: 403, category: ErrorCategory.PERMANENT }] };
    assert.match(getErrorMessage(track), /Access denied \(403\)/);
  });

  it('returns message for 500 with attempt count', () => {
    const track = { attempts: [
      { status: 500, category: ErrorCategory.TRANSIENT },
      { status: 500, category: ErrorCategory.TRANSIENT },
      { status: 500, category: ErrorCategory.TRANSIENT },
    ]};
    assert.match(getErrorMessage(track), /Server error \(500\) -- failed after 3 attempts/);
  });

  it('returns message for network error', () => {
    const track = { attempts: [{ status: 'network', category: ErrorCategory.TRANSIENT }] };
    assert.match(getErrorMessage(track), /Network error/);
  });

  it('returns Unknown error for empty attempts', () => {
    assert.equal(getErrorMessage({ attempts: [] }), 'Unknown error');
  });

  it('uses last attempt for message', () => {
    const track = { attempts: [
      { status: 500, category: ErrorCategory.TRANSIENT },
      { status: 404, category: ErrorCategory.PERMANENT },
    ]};
    assert.match(getErrorMessage(track), /Not found \(404\)/);
  });
});

// ============================================================================
// getFullQualityUrl
// ============================================================================

describe('getFullQualityUrl', () => {
  it('returns large_uncropped_retina first', () => {
    const photo = {
      large_uncropped_retina: 'https://cdn.rover.com/img1.jpg?w=800',
      large_uncropped: 'https://cdn.rover.com/img2.jpg',
    };
    assert.equal(getFullQualityUrl(photo), 'https://cdn.rover.com/img1.jpg');
  });

  it('falls back through field priority', () => {
    assert.equal(
      getFullQualityUrl({ medium: 'https://cdn.rover.com/m.jpg?q=80' }),
      'https://cdn.rover.com/m.jpg',
    );
    assert.equal(
      getFullQualityUrl({ small: 'https://cdn.rover.com/s.jpg' }),
      'https://cdn.rover.com/s.jpg',
    );
  });

  it('strips query params', () => {
    const photo = { large_uncropped: 'https://cdn.rover.com/photo.jpg?w=800&h=600&q=80' };
    assert.equal(getFullQualityUrl(photo), 'https://cdn.rover.com/photo.jpg');
  });

  it('returns null when no URL fields exist', () => {
    assert.equal(getFullQualityUrl({}), null);
    assert.equal(getFullQualityUrl({ id: 123 }), null);
  });
});

// ============================================================================
// sleep
// ============================================================================

describe('sleep', () => {
  it('resolves after delay', async () => {
    const t0 = Date.now();
    await sleep(50);
    assert.ok(Date.now() - t0 >= 45, 'should wait ~50ms');
  });

  it('rejects on abort', async () => {
    const controller = new AbortController();
    const p = sleep(10000, controller.signal);
    controller.abort();
    await assert.rejects(p, (err) => err.name === 'AbortError');
  });

  it('rejects immediately if already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      sleep(10000, controller.signal),
      (err) => err.name === 'AbortError',
    );
  });

  it('resolves without signal', async () => {
    await sleep(10);
  });
});

// ============================================================================
// parseDate
// ============================================================================

describe('parseDate', () => {
  it('parses ISO string', () => {
    const d = parseDate('2024-03-15T12:00:00Z');
    assert.ok(d instanceof Date);
    assert.equal(d.getUTCFullYear(), 2024);
  });

  it('returns null for null/undefined/empty', () => {
    assert.equal(parseDate(null), null);
    assert.equal(parseDate(undefined), null);
    assert.equal(parseDate(''), null);
  });

  it('returns null for invalid string', () => {
    assert.equal(parseDate('not-a-date'), null);
  });
});

// ============================================================================
// formatDateISO
// ============================================================================

describe('formatDateISO', () => {
  it('formats date as YYYY-MM-DD', () => {
    assert.equal(formatDateISO(new Date(2024, 2, 5)), '2024-03-05');
  });

  it('pads single-digit month and day', () => {
    assert.equal(formatDateISO(new Date(2024, 0, 1)), '2024-01-01');
  });
});

// ============================================================================
// formatElapsed
// ============================================================================

describe('formatElapsed', () => {
  it('formats seconds only', () => {
    assert.equal(formatElapsed(45), '45s');
  });

  it('formats minutes and seconds', () => {
    assert.equal(formatElapsed(125), '2m 5s');
  });

  it('formats zero', () => {
    assert.equal(formatElapsed(0), '0s');
  });
});
