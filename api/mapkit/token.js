// api/mapkit/token.js
const fs = require("fs");
const path = require("path");

const TEAM_ID = process.env.APPLE_TEAM_ID || "WNS326Z3DK";
const KEY_ID = process.env.MAPKIT_KEY_ID || "6W7H25SW4U";

// Maps ID registered in Apple Developer → Certificates, Identifiers → Maps IDs
const MAPS_ID = process.env.MAPKIT_MAPS_ID || `${TEAM_ID}.maps.com.dronedaa.web`;

// Local dev: read from file. Production: read from env var.
const P8_PATH = path.join(
  process.cwd(),
  "api",
  "mapkit",
  "keys",
  `AuthKey_${KEY_ID}.p8`
);

function getPrivateKey() {
  // First try environment variable (Vercel production)
  if (process.env.MAPKIT_PRIVATE_KEY) {
    // Env vars replace newlines with \n literal, so convert them back
    return process.env.MAPKIT_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  // Fallback to file (local development)
  return fs.readFileSync(P8_PATH, "utf8");
}

async function generateToken() {
  // Dynamic import for ESM module
  const { SignJWT, importPKCS8 } = await import("jose");

  const privateKeyPem = getPrivateKey();
  const key = await importPKCS8(privateKeyPem, "ES256");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 30 * 60; // 30 minutes

  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience("mapkitjs")
    .setSubject(MAPS_ID)
    .sign(key);
}

module.exports = async (req, res) => {
  // CORS for Capacitor native app (capacitor://localhost)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  try {
    const token = await generateToken();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 200;
    res.end(token);
  } catch (e) {
    console.error("[MapKit Token] Error:", e);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 500;
    res.end(
      JSON.stringify(
        { ok: false, error: String(e?.message || e) },
        null,
        2
      )
    );
  }
};