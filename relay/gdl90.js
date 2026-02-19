// relay/gdl90.js — Pure GDL90 binary protocol parser
// No Node.js-specific APIs — works with Uint8Array for future browser/Capacitor reuse

"use strict";

// ── CRC-16 (CRC-CCITT, poly 0x1021, init 0x0000) ─────────────────────

const CRC_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i << 8;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
  }
  CRC_TABLE[i] = crc & 0xFFFF;
}

function crc16(bytes) {
  // GDL90 ICD Appendix A: crc = Table[crc>>8] ^ (crc<<8) ^ byte
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc >> 8) & 0xFF] ^ (crc << 8) ^ bytes[i]) & 0xFFFF;
  }
  return crc;
}

// ── Byte unstuffing ───────────────────────────────────────────────────

function unstuff(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === 0x7D && i + 1 < raw.length) {
      out.push(raw[i + 1] ^ 0x20);
      i += 2;
    } else {
      out.push(raw[i]);
      i++;
    }
  }
  return new Uint8Array(out);
}

// ── Unframe a UDP payload into individual GDL90 messages ──────────────

function unframe(rawBytes) {
  const messages = [];
  const len = rawBytes.length;
  let i = 0;

  while (i < len) {
    // Find start flag
    if (rawBytes[i] !== 0x7E) { i++; continue; }

    // Find end flag
    let j = i + 1;
    while (j < len && rawBytes[j] !== 0x7E) j++;
    if (j >= len) break;

    const frameLen = j - i - 1;
    if (frameLen >= 3) { // min: msgId(1) + CRC(2)
      const frame = rawBytes.slice(i + 1, j);
      const payload = unstuff(frame);

      if (payload.length >= 3) {
        // Validate CRC: last 2 bytes are CRC (little-endian)
        const msgBody = payload.slice(0, payload.length - 2);
        const crcReceived = payload[payload.length - 2] | (payload[payload.length - 1] << 8);
        const crcCalc = crc16(msgBody);

        if (crcCalc === crcReceived) {
          messages.push({
            msgId: msgBody[0],
            payload: msgBody,
          });
        }
        // Silently drop bad CRC
      }
    }

    i = j; // next frame starts at this 0x7E (it's both end and start flag)
  }

  return messages;
}

// ── Parse Traffic Report (msg 0x14) or Ownship Report (msg 0x0A) ─────

function parseTrafficReport(payload) {
  if (payload.length < 28) return null;

  const msgId = payload[0];

  // Byte 1: alert status (upper nibble) + address type (lower nibble)
  const addressType = payload[1] & 0x0F;

  // Bytes 2-4: participant address (ICAO hex, big-endian)
  const address = (payload[2] << 16) | (payload[3] << 8) | payload[4];

  // Bytes 5-7: latitude (signed 24-bit, scaled by 180/2^23)
  let latRaw = (payload[5] << 16) | (payload[6] << 8) | payload[7];
  if (latRaw & 0x800000) latRaw -= 0x1000000;
  const lat = latRaw * (180.0 / (1 << 23));

  // Bytes 8-10: longitude (signed 24-bit, scaled by 180/2^23)
  let lonRaw = (payload[8] << 16) | (payload[9] << 8) | payload[10];
  if (lonRaw & 0x800000) lonRaw -= 0x1000000;
  const lon = lonRaw * (180.0 / (1 << 23));

  // Bytes 11-12: altitude (12 bits) + misc (4 bits)
  const altRaw = (payload[11] << 4) | ((payload[12] >> 4) & 0x0F);
  const altFt = altRaw === 0xFFF ? null : (altRaw * 25) - 1000;

  const misc = payload[12] & 0x0F;
  const airborne = (misc & 0x08) !== 0;

  // Byte 13: NIC (upper nibble) + NACp (lower nibble)
  const nic = (payload[13] >> 4) & 0x0F;
  const nacp = payload[13] & 0x0F;

  // Bytes 14-15 upper: horizontal velocity (12 bits, knots)
  const hvelRaw = (payload[14] << 4) | ((payload[15] >> 4) & 0x0F);
  const speedKts = hvelRaw === 0xFFF ? null : hvelRaw;

  // Bytes 15 lower - 16: vertical velocity (12 bits, signed, * 64 fpm)
  let vvelRaw = ((payload[15] & 0x0F) << 8) | payload[16];
  let vertRateFpm = null;
  if (vvelRaw !== 0x800) {
    if (vvelRaw & 0x800) vvelRaw -= 0x1000;
    vertRateFpm = vvelRaw * 64;
  }

  // Byte 17: track/heading (8 bits, * 360/256)
  const headingDeg = payload[17] * (360.0 / 256.0);

  // Byte 18: emitter category
  const emitterCode = payload[18];

  // Bytes 19-26: callsign (8 bytes ASCII)
  let callsign = "";
  for (let k = 19; k < 27 && k < payload.length; k++) {
    const ch = payload[k];
    if (ch >= 0x20 && ch <= 0x7E) callsign += String.fromCharCode(ch);
  }
  callsign = callsign.trim();

  // Byte 27: emergency/priority code (upper nibble)
  const emergency = payload.length > 27 ? (payload[27] >> 4) & 0x0F : 0;

  return {
    msgId,
    id: address.toString(16).toUpperCase().padStart(6, "0"),
    addressType,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    altFt,
    headingDeg: Math.round(headingDeg * 10) / 10,
    speedKts,
    vertRateFpm,
    callsign: callsign || null,
    category: emitterCategory(emitterCode),
    emitterCode,
    onGround: !airborne,
    nic,
    nacp,
    emergency,
  };
}

// ── Parse Heartbeat (msg 0x00) ───────────────────────────────────────

function parseHeartbeat(payload) {
  if (payload.length < 3) return null;

  const status1 = payload[1];
  const gpsValid = (status1 & 0x80) !== 0;
  const maintenanceRequired = (status1 & 0x40) !== 0;
  const uatInitialized = (status1 & 0x01) !== 0;

  return {
    gpsValid,
    maintenanceRequired,
    uatInitialized,
  };
}

// ── Parse Ownship Geometric Altitude (msg 0x0B) ─────────────────────

function parseOwnshipGeoAlt(payload) {
  if (payload.length < 5) return null;

  // Bytes 1-2: geometric altitude in 5-ft increments, signed 16-bit
  let raw = (payload[1] << 8) | payload[2];
  if (raw & 0x8000) raw -= 0x10000;
  const geoAltFt = raw * 5;

  // Bytes 3-4: vertical figure of merit (accuracy)
  const vfom = (payload[3] << 8) | payload[4];

  return { geoAltFt, vfom };
}

// ── Emitter category code → human label ──────────────────────────────

function emitterCategory(code) {
  const categories = {
    0: "Unknown",
    1: "Light",
    2: "Small",
    3: "Large",
    4: "High Vortex",
    5: "Heavy",
    6: "High Perf",
    7: "Rotorcraft",
    9: "Glider",
    10: "Lighter-than-Air",
    11: "Parachutist",
    12: "Ultralight",
    14: "UAV",
    15: "Space Vehicle",
    17: "Surface Emergency",
    18: "Surface Service",
    19: "Point Obstacle",
    20: "Cluster Obstacle",
    21: "Line Obstacle",
  };
  return categories[code] || "Unknown";
}

module.exports = {
  unframe,
  parseTrafficReport,
  parseHeartbeat,
  parseOwnshipGeoAlt,
  emitterCategory,
  crc16,
  unstuff,
};
