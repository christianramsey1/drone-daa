// api/aviation/taf.js — Terminal Aerodrome Forecast for DroneDAA
// GET /api/aviation/taf?ids=KIAD
//
// Only ~700 US airports issue TAFs, so an empty result is normal, not an
// error — the client renders "no TAF issued" for those stations.

const {
  fetchDataset,
  normalizeClouds,
  createCache,
} = require("../shared/aviationweather");

const CACHE_TTL_MS = 10 * 60 * 1000; // TAFs are issued every ~6 hours
const cache = createCache(CACHE_TTL_MS);

// Upstream units: wspd/wgst knots, visib statute miles (or "6+"),
// cloud base ft AGL, times unix seconds.
function normalizePeriod(p) {
  const visNum =
    typeof p.visib === "number" ? p.visib : parseFloat(String(p.visib));
  return {
    timeFrom: p.timeFrom ? p.timeFrom * 1000 : null,
    timeTo: p.timeTo ? p.timeTo * 1000 : null,
    /** null for the initial period, else FM / TEMPO / BECMG / PROB */
    changeType: p.fcstChange ?? null,
    probability: p.probability ?? null,
    windDirDeg: p.wdir ?? null,
    windSpeedKt: p.wspd ?? null,
    windGustKt: p.wgst ?? null,
    windShearHeightFt: p.wshearHgt ?? null,
    windShearDirDeg: p.wshearDir ?? null,
    windShearSpeedKt: p.wshearSpd ?? null,
    visibilitySm: Number.isFinite(visNum) ? visNum : null,
    visibilityRaw: p.visib ?? null,
    vertVisFt: p.vertVis ?? null,
    wxString: p.wxString ?? null,
    clouds: normalizeClouds(p.clouds),
  };
}

function normalize(t) {
  return {
    icaoId: t.icaoId,
    name: t.name ?? null,
    issueTime: t.issueTime ?? null,
    validFrom: t.validTimeFrom ? t.validTimeFrom * 1000 : null,
    validTo: t.validTimeTo ? t.validTimeTo * 1000 : null,
    rawTaf: t.rawTAF ?? null,
    periods: Array.isArray(t.fcsts) ? t.fcsts.map(normalizePeriod) : [],
  };
}

module.exports = async (req, res) => {
  const { ids } = req.query || {};

  if (!ids) {
    res.status(400).json({ ok: false, error: "ids parameter required" });
    return;
  }

  const station = String(ids).toUpperCase();

  try {
    let taf = cache.get(station);
    if (taf === null) {
      const raw = await fetchDataset("taf", `ids=${encodeURIComponent(station)}`);
      // Upstream can return several bulletins; prefer the most recent.
      const best =
        raw.find((t) => t.mostRecent === 1) ?? raw[0] ?? null;
      taf = best ? normalize(best) : false; // false = "fetched, none issued"
      cache.set(station, taf);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=600");
    res.status(200).json({
      ok: true,
      source: "aviationweather.gov",
      fetchedAtUtc: new Date().toISOString(),
      taf: taf || null,
    });
  } catch (err) {
    console.error("[TAF] Failed:", err);
    res.status(502).json({
      ok: false,
      error: String(err?.message || err || "unknown"),
      source: "taf-error",
      fetchedAtUtc: new Date().toISOString(),
    });
  }
};
