/* eslint-disable no-console */
/**
 * Apple Sign In Authentication Endpoint
 *
 * POST /api/auth/apple
 *
 * Receives an Apple identity token, verifies it, and returns a session token.
 *
 * Request body:
 * {
 *   identityToken: string,  // JWT from Apple Sign In
 *   user?: {                // Optional user info (only on first sign-in)
 *     email?: string,
 *     name?: { firstName?: string, lastName?: string }
 *   }
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   user: { id, appleSub, email, displayName },
 *   sessionToken: string
 * }
 *
 * Environment variables required:
 * - APPLE_CLIENT_ID: Your Apple Services ID (e.g., "com.dronedaa.web")
 * - JWT_SECRET: Secret for signing session tokens
 * - POSTGRES_URL: Database connection (Vercel Postgres)
 */

const { verifyAppleIdentityToken } = require("../shared/apple");
const { createSessionToken } = require("../shared/jwt");
const { findOrCreateUser } = require("../shared/db");
const { checkRateLimit } = require("../shared/ratelimit");

const ALLOWED_ORIGINS = [
  "https://detectandavoid.com",
  "capacitor://localhost",
  "http://localhost:5173",
  "http://localhost:4001",
];

module.exports = async (req, res) => {
  // CORS headers — restrict to known origins
  const origin = req.headers.origin || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Rate limit: 5 attempts per minute per IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const { limited } = checkRateLimit(ip, "auth", 5, 60_000);
  if (limited) {
    return res.status(429).json({ ok: false, error: "Too many requests. Try again in a minute." });
  }

  try {
    const { identityToken, user: userInfo } = req.body || {};

    if (!identityToken) {
      return res.status(400).json({
        ok: false,
        error: "identityToken is required",
      });
    }

    // Get client IDs — native iOS tokens use bundle ID as aud, web uses Services ID
    const serviceId = process.env.APPLE_CLIENT_ID;
    if (!serviceId) {
      console.error("[Auth] APPLE_CLIENT_ID not configured");
      return res.status(500).json({
        ok: false,
        error: "Server configuration error",
      });
    }
    const bundleId = process.env.APPLE_BUNDLE_ID || "com.dronedaa.app";
    const clientId = [serviceId, bundleId];

    // Verify the Apple identity token
    console.log("[Auth] Verifying Apple identity token...");
    const appleUser = await verifyAppleIdentityToken(identityToken, clientId);
    console.log("[Auth] Token verified for sub:", appleUser.sub.slice(0, 8) + "...");

    // Build display name from user info (Apple only sends on first sign-in)
    const displayName = userInfo?.name
      ? [userInfo.name.firstName, userInfo.name.lastName].filter(Boolean).join(" ")
      : null;

    // Find or create user in database
    const user = await findOrCreateUser({
      appleSub: appleUser.sub,
      email: userInfo?.email || appleUser.email || null,
      displayName: displayName || null,
    });

    console.log("[Auth] User found/created:", user.id);

    // Create session token
    const sessionToken = await createSessionToken(user);
    console.log("[Auth] Session created for user:", user.id);

    return res.status(200).json({
      ok: true,
      user,
      sessionToken,
    });
  } catch (err) {
    console.error("[Auth] Error:", err.message);
    return res.status(401).json({
      ok: false,
      error: err.message || "Authentication failed",
    });
  }
};
