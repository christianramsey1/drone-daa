// relay/odid.js — Open Drone ID message parser per ASTM F3411-22a Section 4
// Pure binary parsing — works with Uint8Array, no Node-specific APIs.
// Each ODID message is 25 bytes. Byte 0: type (high nibble) + version (low nibble).

"use strict";

// ── Message type constants ───────────────────────────────────────────────

const MSG_TYPE = {
  BASIC_ID: 0x0,
  LOCATION: 0x1,
  AUTH: 0x2,
  SELF_ID: 0x3,
  SYSTEM: 0x4,
  OPERATOR_ID: 0x5,
  MESSAGE_PACK: 0xf,
};

// ── ID type from Basic ID ────────────────────────────────────────────────

const ID_TYPE = ["none", "serialNumber", "registrationId", "utmAssigned", "specificSessionId"];

// ── UAS type from Basic ID ───────────────────────────────────────────────

const UAS_TYPE = [
  "none", "aeroplane", "helicopter", "gyroplane", "hybridLift", "ornithopter",
  "glider", "kite", "freeballoon", "captive", "airship", "freeFall",
  "rocket", "tethered", "groundObstacle", "other",
];

// ── Operational status ───────────────────────────────────────────────────

const OP_STATUS = ["undeclared", "ground", "airborne", "emergency", "systemFailure"];

// ── Height type ──────────────────────────────────────────────────────────

const HEIGHT_TYPE = ["aboveTakeoff", "agl"];

// ── Speed multiplier ─────────────────────────────────────────────────────

const SPEED_MULT = [0.25, 0.75]; // index 0 = ×0.25 m/s, index 1 = ×0.75 m/s

// ── Helpers ──────────────────────────────────────────────────────────────

function readAscii(buf, offset, len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[offset + i];
    if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
  }
  return s.trim();
}

function latLonFromInt32(raw) {
  // Signed 32-bit, scaled by 1e-7 degrees
  if (raw > 0x7fffffff) raw -= 0x100000000;
  return raw * 1e-7;
}

function metersToFeet(m) {
  return m * 3.28084;
}

function mpsToKnots(mps) {
  return mps * 1.94384;
}

function mpsToFpm(mps) {
  return mps * 196.85;
}

// ── Parse a single 25-byte ODID message ──────────────────────────────────

/**
 * Parse one 25-byte Open Drone ID message.
 * Returns { msgType, ...fields } or null if invalid.
 */
function parseOdidMessage(buf, offset = 0) {
  if (buf.length - offset < 25) return null;

  const header = buf[offset];
  const msgType = (header >> 4) & 0x0f;
  // const version = header & 0x0f;

  switch (msgType) {
    case MSG_TYPE.BASIC_ID:
      return parseBasicId(buf, offset);
    case MSG_TYPE.LOCATION:
      return parseLocation(buf, offset);
    case MSG_TYPE.SYSTEM:
      return parseSystem(buf, offset);
    case MSG_TYPE.SELF_ID:
      return parseSelfId(buf, offset);
    case MSG_TYPE.OPERATOR_ID:
      return parseOperatorId(buf, offset);
    case MSG_TYPE.AUTH:
      return { msgType: MSG_TYPE.AUTH }; // Auth page — not critical for display
    case MSG_TYPE.MESSAGE_PACK:
      return parseMessagePack(buf, offset);
    default:
      return null;
  }
}

// ── Basic ID Message (type 0x0) ──────────────────────────────────────────

function parseBasicId(buf, off) {
  const idType = (buf[off + 1] >> 4) & 0x0f;
  const uasType = buf[off + 1] & 0x0f;
  const uaId = readAscii(buf, off + 2, 20);

  return {
    msgType: MSG_TYPE.BASIC_ID,
    idType: ID_TYPE[idType] || "unknown",
    uasType: UAS_TYPE[uasType] || "other",
    uaId,
  };
}

// ── Location/Vector Message (type 0x1) ───────────────────────────────────

