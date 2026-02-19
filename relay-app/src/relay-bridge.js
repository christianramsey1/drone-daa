// relay-app/src/relay-bridge.js — Loads and manages relay services

"use strict";

const path = require("node:path");
const { computeStatus } = require("./status");

let adsbModule = null;
let ridModule = null;
let statusCallback = null;

function getRelayPath() {
  const { app } = require("electron");
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "relay");
  }
  return path.resolve(__dirname, "..", "..", "relay");
}

function startRelay() {
  const relayPath = getRelayPath();
  const result = { adsbError: null, ridError: null };

  // Load ADS-B relay (index.js) — self-starts on require
  try {
    adsbModule = require(path.join(relayPath, "index.js"));
  } catch (err) {
    result.adsbError = err.code === "EADDRINUSE"
      ? "Port 4001 in use — is another relay running?"
      : err.message;
    console.error("[relay-app] ADS-B relay failed:", err.message);
  }

  // Load RID relay (rid.js) — self-starts on require
  try {
    ridModule = require(path.join(relayPath, "rid.js"));
  } catch (err) {
    result.ridError = err.code === "EADDRINUSE"
      ? "Port 4002 in use — is another relay running?"
      : err.message;
    console.error("[relay-app] RID relay failed:", err.message);
  }

  // Start polling status every 2 seconds
  setInterval(pollStatus, 2000);

  return result;
}

function pollStatus() {
  if (!statusCallback) return;

  const adsbStatus = adsbModule?.getStatus?.() ?? {
    receiverConnected: false,
    gpsValid: false,
    trackCount: 0,
    clientCount: 0,
    msgCountTotal: 0,
  };

  const ridStatus = ridModule?.getStatus?.() ?? {
    scanning: false,
    bleAvailable: false,
    wifiAvailable: false,
    droneCount: 0,
    clientCount: 0,
  };

  const status = computeStatus(adsbStatus, ridStatus);
  statusCallback(status);
}

function onStatusChange(callback) {
  statusCallback = callback;
}

module.exports = { startRelay, onStatusChange };
