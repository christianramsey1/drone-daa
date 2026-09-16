// web/src/services/adsb.ts
// ADS-B manned aircraft position feeds for detect-and-avoid

export type AircraftTrack = {
  id: string;       // ICAO hex code
  callsign?: string;
  lat: number;
  lon: number;
  /** null when the GDL-90 report marks altitude invalid — common for surface targets */
  altFt: number | null;
  headingDeg: number;
  /** null when the GDL-90 report marks velocity invalid */
  speedKts: number | null;
  vertRateFpm?: number; // vertical rate (feet per minute)
  squawk?: string;
  category: string;  // emitter category label (Light, Large, Heavy, etc.)
  onGround: boolean;
  timestamp: number;
};

/**
 * GDL-90 emitter categories 17/18 — airport surface vehicles (fire trucks,
 * fuel trucks, mowers). They are never airborne and never a collision threat
 * to a drone, so they must never raise a proximity alert. Labels match the
 * mapping in GDL90Plugin.swift and relay/gdl90.js.
 */
const GROUND_VEHICLE_CATEGORIES = new Set(["Surface Emergency", "Surface Service"]);

export function isGroundVehicle(category: string | undefined): boolean {
  return category != null && GROUND_VEHICLE_CATEGORIES.has(category);
}

/** WebSocket snapshot from the GDL90 relay */
export type AdsbSnapshot = {
  type: "snapshot";
  timestamp: number;
  /** ms-epoch arrival time of the last UDP packet from the receiver, or null if none yet */
  lastPacketAt?: number | null;
  receiverConnected: boolean;
  gpsValid: boolean;
  ownship: AircraftTrack | null;
  aircraft: AircraftTrack[];
  count: number;
};

export type TrackBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Fetch live manned aircraft from online ADS-B API (future) */
export async function fetchAircraft(
  _bbox: TrackBbox
): Promise<AircraftTrack[]> {
  // TODO: Integrate ADS-B Exchange, OpenSky Network, or ADSB.lol
  return [];
}
