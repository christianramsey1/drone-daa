// relay/gdl90-sim.js — GDL90 traffic simulator for testing without a receiver
//
//   node relay/gdl90-sim.js [--cycle 120] [--host 127.0.0.1]
//
// Sends crafted GDL90 frames (heartbeat + traffic reports, correct CRC and
// byte stuffing) to the relay's UDP listener on 127.0.0.1:4000. Targets are
// placed around a "runway" at 39.070, -77.560 (near KJYO); point the app
// there to watch them.
//
//   TAXI1  — Light aircraft taxiing: on ground, altitude INVALID (0xFFF),
//            0.3 nm from center. Alerts unless "Ignore Ground Traffic" is on.
//   OPS2   — Surface Service vehicle (emitter 18): must NEVER alert.
//   AIR3   — Light aircraft at 800 ft MSL, 1 nm east: control, always alerts.
//   TCHGO1 — Light aircraft flying TOUCH AND GOS: final approach, touchdown,
//            ground roll (altitude goes invalid, onGround set), climb-out,
//            left closed traffic, repeat. Exercises the air→ground→air
//            transitions: alert level, "— ft" display, and marker continuity.
//
// --cycle N sets the touch-and-go circuit duration in seconds (default 120).
// --host sends to a device instead of the local relay — point it at an
// iPhone's Wi-Fi IP to drive the native app's UDP listener directly.

"use strict";

const dgram = require("dgram");

// ── GDL90 framing (CRC-16-CCITT + byte stuffing, per ICD) ─────────────

const CRC_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i << 8;
  for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
  CRC_TABLE[i] = crc & 0xFFFF;
}
function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) crc = (CRC_TABLE[(crc >> 8) & 0xFF] ^ (crc << 8) ^ b) & 0xFFFF;
  return crc;
}
function frame(msg) {
  const crc = crc16(msg);
  const full = [...msg, crc & 0xFF, (crc >> 8) & 0xFF];
  const out = [0x7E];
  for (const b of full) {
    if (b === 0x7E || b === 0x7D) out.push(0x7D, b ^ 0x20);
    else out.push(b);
  }
  out.push(0x7E);
  return Buffer.from(out);
}
function enc24(v) {
  if (v < 0) v += 1 << 24;
  return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
}

// ── Message builders ──────────────────────────────────────────────────