function parseLocation(buf, off) {
  const statusByte = buf[off + 1];
  const status = OP_STATUS[(statusByte >> 4) & 0x0f] || "undeclared";
  const heightType = HEIGHT_TYPE[(statusByte >> 2) & 0x01] || "aboveTakeoff";
  const ewDirection = (statusByte >> 1) & 0x01; // 0=E, 1=W? (direction enum)
  const speedMult = SPEED_MULT[statusByte & 0x01];

  const direction = buf[off + 2]; // 0-360 mapped to 0-255 (or 0-359 with 361 = invalid)
  const headingDeg = direction <= 360 ? direction : 0;

  const speedRaw = buf[off + 3];
  const speedMps = speedRaw === 255 ? null : speedRaw * speedMult;

  const vertSpeedRaw = buf[off + 4]; // signed int8, ×0.5 m/s
  let vertSpeedMps = null;
  if (vertSpeedRaw !== -128) { // 0x80 = unknown
    const signed = vertSpeedRaw > 127 ? vertSpeedRaw - 256 : vertSpeedRaw;
    vertSpeedMps = signed * 0.5;
  }

  // Latitude: signed 32-bit (bytes 5-8, little-endian)
  const latRaw = buf[off + 5] | (buf[off + 6] << 8) | (buf[off + 7] << 16) | (buf[off + 8] << 24);
  const lat = latLonFromInt32(latRaw);

  // Longitude: signed 32-bit (bytes 9-12, little-endian)
  const lonRaw = buf[off + 9] | (buf[off + 10] << 8) | (buf[off + 11] << 16) | (buf[off + 12] << 24);
  const lon = latLonFromInt32(lonRaw);

  // Pressure altitude: unsigned 16-bit (bytes 13-14, LE), ×0.5m, offset -1000m
  const pressAltRaw = buf[off + 13] | (buf[off + 14] << 8);
  const pressAltM = pressAltRaw === 0xffff ? null : (pressAltRaw * 0.5) - 1000;

  // Geodetic altitude: unsigned 16-bit (bytes 15-16, LE), ×0.5m, offset -1000m
  const geoAltRaw = buf[off + 15] | (buf[off + 16] << 8);
  const geoAltM = geoAltRaw === 0xffff ? null : (geoAltRaw * 0.5) - 1000;

  // Height above takeoff/ground: unsigned 16-bit (bytes 17-18, LE), ×0.5m, offset -1000m
  const heightRaw = buf[off + 17] | (buf[off + 18] << 8);
  const heightM = heightRaw === 0xffff ? null : (heightRaw * 0.5) - 1000;

  // Horizontal/vertical accuracy (byte 19)
  // Timestamp (bytes 20-21): 1/10 sec since hour
  const tsSinceHour = (buf[off + 20] | (buf[off + 21] << 8)) / 10; // seconds

  return {
    msgType: MSG_TYPE.LOCATION,
    operationalStatus: status,
    heightType,
    headingDeg,
    speedKts: speedMps != null ? mpsToKnots(speedMps) : 0,
    vertRateFpm: vertSpeedMps != null ? mpsToFpm(vertSpeedMps) : 0,
    lat,
    lon,
    altFt: geoAltM != null ? metersToFeet(geoAltM) : pressAltM != null ? metersToFeet(pressAltM) : 0,
    altPressureFt: pressAltM != null ? metersToFeet(pressAltM) : undefined,
    heightFt: heightM != null ? metersToFeet(heightM) : undefined,
    heightType,
    tsSinceHour,
  };
}

// ── System Message (type 0x4) ────────────────────────────────────────────

function parseSystem(buf, off) {
  const flags = buf[off + 1];
  const classType = (flags >> 4) & 0x0f;
  const operatorLocType = flags & 0x03; // 0=takeoff, 1=liveGNSS, 2=fixed

  // Operator/takeoff latitude (bytes 2-5, LE signed 32-bit, ×1e-7)
  const opLatRaw = buf[off + 2] | (buf[off + 3] << 8) | (buf[off + 4] << 16) | (buf[off + 5] << 24);
  const opLat = latLonFromInt32(opLatRaw);

  // Operator/takeoff longitude (bytes 6-9)
  const opLonRaw = buf[off + 6] | (buf[off + 7] << 8) | (buf[off + 8] << 16) | (buf[off + 9] << 24);
  const opLon = latLonFromInt32(opLonRaw);

  // Area count / radius / ceiling / floor (bytes 10-16)
  const areaCount = buf[off + 10] | (buf[off + 11] << 8);
  const areaRadius = buf[off + 12]; // ×10 meters
  const areaCeilingRaw = buf[off + 13] | (buf[off + 14] << 8);
  const areaCeilingM = areaCeilingRaw === 0xffff ? null : (areaCeilingRaw * 0.5) - 1000;
  const areaFloorRaw = buf[off + 15] | (buf[off + 16] << 8);
  const areaFloorM = areaFloorRaw === 0xffff ? null : (areaFloorRaw * 0.5) - 1000;

  // Operator altitude (bytes 17-18, LE)
  const opAltRaw = buf[off + 17] | (buf[off + 18] << 8);
  const opAltM = opAltRaw === 0xffff ? null : (opAltRaw * 0.5) - 1000;

  // System type: 0 = undeclared, 1 = standard RID, 2 = broadcast module
  const ridType = classType === 2 ? "broadcastModule" : "standard";

  // Determine if it's operator location (Standard RID) or takeoff (Broadcast Module)
  const isOperator = ridType === "standard" || operatorLocType === 1;

  return {
    msgType: MSG_TYPE.SYSTEM,
    ridType,
    operatorLocType,
    operatorLat: isOperator ? opLat : undefined,
    operatorLon: isOperator ? opLon : undefined,
    takeoffLat: !isOperator ? opLat : undefined,
    takeoffLon: !isOperator ? opLon : undefined,
    operatorAltFt: opAltM != null ? metersToFeet(opAltM) : undefined,
    areaCount,
    areaRadiusM: areaRadius * 10,
    areaCeilingFt: areaCeilingM != null ? metersToFeet(areaCeilingM) : undefined,
    areaFloorFt: areaFloorM != null ? metersToFeet(areaFloorM) : undefined,
  };
}

