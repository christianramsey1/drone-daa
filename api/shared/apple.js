/**
 * Apple Sign In Verification
 *
 * Verifies Apple identity tokens using Apple's public JWKS.
 * https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/verifying_a_user
 */

const jose = require("jose");

// Apple's JWKS endpoint
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

// Cache for Apple's JWKS (refreshed every hour)
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get Apple's JWKS (cached)
 */
async function getAppleJWKS() {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_CACHE_TTL_MS) {
    return jwksCache;
  }

  console.log("[Apple] Fetching JWKS from Apple...");
  jwksCache = jose.createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  jwksCacheTime = now;
  return jwksCache;
}

/**
 * Verify an Apple identity token.
 *
 * @param {string} identityToken - The identity token from Apple Sign In
 * @param {string} clientId - Your Apple Services ID (e.g., "com.lake360.web")
 * @returns {Promise<Object>} Verified token payload
 * @throws {Error} If verification fails
 */
async function verifyAppleIdentityToken(identityToken, clientId) {
  if (!identityToken) {
    throw new Error("Identity token is required");
  }

  if (!clientId) {
    throw new Error("Client ID is required for verification");
  }

  const jwks = await getAppleJWKS();

  try {
    const { payload } = await jose.jwtVerify(identityToken, jwks, {
      issuer: "https://appleid.apple.com",
      audience: clientId,
    });

    // Validate required claims
    if (!payload.sub) {
      throw new Error("Missing 'sub' claim in token");
    }

    // Check token hasn't expired (jose does this, but double-check)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error("Token has expired");
    }

    // Check auth_time is reasonable (within last hour for fresh sign-ins)
    // This is optional but adds security
    if (payload.auth_time) {
      const authAge = now - payload.auth_time;
      if (authAge > 3600) {
        console.log(`[Apple] Warning: auth_time is ${authAge}s old`);
      }
    }

    return {
      sub: payload.sub, // Unique user identifier (stable across sessions)
      email: payload.email || null,
      emailVerified: payload.email_verified === "true" || payload.email_verified === true,
      isPrivateEmail: payload.is_private_email === "true" || payload.is_private_email === true,
      realUserStatus: payload.real_user_status, // 0=unsupported, 1=unknown, 2=likely real
      nonce: payload.nonce,
      authTime: payload.auth_time,
    };
  } catch (err) {
    console.error("[Apple] Token verification failed:", err.message);
    throw new Error(`Apple token verification failed: ${err.message}`);
  }
}

module.exports = {
  verifyAppleIdentityToken,
};
