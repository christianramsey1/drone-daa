/* eslint-disable no-console */
const express = require("express");

// Load .env for local development (APPLE_CLIENT_ID, JWT_SECRET, POSTGRES_URL)
try { require("dotenv").config(); } catch { /* dotenv optional */ }

// Vercel-style handler living at: api/mapkit/token.js
const mapkitTokenHandler = require("./api/mapkit/token");

// SML (Smith Mountain Lake) handlers
const smlStatusHandler = require("./api/lakes/sml/status");
const smlWeatherHandler = require("./api/lakes/sml/weather");

// OHL (Old Hickory Lake) handlers
const ohlStatusHandler = require("./api/lakes/ohl/status");
const ohlWeatherHandler = require("./api/lakes/ohl/weather");

// Lanier (Lake Lanier) handlers
const lanierStatusHandler = require("./api/lakes/lanier/status");
const lanierWeatherHandler = require("./api/lakes/lanier/weather");

// Tahoe (Lake Tahoe) handlers
const tahoeStatusHandler = require("./api/lakes/tahoe/status");
const tahoeWeatherHandler = require("./api/lakes/tahoe/weather");

// Norman (Lake Norman) handlers
const normanStatusHandler = require("./api/lakes/norman/status");
const normanWeatherHandler = require("./api/lakes/norman/weather");

// Auth + entitlement handlers
const authAppleHandler = require("./api/auth/apple");
const entitlementsHandler = require("./api/me/entitlements");
const purchaseVerifyHandler = require("./api/purchases/ios/verify");

// User custom POIs
const poisHandler = require("./api/me/pois");
const poiByIdHandler = require("./api/me/pois/[id]");

const app = express();
app.disable("x-powered-by");

// CORS for all API routes (needed for Capacitor native app at capacitor://localhost)
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// JSON body parsing for POST routes (auth, purchases)
app.use(express.json());

// --- MapKit token ---
app.get("/api/mapkit/token", async (req, res) => {
  try {
    // This handler uses Node's res.setHeader/res.end/statusCode style.
    // Express res supports those, so we can call it directly.
    await mapkitTokenHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake status (real AEP data) ---
app.get("/api/lakes/sml/status", async (req, res) => {
  try {
    await smlStatusHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Weather (WeatherKit) ---
app.get("/api/lakes/sml/weather", async (req, res) => {
  try {
    await smlWeatherHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Old Hickory Lake status (USACE) ---
app.get("/api/lakes/ohl/status", async (req, res) => {
  try {
    await ohlStatusHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Old Hickory Lake weather (WeatherKit) ---
app.get("/api/lakes/ohl/weather", async (req, res) => {
  try {
    await ohlWeatherHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake Lanier status (USACE) ---
app.get("/api/lakes/lanier/status", async (req, res) => {
  try {
    await lanierStatusHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake Lanier weather (WeatherKit) ---
app.get("/api/lakes/lanier/weather", async (req, res) => {
  try {
    await lanierWeatherHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake Tahoe status (USGS) ---
app.get("/api/lakes/tahoe/status", async (req, res) => {
  try {
    await tahoeStatusHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake Tahoe weather (WeatherKit) ---
app.get("/api/lakes/tahoe/weather", async (req, res) => {
  try {
    await tahoeWeatherHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake Norman status (Duke Energy / uslakes.info) ---
app.get("/api/lakes/norman/status", async (req, res) => {
  try {
    await normanStatusHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Lake Norman weather (WeatherKit) ---
app.get("/api/lakes/norman/weather", async (req, res) => {
  try {
    await normanWeatherHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- Auth: Sign in with Apple ---
app.post("/api/auth/apple", async (req, res) => {
  try {
    await authAppleHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- User entitlements ---
app.get("/api/me/entitlements", async (req, res) => {
  try {
    await entitlementsHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- iOS purchase verification ---
app.post("/api/purchases/ios/verify", async (req, res) => {
  try {
    await purchaseVerifyHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// --- User custom POIs ---
app.get("/api/me/pois", async (req, res) => {
  try {
    await poisHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

app.post("/api/me/pois", async (req, res) => {
  try {
    await poisHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

app.patch("/api/me/pois/:id", async (req, res) => {
  try {
    // Copy Express param to query for Vercel compatibility
    req.query.id = req.params.id;
    await poiByIdHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

app.delete("/api/me/pois/:id", async (req, res) => {
  try {
    // Copy Express param to query for Vercel compatibility
    req.query.id = req.params.id;
    await poiByIdHandler(req, res);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err || "unknown") });
  }
});

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[api-local] listening on http://localhost:${PORT}`);
});