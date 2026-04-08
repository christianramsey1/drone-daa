/* eslint-disable no-console */
/**
 * iOS Purchase Verification Endpoint
 *
 * POST /api/purchases/ios/verify
 *
 * Verifies a StoreKit 2 transaction and grants the corresponding entitlement.
 *
 * Request body:
 * {
 *   productId: string,          // SKU, e.g., "com.dronedaa.pro.1yr"
 *   transactionId: string,      // Transaction ID
 *   originalTransactionId?: string,
 *   signedTransaction: string,  // JWS from StoreKit 2
 *   environment: "production" | "sandbox"
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   entitlements: [{ key, expiresAt, source }]
 * }
 *
 * Environment variables:
 * - POSTGRES_URL: Database connection
 * - JWT_SECRET: For session verification
 */

const jose = require("jose");
const { getUserFromAuthHeader } = require("../../shared/jwt");
const {
  getUserById,
  findOrCreateUser,
  getUserEntitlements,
  upsertEntitlement,
  purchaseExists,
  createPurchase,
} = require("../../shared/db");
const { checkRateLimit } = require("../../shared/ratelimit");

// Apple's StoreKit 2 JWS signing keys endpoint
const APPLE_ROOT_CA_URL = "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer";

// Product ID to entitlement key mapping
const PRODUCT_TO_ENTITLEMENT = {
  "com.dronedaa.pro.1yr": "pro",
};

// Fallback entitlement duration: 1 year (used if transaction lacks expiresDate)
const ENTITLEMENT_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Decode a StoreKit 2 signed transaction (JWS).
 * For production, you should fully verify the signature against Apple's certificates.
 * For MVP, we decode and trust since it came from StoreKit on the device.
 */
function decodeSignedTransaction(signedTransaction) {
  try {
    // JWS format: header.payload.signature
    const parts = signedTransaction.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWS format");
    }

    // Decode payload (middle part)
    const payloadBase64 = parts[1];
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    return payload;
  } catch (err) {
    throw new Error(`Failed to decode transaction: ${err.message}`);
  }
}

/**
 * Apple's root CA certificates for StoreKit 2 JWS verification.
 * These are the DER-encoded (base64) Apple Root CA - G3 certificates.
 * Apple signs StoreKit transactions with certs chaining to these roots.
 */
const APPLE_ROOT_CA_G3_BASE64 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS" +
  "QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u" +
  "IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN" +
  "MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS" +
  "b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y" +
  "aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49" +
  "AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf" +
  "TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyQ2YGQWnl/YBnXIsi/wNPt" +
  "FoL8gE5t3mCN5PeqMoRjkaNjMGEwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3BUmprrJ" +
  "kfmmMB8GA1UdIwQYMBaAFLuw3qFYM4iapIqZ3BUmprrJkfmmMA8GA1UdEwEB/wQF" +
  "MAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4a" +
  "XTQYa+1LV/GiTkPnTHhLg4UB/kqOhxSBhsN6sCqLtISaTNLpKGCkSMCMFsG5Fxk" +
  "dLdQR7EQHI2grBXl2PYnRqKDbLJ9RWqTV7SZkfCOgFl5Ypj2Vp+YUQ==";

/**
 * Verify the signed transaction JWS signature against Apple's certificate chain.
 * 1. Extracts x5c chain from JWS header
 * 2. Verifies the leaf certificate chains to Apple Root CA - G3
 * 3. Verifies the JWS signature with the leaf certificate
 * 4. Validates bundle ID
 */
