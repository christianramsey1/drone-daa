/**
 * Shared helpers for the aviationweather.gov (NOAA/NWS) proxies.
 *
 * Used by api/aviation/metar.js and api/aviation/taf.js. Upstream needs no
 * API key but has no CORS headers, so all client access goes through us —
 * which also lets us cache and do the nearest-station math server-side.
 */

const BASE = "https://aviationweather.gov/api/data";

/**
 * GET an upstream dataset as JSON.
 * Upstream answers 204/empty for stations with nothing to report (e.g. a
 * small field with no TAF) — that is "no data", never an error, so this
 * always resolves to an array.
 */
async function fetchDataset(dataset, query) {
  const res = await fetch(`${BASE}/${dataset}?${query}&format=json`, {
    headers: { "User-Agent": "DroneDAA (detectandavoid.com)" },
  });
  if (!res.ok) throw new Error(`aviationweather.gov ${dataset} ${res.status}`);
  if (res.status === 204) return [];
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    const body = JSON.parse(text);
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // nautical miles
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dPhi = p2 - p1;
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** hectopascals → inches of mercury (upstream reports altimeter in hPa). */
function hpaToInHg(hpa) {
  if (typeof hpa !== "number" || !Number.isFinite(hpa)) return null;
  return Math.round((hpa / 33.8639) * 100) / 100;
}

function normalizeClouds(clouds) {
  return Array.isArray(clouds)
    ? clouds.map((c) => ({ cover: c.cover, baseFt: c.base ?? null }))
    : [];
}

/** Small TTL cache — these processes stay warm between serverless invocations. */
function createCache(ttlMs, maxEntries = 200) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (hit && Date.now() - hit.ts < ttlMs) return hit.data;
      return null;
    },
    set(key, data) {
      map.set(key, { data, ts: Date.now() });
      if (map.size > maxEntries) {
        const oldest = [...map.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) map.delete(oldest[0]);
      }
    },
  };
}

module.exports = {
  fetchDataset,
  distanceNm,
  hpaToInHg,
  normalizeClouds,
  createCache,
};
