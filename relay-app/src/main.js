// relay-app/src/main.js — Electron main process (tray-only, no window)

"use strict";

const { app, dialog } = require("electron");
const { createTray, updateTrayStatus } = require("./tray");
const { startRelay, onStatusChange } = require("./relay-bridge");

// ── Process-level error handling ─────────────────────────────────────
// Prevent crashes from unhandled errors (e.g., EADDRINUSE from relay servers)

process.on("uncaughtException", (err) => {
  console.error("[relay-app] Uncaught exception:", err.message);
  if (err.code === "EADDRINUSE") {
    dialog.showErrorBox(
      "DroneDAA Relay — Port Conflict",
      `Another process is using port ${err.port || ""}.\n\n` +
      "Is another copy of the relay already running?\n" +
      "Close it and try again."
    );
  }
  // Don't exit — keep tray alive so user sees the error status
});

process.on("unhandledRejection", (reason) => {
  console.error("[relay-app] Unhandled rejection:", reason);
});

// ── Electron app setup ───────────────────────────────────────────────

// Prevent Electron from creating a default window
app.on("window-all-closed", (e) => e.preventDefault());

// Hide from macOS Dock (tray-only app)
if (process.platform === "darwin") {
  app.dock?.hide();
}

app.whenReady().then(() => {
  createTray();

  const result = startRelay();

  if (result.adsbError || result.ridError) {
    updateTrayStatus({
      color: "red",
      statusText: [
        result.adsbError ? `ADS-B: ${result.adsbError}` : "ADS-B: Ready",
        result.ridError ? `RID: ${result.ridError}` : "RID: Ready",
      ].join("\n"),
    });
  }

  onStatusChange((status) => {
    updateTrayStatus(status);
  });
});
