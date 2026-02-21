// relay/rid.js — Remote ID scanner relay for DroneDAA
// Scans for Open Drone ID broadcasts via BLE and WiFi, serves to web app via WebSocket.
//
// Architecture:
//   - BLE scanning via @stoprocent/noble (when available)
//   - WiFi beacon monitoring via pcap/monitor mode (when available)
//   - HTTP POST ingest at /api/rid for external RID sources (always available)
//   - WebSocket server at WS_PORT pushes RID snapshots to connected clients
//
// This is designed to degrade gracefully:
//   - If noble isn't installed → BLE scanning disabled, log instructions
//   - If WiFi monitor mode unavailable → WiFi scanning disabled
//   - HTTP ingest always works (for external scanners, SDR, etc.)

/* eslint-disable no-console */
"use strict";

const http = require("node:http");
const { WebSocketServer } = require("ws");
const { parseOdidMessage, assembleTrack, MSG_TYPE } = require("./odid.js");

// ── Configuration ─────────────────────────────────────────────────────

const WS_PORT = 4002;
const HTTP_PORT = 4003;
const PUSH_INTERVAL_MS = 1000;
const STALE_TIMEOUT_MS = 30000;

// ── State ─────────────────────────────────────────────────────────────

// Map<droneId, { track, messages[], lastSeen }>
const drones = new Map();
let scanning = false;
let bleAvailable = false;
let wifiAvailable = false;

// ── BLE Open Drone ID scanning ───────────────────────────────────────

// Open Drone ID uses BLE advertisement with service data UUID 0xFFFA
// The advertisement payload contains one or more 25-byte ODID messages.

let noble = null;

function initBle() {
  try {
    noble = require("@stoprocent/noble");
    bleAvailable = true;
    console.log("[rid] BLE scanning available via noble");

    noble.on("stateChange", (state) => {
      console.log(`[rid] BLE adapter state: ${state}`);
      if (state === "poweredOn" && scanning) {
        startBleScan();
      }
    });

    noble.on("discover", (peripheral) => {
      handleBleAdvertisement(peripheral);
    });
  } catch {
    console.log("[rid] BLE scanning not available (install @stoprocent/noble for BLE support)");
    console.log("[rid]   npm install @stoprocent/noble");
    console.log("[rid]   (requires system Bluetooth libraries)");
  }
}

function startBleScan() {
  if (!noble || !bleAvailable) return;

  // Scan ALL BLE advertisements (no service UUID filter).
  // ODID uses service *data* with UUID 0xFFFA, not advertised service UUIDs,
  // so noble's scan filter won't reliably match. We filter by service data
  // UUID in handleBleAdvertisement instead.
  // allowDuplicates=true since RID broadcasts continuously.
  try {
    noble.startScanning([], true);
    console.log("[rid] BLE scan started (filtering ODID 0xFFFA in handler)");
  } catch (err) {
    console.error("[rid] BLE scan start failed:", err.message);
  }
}

function stopBleScan() {
  if (!noble) return;
  try {
    noble.stopScanning();
    console.log("[rid] BLE scan stopped");
  } catch { /* ignore */ }
}

function handleBleAdvertisement(peripheral) {
  // Extract service data for UUID FFFA
  const ad = peripheral.advertisement;
  const serviceData = ad.serviceData;

  if (!serviceData || serviceData.length === 0) return;

  for (const sd of serviceData) {
    // Check for ODID service UUID (0xFFFA or "fffa")
    const uuid = sd.uuid?.toLowerCase();
    if (uuid !== "fffa" && uuid !== "0000fffa-0000-1000-8000-00805f9b34fb") continue;

    const raw = new Uint8Array(sd.data);

    // Per ASTM F3411-22a §4.3.2, BLE service data payload is:
    //   1 byte app code (0x0D for ODID) + 1 byte message counter + ODID message(s)
    // Strip the 2-byte header to get the actual ODID payload.
    const hasOdidHeader = raw.length >= 27 && raw[0] === 0x0d;
    const data = hasOdidHeader ? raw.subarray(2) : raw;

    if (data.length < 25) continue;

    // Determine broadcast type from payload size
    // BT5 Long Range packs multiple 25-byte messages (message pack)
    const broadcastType = data.length > 50 ? "bluetooth5LongRange" : "bluetooth5Legacy";

    processOdidPayload(data, broadcastType, peripheral.rssi, peripheral.id);
  }
}

