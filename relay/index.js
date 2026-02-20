// relay/index.js — GDL90 UDP → WebSocket relay for DroneDAA
// Listens on UDP 4000 for GDL90 binary from ADS-B receiver,
// parses traffic/ownship, serves JSON snapshots via WebSocket on 4001.
// Also serves the web app via reverse proxy to detectandavoid.com so
// users can open http://localhost:4001 without mixed-content issues.

/* eslint-disable no-console */
"use strict";

const http = require("node:http");
const https = require("node:https");
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
const UPSTREAM = "detectandavoid.com";

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
      // Ownship report — only update position if GPS fix is valid (non-zero)
      const own = parseTrafficReport(payload);
      if (own) {
        own.lastSeen = Date.now();
        own.timestamp = Date.now();
        if (own.lat !== 0 && own.lon !== 0) {
          ownship = own;
        } else if (ownship) {
          // No GPS fix — keep existing ownship alive but mark as stale-position
          ownship.lastSeen = Date.now();
        }
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

try {
  udp.bind(UDP_PORT, "0.0.0.0", () => {
    console.log(`[relay] Listening for GDL90 on UDP 0.0.0.0:${UDP_PORT}`);
  });
} catch (err) {
  console.error("[relay] UDP bind failed:", err.message);
}

// ── HTTP server (reverse proxy to detectandavoid.com) ────────────────
// Serves the web app on http://localhost:4001 so the browser can connect
// WebSocket on the same origin without mixed-content blocking.

const server = http.createServer((req, res) => {
  // Proxy everything to detectandavoid.com over HTTPS
  const proxyOpts = {
    hostname: UPSTREAM,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: UPSTREAM,
      // Remove headers that would confuse the upstream
      "accept-encoding": "identity",
    },
  };

  const proxyReq = https.request(proxyOpts, (proxyRes) => {
    // Copy status and headers, but strip HSTS/CSP that might cause issues
    const headers = { ...proxyRes.headers };
    delete headers["strict-transport-security"];
    delete headers["content-security-policy"];
    // Ensure browser doesn't upgrade to HTTPS
    delete headers["upgrade-insecure-requests"];
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`[relay] Proxy error: ${err.message}`);
    res.writeHead(502);
    res.end("Relay proxy error — is the internet connected?");
  });

  req.pipe(proxyReq);
});

server.on("error", (err) => {
  console.error(`[relay] HTTP server error: ${err.message}`);
});

// ── WebSocket server (attached to HTTP server) ───────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  console.log("[relay] Client connected");
  // Immediate snapshot on connect
  ws.send(JSON.stringify(buildSnapshot()));
  ws.on("close", () => console.log("[relay] Client disconnected"));
});

server.listen(WS_PORT, "0.0.0.0", () => {
  console.log(`[relay] HTTP + WebSocket server on http://localhost:${WS_PORT}`);
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

// ── Export status for Electron tray integration ─────────────────────

module.exports = {
  getStatus: () => ({
    receiverConnected: (Date.now() - lastUdpReceived) < 5000,
    gpsValid: heartbeat.gpsValid,
    trackCount: aircraft.size,
    clientCount: wss.clients.size,
    msgCountTotal,
  }),
};
