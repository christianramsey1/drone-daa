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
  "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows";

/**
 * All US regions (CONUS plus Alaska, Hawaii, Caribbean, Guam).
 *
 * NOTE: NOAA publishes this mosaic through two different services, and the
 * other one is a trap — mapservices.weather.noaa.gov (IDP) renders nothing
 * above about z8 and returns ~80 KB tiles, so at this app's zoom levels it
 * showed a heavily upscaled blur. nowCOAST serves real detail to z15 at
 * roughly a tenth the bytes. Both were checked by counting opaque pixels,
 * and this one's georeferencing was cross-checked against an independent
 * NEXRAD renderer on storm-edge tiles.
 */
const NWS_RADAR_LAYER = "base_reflectivity_mosaic";

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
  /** ISO8601 frame time from /api/aviation/radar-frames; omit for latest. */
  frameTime?: string | null,
): string {
  const { minX, minY, maxX, maxY } = tileBboxMercator(z, x, y);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: NWS_RADAR_LAYER,
    styles: "",
    format: "image/png",
    transparent: "true",
    width: "256",
    height: "256",
    // EPSG:3857 is a projected CRS, so 1.3.0 keeps easting/northing order —
    // no axis swap to worry about (verified against a second radar source).
    crs: "EPSG:3857",
    bbox: `${minX},${minY},${maxX},${maxY}`,
  });
  if (frameTime) {
    // Requesting a specific frame makes the URL self-identifying, so the
    // browser cache can serve it on later animation loops.
    params.set("time", frameTime);
  } else {
    params.set("frame", String(refreshToken));
  }
  return `${NWS_RADAR_WMS}?${params.toString()}`;
}

/**
 * Radar resolution is about 1 km, so z12 already exceeds what the data can
 * actually resolve; past it the maps upscale rather than fetching more tiles
 * that carry no extra information.
 */
export const RADAR_MAX_NATIVE_ZOOM = 12;

/** The mosaic updates every few minutes. */
export const RADAR_REFRESH_MS = 4 * 60 * 1000;

/** Matches defender — dense enough to read, light enough to see the map. */
export const RADAR_OPACITY = 0.55;

export const RADAR_ATTRIBUTION = "NOAA / NWS nowCOAST";

/** Frames pulled for the animation loop — 8 x 4 min covers about half an hour. */
export const RADAR_ANIMATION_FRAMES = 8;

/** Milliseconds each frame is held during playback. */
export const RADAR_FRAME_HOLD_MS = 500;

/** Extra pause on the newest frame so the loop reads as "now". */
export const RADAR_LOOP_PAUSE_MS = 1200;

/** Reflectivity bands, in the order a storm builds. */
export const RADAR_LEGEND: Array<{ label: string; color: string }> = [
  { label: "Light", color: "#04e9e7" },
  { label: "Moderate", color: "#02fd02" },
  { label: "Heavy", color: "#fdf802" },
  { label: "Intense", color: "#fd0000" },
  { label: "Extreme", color: "#f800fd" },
];
