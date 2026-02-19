/* eslint-disable no-console */
const express = require("express");

// Load .env for local development (APPLE_CLIENT_ID, JWT_SECRET, POSTGRES_URL)
try { require("dotenv").config(); } catch { /* dotenv optional */ }

// --- Handler imports ---
const mapkitTokenHandler = require("./api/mapkit/token");
const weatherHandler = require("./api/weather/index");
const authAppleHandler = require("./api/auth/apple");
const entitlementsHandler = require("./api/me/entitlements");
const purchaseVerifyHandler = require("./api/purchases/ios/verify");
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

// Helper to wrap Vercel-style handlers
function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, error: String(err?.message || err || "unknown") });
    }
  };
}

// --- MapKit token ---
app.get("/api/mapkit/token", wrap(mapkitTokenHandler));

// --- Weather (generic lat/lon via WeatherKit) ---
app.get("/api/weather", wrap(weatherHandler));

// --- Auth: Sign in with Apple ---
app.post("/api/auth/apple", wrap(authAppleHandler));

// --- User entitlements ---
app.get("/api/me/entitlements", wrap(entitlementsHandler));

// --- iOS purchase verification ---
app.post("/api/purchases/ios/verify", wrap(purchaseVerifyHandler));

// --- User custom POIs ---
app.get("/api/me/pois", wrap(poisHandler));
app.post("/api/me/pois", wrap(poisHandler));

app.patch("/api/me/pois/:id", (req, res) => {
  req.query.id = req.params.id;
  return wrap(poiByIdHandler)(req, res);
});

app.delete("/api/me/pois/:id", (req, res) => {
  req.query.id = req.params.id;
  return wrap(poiByIdHandler)(req, res);
});

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[api-local] listening on http://localhost:${PORT}`);
});