// ── WiFi Beacon monitoring ───────────────────────────────────────────

// WiFi Remote ID uses IEEE 802.11 Beacon frames with a vendor-specific
// information element containing ODID messages. This requires monitor
// mode on a WiFi adapter, which is OS-specific and needs elevated privileges.
//
// For now, WiFi RID data can be ingested via the HTTP POST endpoint
// from external tools like:
//   - OpenDroneID Android app (can forward over network)
//   - Custom SDR receiver
//   - WiFi sniffer tools that extract ODID payloads

function initWifi() {
  // WiFi NAN (Neighbor Awareness Networking) is even more specialized
  // and requires specific hardware/driver support.
  //
  // Practical approach: accept WiFi RID data via HTTP ingest.
  console.log("[rid] WiFi RID: use HTTP ingest endpoint for external WiFi scanners");
  console.log(`[rid]   POST http://localhost:${HTTP_PORT}/api/rid`);
}

// ── Process ODID payload (common for BLE + WiFi + HTTP ingest) ───────

function processOdidPayload(data, broadcastType, rssi, peripheralId) {
  const messages = [];

  // Try parsing as a message pack first (BT5 LR often packs multiple messages)
  const firstMsg = parseOdidMessage(data, 0);
  if (firstMsg && firstMsg.msgType === MSG_TYPE.MESSAGE_PACK) {
    messages.push(...(firstMsg.messages || []));
  } else {
    // Parse individual 25-byte messages from the payload
    for (let off = 0; off + 25 <= data.length; off += 25) {
      const msg = parseOdidMessage(data, off);
      if (msg) messages.push(msg);
    }
  }

  if (messages.length === 0) return;

  // For BLE Legacy (single 25-byte messages), always key by peripheralId.
  // Each BLE ad carries only ONE message type, so Basic ID and Location
  // arrive in separate advertisements. Keying by peripheralId ensures all
  // message types accumulate into a single drone entry. assembleTrack()
  // will set the display ID from the Basic ID serial number.
  //
  // For message packs (BLE5 LR) or HTTP ingest, a Basic ID is usually
  // included in the pack, so we can use the serial number as the key.
  let droneId = peripheralId || `unknown-${Date.now()}`;
  if (messages.length > 1) {
    // Multi-message pack — try to use serial number as key
    for (const msg of messages) {
      if (msg.msgType === MSG_TYPE.BASIC_ID && msg.uaId) {
        droneId = msg.uaId;
        break;
      }
    }
  }

  // Get or create drone entry
  let entry = drones.get(droneId);
  if (!entry) {
    entry = { messages: [], lastSeen: 0, track: null };
    drones.set(droneId, entry);
  }

  // Merge new messages (keep latest of each type)
  for (const msg of messages) {
    const idx = entry.messages.findIndex((m) => m.msgType === msg.msgType);
    if (idx >= 0) entry.messages[idx] = msg;
    else entry.messages.push(msg);
  }

  entry.lastSeen = Date.now();

  // Reassemble track from all accumulated messages
  entry.track = assembleTrack(droneId, entry.messages, broadcastType);
  entry.track.rssi = rssi ?? entry.track.rssi;
  entry.track.timestamp = Date.now();
}

// ── HTTP ingest server ───────────────────────────────────────────────

// POST /api/rid — accepts JSON with RID data from external sources
// Body: { broadcastType, rssi?, payload: <hex string or base64 of raw ODID bytes> }
// Or:   { drones: [{ id, lat, lon, altFt, ... }] } for pre-parsed data