// ── Self-ID Message (type 0x3) ───────────────────────────────────────────

function parseSelfId(buf, off) {
  const descType = buf[off + 1];
  const text = readAscii(buf, off + 2, 23);
  return {
    msgType: MSG_TYPE.SELF_ID,
    descriptionType: descType,
    description: text,
  };
}

// ── Operator ID Message (type 0x5) ───────────────────────────────────────

function parseOperatorId(buf, off) {
  const opIdType = buf[off + 1];
  const operatorId = readAscii(buf, off + 2, 20);
  return {
    msgType: MSG_TYPE.OPERATOR_ID,
    operatorIdType: opIdType,
    operatorId,
  };
}

// ── Message Pack (type 0xF) ──────────────────────────────────────────────

function parseMessagePack(buf, off) {
  // Byte 1: number of messages (max 9 for BLE5 long range, or limited by size)
  const msgCount = buf[off + 1];
  // Each sub-message is 25 bytes, packed after the 2-byte header
  // Total pack size in a BLE5 LR payload can hold up to 9 messages
  const messages = [];
  const headerSize = 2; // type byte + count byte
  for (let i = 0; i < msgCount && i < 9; i++) {
    const subOff = off + headerSize + (i * 25);
    if (subOff + 25 > buf.length) break;
    const msg = parseOdidMessage(buf, subOff);
    if (msg) messages.push(msg);
  }
  return {
    msgType: MSG_TYPE.MESSAGE_PACK,
    messages,
  };
}

// ── Assemble partial messages into a DroneTrack ──────────────────────────

/**
 * Merge parsed ODID messages for a single drone into a track object.
 * Accepts an array of parsed messages (from individual or message pack).
 */
function assembleTrack(droneId, messages, broadcastType) {
  const track = {
    id: droneId,
    idType: "unknown",
    lat: 0,
    lon: 0,
    altFt: 0,
    headingDeg: 0,
    speedKts: 0,
    vertRateFpm: 0,
    uasType: "none",
    ridType: "standard",
    operationalStatus: "undeclared",
    broadcastType: broadcastType || "unknown",
    timestamp: Date.now(),
  };

  for (const msg of messages) {
    if (!msg) continue;

    if (msg.msgType === MSG_TYPE.BASIC_ID) {
      track.idType = msg.idType;
      track.uasType = msg.uasType;
      if (msg.idType === "serialNumber") track.serialNumber = msg.uaId;
      else if (msg.idType === "sessionId" || msg.idType === "specificSessionId") track.sessionId = msg.uaId;
      else if (msg.idType === "registrationId") track.registrationId = msg.uaId;
      // Use uaId as the primary ID if we got one
      if (msg.uaId) track.id = msg.uaId;
    }

    if (msg.msgType === MSG_TYPE.LOCATION) {
      track.lat = msg.lat;
      track.lon = msg.lon;
      track.altFt = msg.altFt;
      track.altPressureFt = msg.altPressureFt;
      track.headingDeg = msg.headingDeg;
      track.speedKts = msg.speedKts;
      track.vertRateFpm = msg.vertRateFpm;
      track.operationalStatus = msg.operationalStatus;
    }

    if (msg.msgType === MSG_TYPE.SYSTEM) {
      track.ridType = msg.ridType;
      if (msg.operatorLat != null) {
        track.operatorLat = msg.operatorLat;
        track.operatorLon = msg.operatorLon;
      }
      if (msg.takeoffLat != null) {
        track.takeoffLat = msg.takeoffLat;
        track.takeoffLon = msg.takeoffLon;
      }
      track.operatorAltFt = msg.operatorAltFt;
    }

    if (msg.msgType === MSG_TYPE.OPERATOR_ID) {
      track.operatorId = msg.operatorId;
    }

    if (msg.msgType === MSG_TYPE.MESSAGE_PACK) {
      // Recursively process sub-messages
      const sub = assembleTrack(droneId, msg.messages, broadcastType);
      Object.assign(track, sub);
    }
  }

  return track;
}

module.exports = {
  MSG_TYPE,
  parseOdidMessage,
  assembleTrack,
  parseBasicId,
  parseLocation,
  parseSystem,
  parseSelfId,
  parseOperatorId,
  parseMessagePack,
};
