// web/src/services/CachedTileLayer.ts — Leaflet TileLayer with IndexedDB cache
import L from "leaflet";
import { getCachedTile, cacheTile } from "./offlineTiles";

export class CachedTileLayer extends L.TileLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("img") as HTMLImageElement;
    tile.alt = "";
    tile.setAttribute("role", "presentation");

    const { z } = coords;
    const x = coords.x;
    const y = coords.y;

    getCachedTile(z, x, y)
      .then((blob) => {
        if (blob) {
          tile.src = URL.createObjectURL(blob);
          done(undefined, tile);
        } else {
          const url = this.getTileUrl(coords);
          fetch(url)
            .then((res) => {
              if (!res.ok) throw new Error(`Tile fetch failed: ${res.status}`);
              return res.blob();
            })
            .then((fetchedBlob) => {
              // Only cache at zoom >= 10 to avoid bloating storage with wide-area tiles
              if (z >= 10) cacheTile(z, x, y, fetchedBlob).catch(() => {});
              tile.src = URL.createObjectURL(fetchedBlob);
              done(undefined, tile);
            })
            .catch((err) => {
              done(err, tile);
            });
        }
      })
      .catch((err) => {
        done(err, tile);
      });

    return tile;
  }
}
