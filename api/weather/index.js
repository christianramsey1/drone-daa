// api/weather/index.js — Generic weather endpoint for DroneDAA
// GET /api/weather?lat=X&lon=Y&timezone=America/New_York

const { fetchWeatherKit } = require("../shared/weatherkit");

module.exports = async (req, res) => {
  const { lat, lon, timezone } = req.query;

  if (!lat || !lon) {
    res.status(400).json({ ok: false, error: "Missing lat and lon query parameters" });
    return;
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    res.status(400).json({ ok: false, error: "Invalid lat/lon values" });
    return;
  }

  // Use rounded coordinates as cache key (reuses weatherkit's lakeId-based cache)
  const cacheKey = `geo:${latNum.toFixed(2)},${lonNum.toFixed(2)}`;
  const tz = timezone || "America/New_York";

  try {
    const data = await fetchWeatherKit({
      lat: latNum,
      lon: lonNum,
      timezone: tz,
      lakeId: cacheKey,
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(data);
  } catch (err) {
    console.error("[Weather] Failed:", err);
    res.status(500).json({
      ok: false,
      error: String(err?.message || err || "unknown"),
      source: "weatherkit-error",
      fetchedAtUtc: new Date().toISOString(),
    });
  }
};
