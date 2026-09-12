// api/aviation/metar.js — Nearest METAR observations for DroneDAA
// GET /api/aviation/metar?lat=X&lon=Y[&n=3]   → n nearest reporting stations
// GET /api/aviation/metar?ids=KJYO[,KIAD]     → specific station(s)

const {
  fetchDataset,
  distanceNm,
  hpaToInHg,
  normalizeClouds,
  createCache,
} = require("../shared/aviationweather");

const CACHE_TTL_MS = 5 * 60 * 1000; // METARs publish hourly; 5 min is plenty
const DEFAULT_COUNT = 3;

const cache = createCache(CACHE_TTL_MS);

// Normalize an upstream record into the shape the app consumes.
// Units from upstream: temp/dewp °C, wspd/wgst knots, visib statute miles
// (sometimes a string like "10+"), altim hectopascals, cloud base ft AGL.
function normalize(m, fromLat, fromLon) {
  const visNum =
    typeof m.visib === "number" ? m.visib : parseFloat(String(m.visib));
  return {
    icaoId: m.icaoId,
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    elevM: m.elev ?? null,
    distanceNm:
      fromLat != null && m.lat != null
        ? Math.round(distanceNm(fromLat, fromLon, m.lat, m.lon) * 10) / 10
        : null,
    obsTime: m.obsTime ? m.obsTime * 1000 : null, // → ms epoch
    reportTime: m.reportTime ?? null,
    tempC: m.temp ?? null,
    dewpC: m.dewp ?? null,
    windDirDeg: m.wdir ?? null, // may be the string "VRB"
    windSpeedKt: m.wspd ?? null,
    windGustKt: m.wgst ?? null,
    visibilitySm: Number.isFinite(visNum) ? visNum : null,
    visibilityRaw: m.visib ?? null, // preserves "10+"
    altimeterInHg: hpaToInHg(m.altim),
    clouds: normalizeClouds(m.clouds),
    wxString: m.wxString ?? null,
    flightCategory: m.fltCat ?? null,
    rawOb: m.rawOb ?? null,
  };
}

module.exports = async (req, res) => {
  const { lat, lon, ids, n } = req.query || {};

  try {
    let stations;

    if (ids) {
      const key = `ids:${String(ids).toUpperCase()}`;
      stations = cache.get(key);
      if (!stations) {
        const raw = await fetchDataset(
          "metar",
          `ids=${encodeURIComponent(String(ids).toUpperCase())}`
        );
        stations = raw.map((m) => normalize(m, null, null));
        cache.set(key, stations);
      }
    } else {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
        res.status(400).json({ ok: false, error: "Provide lat and lon, or ids" });
        return;
      }

      const count = Math.min(Math.max(parseInt(n, 10) || DEFAULT_COUNT, 1), 10);
      const key = `geo:${latNum.toFixed(1)},${lonNum.toFixed(1)}:${count}`;
      stations = cache.get(key);

      if (!stations) {
        // Widen the search until enough reporting stations are found. Most of
        // the US resolves on the first pass; sparse areas fall through.
        let raw = [];
        for (const pad of [1.0, 2.0, 4.0]) {
          const bbox = [
            (latNum - pad).toFixed(2),
            (lonNum - pad).toFixed(2),
            (latNum + pad).toFixed(2),
            (lonNum + pad).toFixed(2),
          ].join(",");
          raw = await fetchDataset("metar", `bbox=${bbox}`);
          if (raw.length >= count) break;
        }

        stations = raw
          .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon))
          .map((m) => normalize(m, latNum, lonNum))
          .sort((a, b) => (a.distanceNm ?? 1e9) - (b.distanceNm ?? 1e9))
          .slice(0, count);

        cache.set(key, stations);
      }
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      ok: true,
      source: "aviationweather.gov",
      fetchedAtUtc: new Date().toISOString(),
      stations,
    });
  } catch (err) {
    console.error("[METAR] Failed:", err);
    res.status(502).json({
      ok: false,
      error: String(err?.message || err || "unknown"),
      source: "metar-error",
      fetchedAtUtc: new Date().toISOString(),
    });
  }
};
