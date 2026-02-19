// relay/index.js — GDL90 UDP → WebSocket relay for DroneDAA
// Listens on UDP 4000 for GDL90 binary from ADS-B receiver,
// parses traffic/ownship, serves JSON snapshots via WebSocket on 4001.

/* eslint-disable no-console */
"use strict";

const dgram = require("node:dgram");
const { WebSocketServer } = require("ws");
const {
  unframe,
  parseTrafficReport,
  parseHeartbeat,
  parseOwnshipGeoAlt,
} = require("./gdl90.js");

// ── Configuration ─────────────────────────────────────────────────────

const UDP_PORT = 4000;
const WS_PORT = 4001;
const PUSH_INTERVAL_MS = 1000;   // 1 Hz state push
const STALE_TIMEOUT_MS = 15000;  // Remove tracks not seen in 15s

// ── State ─────────────────────────────────────────────────────────────

const aircraft = new Map();  // Map<icaoHex, track>
let ownship = null;
let heartbeat = { gpsValid: false };
let lastUdpReceived = 0;
let msgCountTotal = 0;

// ── UDP listener ──────────────────────────────────────────────────────

const udp = dgram.createSocket("udp4");

udp.on("message", (msg) => {
  lastUdpReceived = Date.now();
  const messages = unframe(new Uint8Array(msg));

  for (const { msgId, payload } of messages) {
    msgCountTotal++;

    if (msgId === 0x14) {
      // Traffic report
      const track = parseTrafficReport(payload);
      if (track && track.lat !== 0 && track.lon !== 0) {
        track.lastSeen = Date.now();
        track.timestamp = Date.now();
        aircraft.set(track.id, track);
      }
    } else if (msgId === 0x0A) {
      // Ownship report
      const own = parseTrafficReport(payload);
      if (own) {
        own.lastSeen = Date.now();
        own.timestamp = Date.now();
        ownship = own;
      }
    } else if (msgId === 0x0B) {
      // Ownship geometric altitude
      const geo = parseOwnshipGeoAlt(payload);
      if (ownship && geo) {
        ownship.geoAltFt = geo.geoAltFt;
      }
    } else if (msgId === 0x00) {
      // Heartbeat
      heartbeat = parseHeartbeat(payload) || heartbeat;
    }
    // 0x65 (ForeFlight ID) — acknowledged, not relayed
  }
});

udp.on("error", (err) => {
  console.error("[relay] UDP error:", err.message);
});

udp.bind(UDP_PORT, () => {
  console.log(`[relay] Listening for GDL90 on UDP :${UDP_PORT}`);
});

// ── WebSocket server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on("listening", () => {
  console.log(`[relay] WebSocket server on ws://localhost:${WS_PORT}`);
});

wss.on("connection", (ws) => {
  console.log("[relay] Client connected");
  // Immediate snapshot on connect
  ws.send(JSON.stringify(buildSnapshot()));
  ws.on("close", () => console.log("[relay] Client disconnected"));
});

// ── Periodic state push (1 Hz) ───────────────────────────────────────

setInterval(() => {
  const now = Date.now();

  // Prune stale tracks
  for (const [id, track] of aircraft) {
    if (now - track.lastSeen > STALE_TIMEOUT_MS) {
      aircraft.delete(id);
    }
  }
  if (ownship && now - ownship.lastSeen > STALE_TIMEOUT_MS) {
    ownship = null;
  }

  const snapshot = buildSnapshot();
  const json = JSON.stringify(snapshot);

  for (const ws of wss.clients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(json);
    }
  }
}, PUSH_INTERVAL_MS);

// ── Snapshot builder ──────────────────────────────────────────────────

function buildSnapshot() {
  return {
    type: "snapshot",
    timestamp: Date.now(),
    receiverConnected: (Date.now() - lastUdpReceived) < 5000,
    gpsValid: heartbeat.gpsValid,
    ownship: ownship ? trackToJson(ownship) : null,
    aircraft: Array.from(aircraft.values()).map(trackToJson),
    count: aircraft.size,
  };
}

function trackToJson(t) {
  return {
    id: t.id,
    callsign: t.callsign || undefined,
    lat: t.lat,
    lon: t.lon,
    altFt: t.altFt,
    headingDeg: t.headingDeg,
    speedKts: t.speedKts,
    vertRateFpm: t.vertRateFpm,
    category: t.category,
    onGround: t.onGround,
    timestamp: t.timestamp,
  };
}

// ── Periodic status log ───────────────────────────────────────────────

setInterval(() => {
  const connected = (Date.now() - lastUdpReceived) < 5000;
  console.log(
    `[relay] ${connected ? "Receiving" : "No data"} | ` +
    `${aircraft.size} aircraft | ` +
    `GPS: ${heartbeat.gpsValid ? "fix" : "no fix"} | ` +
    `${wss.clients.size} WS client(s) | ` +
    `${msgCountTotal} msgs total`
  );
}, 10000);
