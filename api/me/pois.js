/* eslint-disable no-console */
/**
 * User Custom POIs Endpoint
 *
 * GET  /api/me/pois?lake={lakeId}  — list user's POIs for a lake
 * POST /api/me/pois               — create a new POI
 *
 * Requires Bearer token authentication.
 */

const { getUserFromAuthHeader } = require("../shared/jwt");
const { getUserPois, countUserPois, createUserPoi } = require("../shared/db");

const MAX_POIS_PER_LAKE = 10;
const VALID_CATEGORIES = ["restaurant", "marina", "fuel", "rental", "service", "other"];

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    const user = await getUserFromAuthHeader(authHeader);

    if (!user) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    // ── GET: list POIs for a lake ──
    if (req.method === "GET") {
      const lakeId = req.query.lake;
      if (!lakeId) {
        return res.status(400).json({ ok: false, error: "Missing ?lake= parameter" });
      }

      const pois = await getUserPois(user.id, lakeId);
      return res.status(200).json({ ok: true, pois });
    }

    // ── POST: create a POI ──
    if (req.method === "POST") {
      const { lakeId, name, category, lat, lon, isHome } = req.body || {};

      // Validate required fields
      if (!lakeId || !name || lat == null || lon == null) {
        return res.status(400).json({
          ok: false,
          error: "Missing required fields: lakeId, name, lat, lon",
        });
      }

      // Validate name length
      if (typeof name !== "string" || name.trim().length === 0 || name.length > 50) {
        return res.status(400).json({
          ok: false,
          error: "Name must be 1-50 characters",
        });
      }

      // Validate category
      const cat = category || "other";
      if (!VALID_CATEGORIES.includes(cat)) {
        return res.status(400).json({
          ok: false,
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        });
      }

      // Validate coordinates
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ ok: false, error: "Invalid coordinates" });
      }

      // Check limit
      const count = await countUserPois(user.id, lakeId);
      if (count >= MAX_POIS_PER_LAKE) {
        return res.status(400).json({
          ok: false,
          error: `Maximum of ${MAX_POIS_PER_LAKE} POIs per lake reached`,
        });
      }

      console.log(`[POIs] Creating POI for user ${user.id}: "${name}" on ${lakeId}`);

      const poi = await createUserPoi({
        userId: user.id,
        lakeId,
        name: name.trim(),
        category: cat,
        lat,
        lon,
        isHome: !!isHome,
        sortOrder: count, // append at end
      });

      return res.status(201).json({ ok: true, poi });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[POIs] Error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to process POI request" });
  }
};