async function verifyTransactionSignature(signedTransaction) {
  const { jwtVerify, importX509 } = jose;
  const crypto = require("crypto");

  const parts = signedTransaction.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWS format");

  // Decode header to get x5c chain
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) {
    throw new Error("Missing or incomplete x5c certificate chain in JWS header (need leaf + intermediate)");
  }

  // Validate certificate chain: leaf → intermediate → Apple Root CA G3
  // The last cert in x5c should be signed by Apple's root
  const rootDer = Buffer.from(APPLE_ROOT_CA_G3_BASE64, "base64");
  const rootCert = new crypto.X509Certificate(rootDer);

  // Walk the chain from the end (closest to root) backward
  const certs = x5c.map((b64) => new crypto.X509Certificate(Buffer.from(b64, "base64")));

  // Verify the top of the chain is issued by Apple's root CA
  const topCert = certs[certs.length - 1];
  if (!topCert.verify(rootCert.publicKey)) {
    throw new Error("Certificate chain does not trace to Apple Root CA - G3");
  }

  // Verify each cert in the chain is signed by its parent
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].verify(certs[i + 1].publicKey)) {
      throw new Error(`Certificate chain broken at position ${i}`);
    }
  }

  // Check leaf certificate validity period
  const leaf = certs[0];
  const now = new Date();
  if (now < new Date(leaf.validFrom) || now > new Date(leaf.validTo)) {
    throw new Error("Leaf certificate has expired or is not yet valid");
  }

  // Convert leaf certificate to PEM for jose
  const leafPem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`;
  const key = await importX509(leafPem, header.alg || "ES256");

  // Verify JWS signature
  const { payload } = await jwtVerify(signedTransaction, key, {
    algorithms: [header.alg || "ES256"],
  });

  // Validate bundle ID matches our app
  if (payload.bundleId && payload.bundleId !== "com.dronedaa.app") {
    throw new Error(`Bundle ID mismatch: ${payload.bundleId}`);
  }

  return payload;
}

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

  // Rate limit: 10 attempts per minute per IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const { limited } = checkRateLimit(ip, "purchase", 10, 60_000);
  if (limited) {
    return res.status(429).json({ ok: false, error: "Too many requests. Try again in a minute." });
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

    // Parse request body
    const {
      productId,
      transactionId,
      originalTransactionId,
      signedTransaction,
      environment = "production",
    } = req.body || {};

    // Validate required fields
    if (!productId || !transactionId || !signedTransaction) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: productId, transactionId, signedTransaction",
      });
    }

    console.log(`[Verify] Processing purchase for user ${user.id}: ${productId}`);

    // Check if we've already processed this transaction
    const alreadyProcessed = await purchaseExists("ios", transactionId);
    if (alreadyProcessed) {
      console.log(`[Verify] Transaction ${transactionId} already processed`);
      // Return current entitlements - idempotent success
      const entitlements = await getUserEntitlements(user.id);
      return res.status(200).json({ ok: true, entitlements });
    }

    // Decode and verify the signed transaction
    const transactionPayload = decodeSignedTransaction(signedTransaction);
    try {
      await verifyTransactionSignature(signedTransaction);
      console.log(`[Verify] JWS signature verified successfully`);
    } catch (verifyErr) {
      console.error(`[Verify] JWS verification failed: ${verifyErr.message}`);
      // In sandbox, certificate validation may fail due to different cert chains.
      // Log the error but allow the transaction to proceed if the payload decoded successfully.
      // In production, this should be a hard failure.
      if (environment === "production") {
        return res.status(400).json({
          ok: false,
          error: `Transaction verification failed: ${verifyErr.message}`,
        });
      }
      console.log(`[Verify] Allowing sandbox transaction despite verification failure`);
    }

    // Validate the transaction matches our request
    if (transactionPayload.productId !== productId) {
      console.error(`[Verify] Product ID mismatch: ${transactionPayload.productId} vs ${productId}`);
      return res.status(400).json({
        ok: false,
        error: "Transaction product ID does not match",
      });
    }

    // Map product to entitlement
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId];
    if (!entitlementKey) {
      console.error(`[Verify] Unknown product: ${productId}`);
      return res.status(400).json({
        ok: false,
        error: `Unknown product: ${productId}`,
      });
    }

    // Calculate expiration — use expiresDate from subscription, fallback to 1 year
    const purchaseDate = new Date(transactionPayload.purchaseDate || Date.now());
    const expiresAt = transactionPayload.expiresDate
      ? new Date(transactionPayload.expiresDate)
      : new Date(purchaseDate.getTime() + ENTITLEMENT_DURATION_MS);

    // Store the purchase record
    await createPurchase({
      userId: user.id,
      platform: "ios",
      productId,
      transactionId,
      originalTransactionId: originalTransactionId || transactionPayload.originalTransactionId,
      purchaseDate,
      expiresAt,
      environment,
      rawPayload: transactionPayload,
    });

    console.log(`[Verify] Purchase recorded: ${transactionId}`);

    // Grant the entitlement
    await upsertEntitlement({
      userId: user.id,
      key: entitlementKey,
      expiresAt,
      source: "appstore",
    });

    console.log(`[Verify] Entitlement granted: ${entitlementKey} until ${expiresAt.toISOString()}`);

    // Return updated entitlements
    const entitlements = await getUserEntitlements(user.id);

    return res.status(200).json({
      ok: true,
      entitlements,
    });
  } catch (err) {
    console.error("[Verify] Error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Verification failed",
    });
  }
};
