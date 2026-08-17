// web/src/services/offlineTiles.ts — IndexedDB tile caching for offline topo maps

const DB_NAME = "dronedaa-tiles";
const DB_VERSION = 3;
const STORE_NAME = "tiles";
const FAA_STORE_NAME = "faaLayers";

/**
 * Topo base-layer tile source: USGS The National Map. Government-run with no
 * community rate limits — OpenTopoMap (the previous source) throttles heavily
 * and was dropping tile swaths on iPhone/iPad. US-only coverage, which is all
 * an FAA-focused app needs. Note the {z}/{y}/{x} path order, native max zoom 16.
 */
export const TOPO_URL_TEMPLATE =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";
export const TOPO_MAX_NATIVE_ZOOM = 16;
export const TOPO_ATTRIBUTION =
  '&copy; <a href="https://www.usgs.gov/">USGS</a> The National Map';

/**
 * Fetch to use for tile downloads. With CapacitorHttp enabled, Capacitor
 * replaces window.fetch with a native-bridge version that base64-marshals
 * every response across the JS bridge — far too slow for image tiles, and
 * it starves the map on iPhone/iPad. Capacitor keeps the original WKWebView
 * fetch as window.CapacitorWebFetch; tiles use it directly (the USGS tile
 * server sends Access-Control-Allow-Origin: *, so plain CORS works).
 */
export const tileFetch: typeof fetch =
  ((window as unknown as { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? window.fetch).bind(window);

let _db: IDBDatabase | null = null;

function openTileDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // v3: topo provider switched OpenTopoMap → USGS. Drop stale tiles so
      // cached imagery matches the live layer; users re-download offline areas.
      if (e.oldVersion > 0 && e.oldVersion < 3 && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(FAA_STORE_NAME)) {
        db.createObjectStore(FAA_STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedTile(z: number, x: number, y: number): Promise<Blob | null> {
  const db = await openTileDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(`${z}/${x}/${y}`);
    req.onsuccess = () => resolve(req.result?.blob ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function cacheTile(z: number, x: number, y: number, blob: Blob): Promise<void> {
  const db = await openTileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      key: `${z}/${x}/${y}`,
      blob,
      size: blob.size,
      fetchedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCacheStats(): Promise<{ tileCount: number; totalBytes: number }> {
  const db = await openTileDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    let tileCount = 0;
    let totalBytes = 0;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        tileCount++;
        totalBytes += c.value.size ?? 0;
        c.continue();
      } else {
        resolve({ tileCount, totalBytes });
      }
    };
    cursor.onerror = () => resolve({ tileCount: 0, totalBytes: 0 });
  });
}

export async function clearTileCache(): Promise<void> {
  const db = await openTileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

export function getTileCoordsForBbox(
  bbox: { south: number; west: number; north: number; east: number },
  zoom: number,
): Array<{ z: number; x: number; y: number }> {
  const topLeft = latLonToTile(bbox.north, bbox.west, zoom);
  const bottomRight = latLonToTile(bbox.south, bbox.east, zoom);
  const coords: Array<{ z: number; x: number; y: number }> = [];
  for (let x = topLeft.x; x <= bottomRight.x; x++) {
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      coords.push({ z: zoom, x, y });
    }
  }
  return coords;
}

const SUBDOMAINS = ["a", "b", "c"];

export async function downloadTilesForArea(
  bbox: { south: number; west: number; north: number; east: number },
  zoomMin: number,
  zoomMax: number,
  urlTemplate: string,
  onProgress: (downloaded: number, total: number, failed: number) => void,
  abortSignal?: AbortSignal,
): Promise<{ downloaded: number; failed: number; skipped: number }> {
  // Collect all tile coords
  const allCoords: Array<{ z: number; x: number; y: number }> = [];
  for (let z = zoomMin; z <= zoomMax; z++) {
    allCoords.push(...getTileCoordsForBbox(bbox, z));
  }

  const total = allCoords.length;
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  onProgress(0, total, 0);

  const BATCH_SIZE = 6;

  for (let i = 0; i < allCoords.length; i += BATCH_SIZE) {
    if (abortSignal?.aborted) break;

    const batch = allCoords.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ z, x, y }) => {
        // Check if already cached and fresh
        const existing = await getCachedTile(z, x, y);
        if (existing) {
          skipped++;
          return;
        }

        const s = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
        const url = urlTemplate
          .replace("{s}", s)
          .replace("{z}", String(z))
          .replace("{x}", String(x))
          .replace("{y}", String(y));

        const res = await tileFetch(url, { signal: abortSignal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        await cacheTile(z, x, y, blob);
        downloaded++;
      }),
    );

    for (const r of results) {
      if (r.status === "rejected") failed++;
    }

    onProgress(downloaded + skipped, total, failed);

    // Small delay between batches to be polite to tile servers
    if (i + BATCH_SIZE < allCoords.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return { downloaded, failed, skipped };
}

// ── FAA layer offline caching ──────────────────────────────────────────

function roundBboxKey(bbox: { south: number; west: number; north: number; east: number }): string {
  // Round to 2 decimal places for fuzzy matching
  return `${bbox.south.toFixed(2)},${bbox.west.toFixed(2)},${bbox.north.toFixed(2)},${bbox.east.toFixed(2)}`;
}

export async function cacheFaaLayer(
  layerId: string,
  bbox: { south: number; west: number; north: number; east: number },
  zonesJson: string,
): Promise<void> {
  const db = await openTileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAA_STORE_NAME, "readwrite");
    const store = tx.objectStore(FAA_STORE_NAME);
    store.put({
      key: `${layerId}:${roundBboxKey(bbox)}`,
      layerId,
      bbox: roundBboxKey(bbox),
      data: zonesJson,
      cachedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedFaaLayer(
  layerId: string,
  bbox: { south: number; west: number; north: number; east: number },
): Promise<string | null> {
  const db = await openTileDb();
  return new Promise((resolve) => {
    const tx = db.transaction(FAA_STORE_NAME, "readonly");
    const store = tx.objectStore(FAA_STORE_NAME);
    const req = store.get(`${layerId}:${roundBboxKey(bbox)}`);
    req.onsuccess = () => resolve(req.result?.data ?? null);
    req.onerror = () => resolve(null);
  });
}
