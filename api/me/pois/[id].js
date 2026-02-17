/* eslint-disable no-console */
/**
 * Individual User POI Endpoint
 *
 * PATCH  /api/me/pois/:id  — update a POI (name, category, isHome)
 * DELETE /api/me/pois/:id  — delete a POI
 *
 * Requires Bearer token authentication.
 * Vercel dynamic route: query param `id` is extracted from the URL.
 */

const { getUserFromAuthHeader } = require("../../shared/jwt");
const { updateUserPoi, deleteUserPoi } = require("../../shared/db");

const VALID_CATEGORIES = ["restaurant", "marina", "fuel", "rental", "service", "other"];

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, DELETE, OPTIONS");
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

    const poiId = req.query.id;
    if (!poiId) {
      return res.status(400).json({ ok: false, error: "Missing POI id" });
    }

    // ── PATCH: update a POI ──
    if (req.method === "PATCH") {
      const { name, category, isHome } = req.body || {};

      // Validate name if provided
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length === 0 || name.length > 50) {
          return res.status(400).json({ ok: false, error: "Name must be 1-50 characters" });
        }
      }

      // Validate category if provided
      if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
          ok: false,
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        });
      }

      const updated = await updateUserPoi(poiId, user.id, {
        name: name?.trim(),
        category,
        isHome,
      });

      if (!updated) {
        return res.status(404).json({ ok: false, error: "POI not found" });
      }

      console.log(`[POIs] Updated POI ${poiId} for user ${user.id}`);
      return res.status(200).json({ ok: true, poi: updated });
    }

    // ── DELETE: remove a POI ──
    if (req.method === "DELETE") {
      const deleted = await deleteUserPoi(poiId, user.id);

      if (!deleted) {
        return res.status(404).json({ ok: false, error: "POI not found" });
      }

      console.log(`[POIs] Deleted POI ${poiId} for user ${user.id}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[POIs] Error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to process POI request" });
  }
};
