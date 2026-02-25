// relay-app/scripts/notarize.js
// electron-builder afterSign hook — submits the signed app to Apple's notary service.
// Requires APPLE_API_KEY_PATH, APPLE_API_KEY_ID, and APPLE_API_ISSUER env vars.
// Skipped gracefully when env vars are missing (local unsigned builds).

const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  // Skip if notarization credentials are not configured
  if (!process.env.APPLE_API_KEY_PATH || !process.env.APPLE_API_KEY_ID || !process.env.APPLE_API_ISSUER) {
    console.log("Skipping notarization — APPLE_API_KEY_PATH/ID/ISSUER not set.");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`Notarizing ${appName}...`);

  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    tool: "notarytool",
    appleApiKey: process.env.APPLE_API_KEY_PATH,
    appleApiKeyId: process.env.APPLE_API_KEY_ID,
    appleApiIssuer: process.env.APPLE_API_ISSUER,
  });

  console.log("Notarization complete.");
};