function heartbeat() {
  // status1: GPS valid + UAT initialized
  return frame([0x00, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

/**
 * Traffic report (msg 0x14).
 * altFt null → altitude invalid (0xFFF), as real receivers report for many
 * surface targets. vertRateFpm null → no vertical rate data.
 */
function traffic({ addr, lat, lon, altFt, airborne, speedKt, trackDeg, emitter, callsign, vertRateFpm }) {
  const latRaw = Math.round(lat * (1 << 23) / 180);
  const lonRaw = Math.round(lon * (1 << 23) / 180);
  const altRaw = altFt == null ? 0xFFF : Math.max(0, Math.min(0xFFE, Math.round((altFt + 1000) / 25)));
  const misc = (airborne ? 0x08 : 0x00) | 0x01; // bit3 airborne, bits1-0 true track
  // speedKt null → 0xFFF, "horizontal velocity invalid" (stationary targets)
  const hvel = speedKt == null ? 0xFFF : Math.max(0, Math.min(0xFFE, Math.round(speedKt)));
  let vvel = 0x800; // "no data"
  if (vertRateFpm != null) {
    let units = Math.round(vertRateFpm / 64);
    units = Math.max(-510, Math.min(510, units));
    vvel = units < 0 ? units + 0x1000 : units;
  }
  const track = Math.round(((trackDeg % 360) + 360) % 360 * 256 / 360) & 0xFF;
  const cs = callsign.padEnd(8, " ").slice(0, 8);
  return frame([
    0x14,
    0x00, // no alert, ADS-B with ICAO address
    (addr >> 16) & 0xFF, (addr >> 8) & 0xFF, addr & 0xFF,
    ...enc24(latRaw), ...enc24(lonRaw),
    (altRaw >> 4) & 0xFF, ((altRaw & 0x0F) << 4) | misc,
    0x88, // NIC 8 / NACp 8
    (hvel >> 4) & 0xFF, ((hvel & 0x0F) << 4) | ((vvel >> 8) & 0x0F), vvel & 0xFF,
    track,
    emitter,
    ...[...cs].map((c) => c.charCodeAt(0)),
    0x00,
  ]);
}

// ── Scenario ──────────────────────────────────────────────────────────

const CENTER = { lat: 39.070, lon: -77.560 }; // "runway threshold"
const FIELD_ELEV_FT = 390;
const NM_LAT = 1 / 60;
const NM_LON = NM_LAT / Math.cos(CENTER.lat * Math.PI / 180);

const staticTargets = [
  { addr: 0xA11111, lat: CENTER.lat + 0.3 * NM_LAT, lon: CENTER.lon, altFt: null, airborne: false, speedKt: 8,  trackDeg: 90,  emitter: 1,  callsign: "TAXI1" },
  { addr: 0xA22222, lat: CENTER.lat - 0.2 * NM_LAT, lon: CENTER.lon, altFt: null, airborne: false, speedKt: 12, trackDeg: 180, emitter: 18, callsign: "OPS2" },
  { addr: 0xA33333, lat: CENTER.lat, lon: CENTER.lon + 1.0 * NM_LON, altFt: 800, airborne: true, speedKt: 95, trackDeg: 270, emitter: 1, callsign: "AIR3" },
  // Parked and transmitting, position decoded: stationary in every field —
  // speed INVALID (0xFFF), altitude invalid, on ground. Must stay on the map.
  { addr: 0xA55555, lat: CENTER.lat + 0.15 * NM_LAT, lon: CENTER.lon - 0.1 * NM_LON, altFt: null, airborne: false, speedKt: null, trackDeg: 0, emitter: 1, callsign: "PARKED1" },
  // Tracked with NO decoded position (GDL-90 zeroes lat/lon) — the common
  // case for parked aircraft whose surface position won't decode. Must show
  // in the traffic list as "no position", never on the map.
  { addr: 0xA66666, lat: 0, lon: 0, altFt: null, airborne: false, speedKt: null, trackDeg: 0, emitter: 1, callsign: "NOPOS1" },
];

// Touch-and-go circuit: left closed traffic on a runway pointing true north.
// Waypoints as fractions of the cycle; positions in nm offsets from the
// threshold; altitude AGL; onGround through the touchdown→liftoff segment.
const TG_WAYPOINTS = [
  // t,     north nm, east nm, altAGL, speedKt, ground
  { t: 0.00, n: -1.2, e: 0.00, agl: 600, kt: 65, ground: false }, // final approach fix
  { t: 0.21, n: 0.0,  e: 0.00, agl: 0,   kt: 60, ground: true  }, // touchdown at threshold
  { t: 0.31, n: 0.4,  e: 0.00, agl: 0,   kt: 55, ground: true  }, // ground roll → rotate
  { t: 0.50, n: 1.4,  e: 0.00, agl: 700, kt: 70, ground: false }, // upwind climb-out
  { t: 0.60, n: 1.4,  e: -0.75, agl: 900, kt: 75, ground: false }, // crosswind
  { t: 0.83, n: -1.2, e: -0.75, agl: 900, kt: 80, ground: false }, // downwind
  { t: 0.93, n: -1.2, e: 0.00, agl: 700, kt: 70, ground: false }, // base → final turn
  { t: 1.00, n: -1.2, e: 0.00, agl: 600, kt: 65, ground: false }, // back at the FAF
];

function bearingDeg(from, to) {
  const dN = to.n - from.n;
  const dE = to.e - from.e;
  if (dN === 0 && dE === 0) return 0;
  return (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
}

function touchAndGo(cycleSec, nowMs) {
  const phase = (nowMs / 1000 % cycleSec) / cycleSec;
  let i = 0;
  while (i < TG_WAYPOINTS.length - 1 && TG_WAYPOINTS[i + 1].t <= phase) i++;
  const a = TG_WAYPOINTS[i];
  const b = TG_WAYPOINTS[Math.min(i + 1, TG_WAYPOINTS.length - 1)];
  const span = Math.max(b.t - a.t, 1e-6);
  const f = Math.min(Math.max((phase - a.t) / span, 0), 1);

  const n = a.n + (b.n - a.n) * f;
  const e = a.e + (b.e - a.e) * f;
  const agl = a.agl + (b.agl - a.agl) * f;
  const kt = a.kt + (b.kt - a.kt) * f;
  const ground = a.ground; // segment state: ground until the liftoff waypoint
  const segSec = span * cycleSec;
  const vertRateFpm = ground ? null : ((b.agl - a.agl) / segSec) * 60;

  return {
    addr: 0xA44444,
    lat: CENTER.lat + n * NM_LAT,
    lon: CENTER.lon + e * NM_LON,
    // Real receivers mark altitude invalid on the surface
    altFt: ground ? null : Math.round(FIELD_ELEV_FT + agl),
    airborne: !ground,
    speedKt: kt,
    trackDeg: bearingDeg(a, b),
    emitter: 1,
    callsign: "TCHGO1",
    vertRateFpm,
  };
}

// ── Main loop ─────────────────────────────────────────────────────────

const cycleArg = process.argv.indexOf("--cycle");
const CYCLE_SEC = cycleArg >= 0 ? Math.max(20, parseInt(process.argv[cycleArg + 1], 10) || 120) : 120;
const hostArg = process.argv.indexOf("--host");
const HOST = hostArg >= 0 && process.argv[hostArg + 1] ? process.argv[hostArg + 1] : "127.0.0.1";

const sock = dgram.createSocket("udp4");
let lastPhase = "";
setInterval(() => {
  const tg = touchAndGo(CYCLE_SEC, Date.now());
  const bufs = [heartbeat(), ...staticTargets.map(traffic), traffic(tg)];
  for (const b of bufs) sock.send(b, 4000, HOST);

  const phase = tg.airborne
    ? (tg.vertRateFpm != null && tg.vertRateFpm > 50 ? "CLIMB" : tg.vertRateFpm != null && tg.vertRateFpm < -50 ? "DESCENT" : "PATTERN")
    : "GROUND ROLL";
  if (phase !== lastPhase) {
    lastPhase = phase;
    console.log(`[sim] TCHGO1 ${phase.padEnd(11)} alt=${tg.altFt == null ? "invalid" : tg.altFt + " ft"}  ${Math.round(tg.speedKt)} kt  trk ${Math.round(tg.trackDeg)}°`);
  }
}, 500);

console.log(`[sim] 3 static targets + TCHGO1 touch-and-gos (${CYCLE_SEC}s circuit) → udp://${HOST}:4000`);
console.log("[sim] center the app near 39.070, -77.560 to watch");
