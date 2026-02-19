// web/src/services/remoteId.ts
// Remote ID types and parsing per ASTM F3586-22

// ── Broadcast transport types ───────────────────────────────────────────

export type RidBroadcastType =
  | "bluetooth5LongRange"
  | "bluetooth5Legacy"
  | "wifiBeacon"
  | "wifiNan"
  | "unknown";

// ── RID system classification ───────────────────────────────────────────

/** Standard = aircraft broadcasts its own + operator location.
 *  Broadcast Module = add-on that broadcasts aircraft + takeoff location. */
export type RidSystemType = "standard" | "broadcastModule";

// ── Operational status per ASTM F3411-22a ───────────────────────────────

export type RidOperationalStatus =
  | "undeclared"
  | "ground"
  | "airborne"
  | "emergency"
  | "systemFailure";

// ── ID type from Basic ID message ───────────────────────────────────────

export type RidIdType = "serialNumber" | "sessionId" | "registrationId" | "unknown";

// ── UAS type classification ─────────────────────────────────────────────

export type UasType =
  | "none"
  | "aeroplane"
  | "helicopter"
  | "gyroplane"
  | "hybridLift"
  | "ornithopter"
  | "glider"
  | "kite"
  | "freeballoon"
  | "captive"
  | "airship"
  | "freeFall"
  | "rocket"
  | "tethered"
  | "groundObstacle"
  | "other";

// ── Core drone track type ───────────────────────────────────────────────

export type DroneTrack = {
  // Identity (from Basic ID Message)
  id: string;
  idType: RidIdType;
  serialNumber?: string;
  sessionId?: string;
  registrationId?: string;

  // Position (from Location/Vector Message)
  lat: number;
  lon: number;
  altFt: number;
  altPressureFt?: number;
  headingDeg: number;
  speedKts: number;
  vertRateFpm?: number;

  // Operator / System info (from System Message)
  operatorLat?: number;
  operatorLon?: number;
  takeoffLat?: number;
  takeoffLon?: number;
  operatorAltFt?: number;

  // Classification
  uasType: UasType;
  ridType: RidSystemType;
  operationalStatus: RidOperationalStatus;

  // Transport
  broadcastType: RidBroadcastType;
  rssi?: number; // dBm

  // Metadata
  timestamp: number; // local ms when last received
  operatorId?: string;
};

// ── Snapshot from relay / scanner ────────────────────────────────────────

export type RidSnapshot = {
  type: "rid-snapshot";
  timestamp: number;
  drones: DroneTrack[];
  count: number;
  scanning: boolean;
};

// ── Bounding box for spatial queries ────────────────────────────────────

export type TrackBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

// ── Open Drone ID BLE service UUID ──────────────────────────────────────

/** ASTM F3411 uses Bluetooth SIG assigned number 0xFFFA for Open Drone ID */
export const ODID_BLE_SERVICE_UUID = 0xfffa;

// ── BLE message type byte values per ASTM F3411-22a §4 ──────────────────

export const RID_MSG_TYPE = {
  BASIC_ID: 0x0,
  LOCATION: 0x1,
  AUTH: 0x2,
  SELF_ID: 0x3,
  SYSTEM: 0x4,
  OPERATOR_ID: 0x5,
  MESSAGE_PACK: 0xf,
} as const;

// ── Broadcast type labels (display) ─────────────────────────────────────

export function broadcastTypeLabel(bt: RidBroadcastType): string {
  switch (bt) {
    case "bluetooth5LongRange": return "BT5 LR";
    case "bluetooth5Legacy": return "BT5";
    case "wifiBeacon": return "WiFi";
    case "wifiNan": return "WiFi NAN";
    default: return "Unknown";
  }
}

// ── Parse raw BLE advertisement (stub) ──────────────────────────────────

/**
 * Parse a raw Open Drone ID advertisement into partial DroneTrack fields.
 * Each ODID message is 25 bytes. The first byte encodes message type (high nibble)
 * and protocol version (low nibble).
 *
 * TODO: Implement binary parsing per ASTM F3411-22a Section 4.
 */
export function parseRidAdvertisement(_data: DataView): Partial<DroneTrack> | null {
  // Message type from high nibble of first byte
  // const msgType = (_data.getUint8(0) >> 4) & 0x0f;
  // const version = _data.getUint8(0) & 0x0f;
  return null;
}
