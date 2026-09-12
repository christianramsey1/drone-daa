// web/src/services/radar.ts — NWS radar precipitation mosaic overlay
//
// Source: the NWS IDP base-reflectivity mosaic (the national radar mosaic),
// the same service the defender project uses. No API key, CORS-open, and
// tiles load through <img> so cross-origin isn't a concern either way.
//
// The service speaks WMS only — there is no {z}/{x}/{y} endpoint — so each
// tile URL is built by converting the tile into its Web Mercator bounding
// box. That also lets the same URL builder feed both map engines: Leaflet
// on the topo layer and MapKit on the Apple layer.

const NWS_RADAR_WMS =
  "https://mapservices.weather.noaa.gov/eventdriven/services/radar/radar_base_reflectivity/MapServer/WMSServer";

/**
 * Sublayer "1" is the mosaic that actually renders pixels. Sublayer "3"
 * returns a valid but fully transparent PNG — verified by counting opaque
 * pixels, not just by getting a 200 back.
 */
const NWS_RADAR_LAYER = "1";

/** Half the circumference of the Web Mercator world, in meters. */
const MERCATOR_EXTENT = 20037508.342789244;

/** Web Mercator (EPSG:3857) bounding box of an XYZ tile. */
export function tileBboxMercator(z: number, x: number, y: number) {
  const size = (MERCATOR_EXTENT * 2) / Math.pow(2, z);
  const minX = -MERCATOR_EXTENT + x * size;
  const maxY = MERCATOR_EXTENT - y * size;
  return { minX, minY: maxY - size, maxX: minX + size, maxY };
}

/**
 * WMS GetMap URL for one radar tile.
 *
 * `refreshToken` only defeats HTTP caching between refreshes — the service
 * always serves its latest frame and ignores the parameter.
 */
export function radarTileUrl(
  x: number,
  y: number,
  z: number,
  refreshToken: number,
): string {
  const { minX, minY, maxX, maxY } = tileBboxMercator(z, x, y);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: NWS_RADAR_LAYER,
    styles: "",
    format: "image/png",
    transparent: "true",
    width: "256",
    height: "256",
    srs: "EPSG:3857",
    bbox: `${minX},${minY},${maxX},${maxY}`,
    frame: String(refreshToken),
  });
  return `${NWS_RADAR_WMS}?${params.toString()}`;
}

/**
 * The service renders this mosaic only down to about z8 — beyond that it
 * returns valid-but-empty PNGs (verified by pixel-counting from z5 to z13).
 * Maps upscale these tiles for closer zooms instead of requesting nothing.
 */
export const RADAR_MAX_NATIVE_ZOOM = 8;

/** The mosaic updates every few minutes. */
export const RADAR_REFRESH_MS = 4 * 60 * 1000;

/** Matches defender — dense enough to read, light enough to see the map. */
export const RADAR_OPACITY = 0.55;

export const RADAR_ATTRIBUTION = "NOAA / NWS";

/** Reflectivity bands, in the order a storm builds. */
export const RADAR_LEGEND: Array<{ label: string; color: string }> = [
  { label: "Light", color: "#04e9e7" },
  { label: "Moderate", color: "#02fd02" },
  { label: "Heavy", color: "#fdf802" },
  { label: "Intense", color: "#fd0000" },
  { label: "Extreme", color: "#f800fd" },
];
