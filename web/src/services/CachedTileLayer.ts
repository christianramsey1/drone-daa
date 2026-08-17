// web/src/services/CachedTileLayer.ts — Leaflet TileLayer with IndexedDB cache
import L from "leaflet";
import { getCachedTile, cacheTile, tileFetch } from "./offlineTiles";

// WKWebView's IndexedDB can stall for seconds (or hang outright after the
// app backgrounds). Never let a cache lookup block a tile from loading —
// if the cache doesn't answer quickly, fall through to the network.
const CACHE_LOOKUP_TIMEOUT_MS = 350;

function cacheLookupWithTimeout(z: number, x: number, y: number): Promise<Blob | null> {
  return Promise.race([
    getCachedTile(z, x, y).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CACHE_LOOKUP_TIMEOUT_MS)),
  ]);
}

export class CachedTileLayer extends L.TileLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("img") as HTMLImageElement;
    tile.alt = "";
    tile.setAttribute("role", "presentation");

    const { z } = coords;
    const x = coords.x;
    const y = coords.y;

    cacheLookupWithTimeout(z, x, y).then((blob) => {
      if (blob) {
        const objUrl = URL.createObjectURL(blob);
        tile.onload = () => {
          URL.revokeObjectURL(objUrl);
          done(undefined, tile);
        };
        tile.onerror = () => {
          URL.revokeObjectURL(objUrl);
          done(new Error("cached tile decode failed"), tile);
        };
        tile.src = objUrl;
      } else {
        // Load directly via the <img> like stock Leaflet — browser-managed
        // networking, no fetch() and no IndexedDB on the critical path.
        // (The fetch-first version dropped whole swaths on iPhone/iPad.)
        const url = this.getTileUrl(coords);
        tile.onload = () => {
          done(undefined, tile);
          // Opportunistically cache for offline use (zoom >= 10 only, to
          // avoid bloating storage with wide-area tiles). The HTTP cache
          // typically serves this second request without a re-download.
          if (z >= 10) {
            tileFetch(url)
              .then((res) => (res.ok ? res.blob() : null))
              .then((b) => { if (b) return cacheTile(z, x, y, b); })
              .catch(() => {});
          }
        };
        tile.onerror = () => {
          done(new Error("tile load failed"), tile);
        };
        tile.src = url;
      }
    });

    return tile;
  }
}