const httpServer = http.createServer((req, res) => {
  // CORS headers for browser-based tools
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/rid/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      scanning,
      bleAvailable,
      wifiAvailable,
      droneCount: drones.size,
      httpIngest: true,
    }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/rid") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);

        if (data.payload) {
          // Raw ODID bytes (hex or base64)
          let bytes;
          if (typeof data.payload === "string") {
            if (data.payload.match(/^[0-9a-fA-F]+$/)) {
              // Hex string
              bytes = new Uint8Array(data.payload.match(/.{2}/g).map((h) => parseInt(h, 16)));
            } else {
              // Base64
              bytes = new Uint8Array(Buffer.from(data.payload, "base64"));
            }
          }
          if (bytes) {
            processOdidPayload(bytes, data.broadcastType || "unknown", data.rssi, data.id);
          }
        } else if (data.drones && Array.isArray(data.drones)) {
          // Pre-parsed drone tracks (from Android OpenDroneID app, etc.)
          for (const d of data.drones) {
            if (!d.id || !d.lat || !d.lon) continue;
            const droneId = d.id;
            let entry = drones.get(droneId);
            if (!entry) {
              entry = { messages: [], lastSeen: 0, track: null };
              drones.set(droneId, entry);
            }
            entry.track = {
              id: droneId,
              idType: d.idType || "unknown",
              serialNumber: d.serialNumber,
              sessionId: d.sessionId,
              lat: d.lat,
              lon: d.lon,
              altFt: d.altFt || 0,
              headingDeg: d.headingDeg || 0,
              speedKts: d.speedKts || 0,
              vertRateFpm: d.vertRateFpm || 0,
              uasType: d.uasType || "none",
              ridType: d.ridType || "standard",
              operationalStatus: d.operationalStatus || "undeclared",
              broadcastType: d.broadcastType || "unknown",
              rssi: d.rssi,
              timestamp: Date.now(),
              operatorLat: d.operatorLat,
              operatorLon: d.operatorLon,
              takeoffLat: d.takeoffLat,
              takeoffLon: d.takeoffLon,
              operatorId: d.operatorId,
            };
            entry.lastSeen = Date.now();
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, droneCount: drones.size }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });

wss.on("error", (err) => {
  console.error(`[rid] WebSocket server error: ${err.message}`);
});

wss.on("listening", () => {
  console.log(`[rid] WebSocket server on ws://localhost:${WS_PORT}`);
});

wss.on("connection", (ws) => {
  console.log("[rid] Client connected");
  ws.send(JSON.stringify(buildSnapshot()));
  ws.on("close", () => console.log("[rid] Client disconnected"));
});

// ── Periodic push (1 Hz) ────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();

  // Prune stale drones
  for (const [id, entry] of drones) {
    if (now - entry.lastSeen > STALE_TIMEOUT_MS) {
      drones.delete(id);
    }
  }

  const snapshot = buildSnapshot();
  const json = JSON.stringify(snapshot);

  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      ws.send(json);
    }
  }
}, PUSH_INTERVAL_MS);

// ── Snapshot builder ──────────────────────────────────────────────────

function buildSnapshot() {
  const droneList = [];
  for (const [, entry] of drones) {
    if (entry.track && entry.track.lat !== 0 && entry.track.lon !== 0) {
      droneList.push(entry.track);
    }
  }

  return {
    type: "rid-snapshot",
    timestamp: Date.now(),
    drones: droneList,
    count: droneList.length,
    scanning,
    bleAvailable,
    wifiAvailable,
  };
}

// ── Status log ──────────────────────────────────────────────────────

setInterval(() => {
  console.log(
    `[rid] ${scanning ? "Scanning" : "Idle"} | ` +
    `${drones.size} drones | ` +
    `BLE: ${bleAvailable ? "yes" : "no"} | ` +
    `${wss.clients.size} WS client(s)`
  );
}, 10000);

// ── Startup ──────────────────────────────────────────────────────────

function start() {
  initBle();
  initWifi();

  scanning = bleAvailable; // auto-start scanning if BLE is available
  if (scanning) {
    if (noble && noble.state === "poweredOn") {
      startBleScan();
    }
    // Otherwise noble stateChange handler will start when ready
  }

  httpServer.on("error", (err) => {
    console.error(`[rid] HTTP server error: ${err.message}`);
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(`[rid] HTTP ingest server on http://localhost:${HTTP_PORT}`);
    console.log(`[rid]   POST /api/rid — submit raw ODID or pre-parsed drone data`);
    console.log(`[rid]   GET  /api/rid/status — scanner status`);
  });
}

start();

// ── Export status for Electron tray integration ─────────────────────

module.exports = {
  getStatus: () => ({
    scanning,
    bleAvailable,
    wifiAvailable,
    droneCount: drones.size,
    clientCount: wss.clients.size,
  }),
};
