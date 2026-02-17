/**
 * Shared WeatherKit utility for all lakes.
 *
 * Usage:
 *   const { fetchWeatherKit } = require("../shared/weatherkit");
 *   const data = await fetchWeatherKit({ lat, lon, timezone, lakeId });
 */

const fs = require("fs");
const path = require("path");

const TEAM_ID = "WNS326Z3DK";
const KEY_ID = "6W7H25SW4U";
const SERVICE_ID = "com.cramsey.lake360.web";

// Key path
const P8_PATH = path.join(
  process.cwd(),
  "api",
  "mapkit",
  "keys",
  `AuthKey_${KEY_ID}.p8`
);

function getPrivateKey() {
  if (process.env.MAPKIT_PRIVATE_KEY) {
    return process.env.MAPKIT_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  return fs.readFileSync(P8_PATH, "utf8");
}

/**
 * Generate a WeatherKit JWT token
 */
async function generateWeatherKitToken() {
  const { SignJWT, importPKCS8 } = await import("jose");

  const privateKeyPem = getPrivateKey();
  const key = await importPKCS8(privateKeyPem, "ES256");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60; // 1 hour

  return await new SignJWT({})
    .setProtectedHeader({
      alg: "ES256",
      kid: KEY_ID,
      id: `${TEAM_ID}.${SERVICE_ID}`,
    })
    .setIssuer(TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setSubject(SERVICE_ID)
    .sign(key);
}

// Unit conversion helpers
function celsiusToFahrenheit(c) {
  if (c == null || !Number.isFinite(c)) return null;
  return Math.round((c * 9) / 5 + 32);
}

function msToMph(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round(ms * 2.237);
}

// Per-lake cache
const _caches = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch weather from WeatherKit REST API
 *
 * @param {Object} options
 * @param {number} options.lat - Latitude
 * @param {number} options.lon - Longitude
 * @param {string} options.timezone - IANA timezone (e.g. "America/New_York")
 * @param {string} options.lakeId - Lake ID for caching
 */
async function fetchWeatherKit({ lat, lon, timezone, lakeId }) {
  const now = Date.now();
  const cached = _caches[lakeId];
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const token = await generateWeatherKitToken();

  const dataSets = [
    "currentWeather",
    "forecastHourly",
    "forecastDaily",
    "forecastNextHour",
    "weatherAlerts",
  ].join(",");

  const url = `https://weatherkit.apple.com/api/v1/weather/en_US/${lat}/${lon}?dataSets=${dataSets}&timezone=${timezone}&country=US`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`WeatherKit API error ${res.status}: ${errorText}`);
  }

  const data = await res.json();

  const current = data.currentWeather || {};
  const hourly = data.forecastHourly?.hours || [];
  const daily = data.forecastDaily?.days || [];
  const nextHour = data.forecastNextHour || null;
  const alerts = data.weatherAlerts?.alerts || [];

  const result = {
    ok: true,
    lakeId,
    source: "weatherkit",
    sourceUrl: "https://weatherkit.apple.com",
    fetchedAtUtc: new Date().toISOString(),

    current: {
      time: current.asOf,
      temperature_2m: celsiusToFahrenheit(current.temperature),
      temperatureApparent: celsiusToFahrenheit(current.temperatureApparent),
      humidity: current.humidity != null ? Math.round(current.humidity * 100) : null,
      wind_speed_10m: msToMph(current.windSpeed),
      wind_direction_10m: current.windDirection,
      wind_gusts_10m: msToMph(current.windGust),
      cloud_cover: current.cloudCover != null ? Math.round(current.cloudCover * 100) : null,
      visibility: current.visibility,
      pressure: current.pressure,
      uvIndex: current.uvIndex,
      conditionCode: current.conditionCode,
      daylight: current.daylight,
      precipitationIntensity: current.precipitationIntensity,
    },

    hourly: hourly.slice(0, 24).map((h) => ({
      time: h.forecastStart,
      temperature: celsiusToFahrenheit(h.temperature),
      temperatureApparent: celsiusToFahrenheit(h.temperatureApparent),
      precipitationChance: h.precipitationChance != null ? Math.round(h.precipitationChance * 100) : null,
      precipitationType: h.precipitationType,
      windSpeed: msToMph(h.windSpeed),
      windDirection: h.windDirection,
      conditionCode: h.conditionCode,
      uvIndex: h.uvIndex,
    })),

    daily: daily.slice(0, 7).map((d) => ({
      date: d.forecastStart,
      temperatureMax: celsiusToFahrenheit(d.temperatureMax),
      temperatureMin: celsiusToFahrenheit(d.temperatureMin),
      precipitationChance: d.precipitationChance != null ? Math.round(d.precipitationChance * 100) : null,
      precipitationType: d.precipitationType,
      conditionCode: d.conditionCode,
      sunrise: d.sunrise,
      sunset: d.sunset,
      uvIndexMax: d.uvIndexMax,
      windSpeedMax: msToMph(d.windSpeedMax),
    })),

    alerts: alerts.map((a) => ({
      id: a.id,
      headline: a.description,
      severity: a.severity,
      certainty: a.certainty,
      urgency: a.urgency,
      source: a.source,
      effectiveTime: a.effectiveTime,
      expireTime: a.expireTime,
      eventOnsetTime: a.eventOnsetTime,
      eventEndTime: a.eventEndTime,
      detailsUrl: a.detailsUrl,
      responses: a.responses,
      phenomenon: a.phenomenon,
      importance: a.importance,
    })),

    nextHour: nextHour ? {
      summary: nextHour.summary,
      minutes: (nextHour.minutes || []).map((m) => ({
        time: m.startTime,
        precipitationChance: m.precipitationChance != null ? Math.round(m.precipitationChance * 100) : null,
        precipitationIntensity: m.precipitationIntensity,
      })),
    } : null,
  };

  _caches[lakeId] = { data: result, ts: now };
  return result;
}

/**
 * Create a Vercel handler for a lake's weather endpoint
 */
function createWeatherHandler({ lat, lon, timezone, lakeId }) {
  return async (req, res) => {
    try {
      const data = await fetchWeatherKit({ lat, lon, timezone, lakeId });

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.statusCode = 200;
      res.end(JSON.stringify(data, null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[WeatherKit ${lakeId}] Failed:`, err);

      res.setHeader("Content-Type", "application/json");
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          ok: false,
          lakeId,
          error: String(err?.message || err || "unknown"),
          source: "weatherkit-error",
          fetchedAtUtc: new Date().toISOString(),
        })
      );
    }
  };
}

module.exports = {
  fetchWeatherKit,
  createWeatherHandler,
};
