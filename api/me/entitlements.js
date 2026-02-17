/* eslint-disable no-console */
/**
 * User Entitlements Endpoint
 *
 * GET /api/me/entitlements
 *
 * Returns the current user's entitlements (lake passes).
 * Requires Bearer token authentication.
 *
 * Response:
 * {
 *   ok: true,
 *   entitlements: [
 *     { key: "lake:lanier", expiresAt: "2025-02-08T...", source: "appstore" }
 *   ]
 * }
 */

const { getUserFromAuthHeader } = require("../shared/jwt");
const { getUserEntitlements } = require("../shared/db");

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    const user = await getUserFromAuthHeader(authHeader);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Authentication required",
      });
    }

    console.log("[Entitlements] Fetching for user:", user.id);

    // Query database for user's active entitlements
    const entitlements = await getUserEntitlements(user.id);

    console.log(`[Entitlements] Found ${entitlements.length} entitlements`);

    return res.status(200).json({
      ok: true,
      entitlements,
    });
  } catch (err) {
    console.error("[Entitlements] Error:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch entitlements",
    });
  }
};
