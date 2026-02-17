/**
 * JWT Utilities for Session Management
 *
 * Uses the 'jose' library (already in package.json) for JWT operations.
 * Session tokens are signed JWTs containing user info.
 */

const jose = require("jose");

// Session token validity (30 days)
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

/**
 * Get the JWT secret from environment.
 * In production, this should be a strong random secret.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Create a signed session token for a user.
 *
 * @param {Object} user - User object with id, appleSub, email, displayName
 * @returns {Promise<string>} Signed JWT
 */
async function createSessionToken(user) {
  const secret = getJwtSecret();

  const token = await new jose.SignJWT({
    sub: user.id,
    appleSub: user.appleSub,
    email: user.email || null,
    displayName: user.displayName || null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .setIssuer("dronedaa")
    .sign(secret);

  return token;
}

/**
 * Verify and decode a session token.
 *
 * @param {string} token - JWT session token
 * @returns {Promise<Object>} Decoded payload with user info
 * @throws {Error} If token is invalid or expired
 */
async function verifySessionToken(token) {
  const secret = getJwtSecret();

  const { payload } = await jose.jwtVerify(token, secret, {
    issuer: "dronedaa",
  });

  return {
    id: payload.sub,
    appleSub: payload.appleSub,
    email: payload.email,
    displayName: payload.displayName,
  };
}

/**
 * Extract and verify session token from Authorization header.
 *
 * @param {string} authHeader - Authorization header value (e.g., "Bearer xxx")
 * @returns {Promise<Object|null>} User object or null if invalid
 */
async function getUserFromAuthHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    return await verifySessionToken(token);
  } catch (err) {
    console.log("[JWT] Token verification failed:", err.message);
    return null;
  }
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  getUserFromAuthHeader,
  SESSION_DURATION_SECONDS,
};
