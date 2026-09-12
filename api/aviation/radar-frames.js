// api/aviation/radar-frames.js — recent radar mosaic frame times
// GET /api/aviation/radar-frames[?n=8]
//
// The NWS mosaic advertises its available frames in a WMS capabilities
// document (~37 KB of XML covering every US region and ~8 hours of history).
// Clients only need the last handful of timestamps for the CONUS-wide layer,
// so the parsing happens here and phones fetch about a kilobyte instead.

const { createCache } = require("../shared/aviationweather");

const CAPABILITIES_URL =
  "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows" +
  "?service=WMS&version=1.3.0&request=GetCapabilities";

/** Must match the layer the client renders (services/radar.ts). */
const LAYER = "base_reflectivity_mosaic";

const DEFAULT_COUNT = 8;
const MAX_COUNT = 20;

// Frames publish about every 4 minutes; re-reading capabilities more often
// than that just moves bytes around for no new information.
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = createCache(CACHE_TTL_MS, 4);

/**
 * Pull the time dimension belonging to one layer. The document repeats the
 * same dimension name for every region, so the layer block has to be found
 * first rather than grabbing the first match in the file.
 */
function extractFrameTimes(xml, layerName) {
  const layerBlocks = xml.match(/<Layer[^>]*>[\s\S]*?<\/Layer>/g) || [];
  for (const block of layerBlocks) {
    const name = block.match(/<Name>([^<]+)<\/Name>/);
    if (!name || name[1] !== layerName) continue;
    const dim = block.match(/<Dimension name="time"[^>]*>([^<]+)<\/Dimension>/);
    if (!dim) continue;
    return dim[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

module.exports = async (req, res) => {
  const count = Math.min(
    Math.max(parseInt((req.query || {}).n, 10) || DEFAULT_COUNT, 2),
    MAX_COUNT,
  );

  try {
    let frames = cache.get(LAYER);
    if (!frames) {
      const upstream = await fetch(CAPABILITIES_URL, {
        headers: { "User-Agent": "DroneDAA (detectandavoid.com)" },
      });
      if (!upstream.ok) throw new Error(`nowCOAST ${upstream.status}`);
      frames = extractFrameTimes(await upstream.text(), LAYER);
      if (!frames.length) throw new Error("no time dimension for " + LAYER);
      cache.set(LAYER, frames);
    }

    const recent = frames.slice(-count);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=120");
    res.status(200).json({
      ok: true,
      source: "aviationweather.gov/nowcoast",
      layer: LAYER,
      fetchedAtUtc: new Date().toISOString(),
      /** Oldest → newest, ISO8601. Pass one back as the WMS `time` param. */
      frames: recent,
    });
  } catch (err) {
    console.error("[RadarFrames] Failed:", err);
    res.status(502).json({
      ok: false,
      error: String(err?.message || err || "unknown"),
      frames: [],
      fetchedAtUtc: new Date().toISOString(),
    });
  }
};
