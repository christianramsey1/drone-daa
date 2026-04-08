/**
 * Simple in-memory rate limiter for serverless functions.
 * Uses a sliding window counter per IP.
 */

const windows = new Map();
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of windows) {
    if (now - entry.start > entry.windowMs * 2) {
      windows.delete(key);
    }
  }
}

/**
 * Check if a request should be rate-limited.
 *
 * @param {string} ip - Client IP address
 * @param {string} endpoint - Endpoint identifier (e.g., "auth")
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Window duration in ms
 * @returns {{ limited: boolean, remaining: number }}
 */
function checkRateLimit(ip, endpoint, maxRequests = 10, windowMs = 60_000) {
  cleanup();

  const key = `${endpoint}:${ip}`;
  const now = Date.now();
  let entry = windows.get(key);

  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0, windowMs };
    windows.set(key, entry);
  }

  entry.count++;

  return {
    limited: entry.count > maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
  };
}

module.exports = { checkRateLimit };
