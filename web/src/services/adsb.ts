// web/src/services/adsb.ts
// ADS-B manned aircraft position feeds for detect-and-avoid

export type AircraftTrack = {
  id: string;       // ICAO hex code
  callsign?: string;
  lat: number;
  lon: number;
  altFt: number;
  headingDeg: number;
  speedKts: number;
  vertRateFpm?: number; // vertical rate (feet per minute)
  squawk?: string;
  category: string;  // emitter category label (Light, Large, Heavy, etc.)
  onGround: boolean;
  timestamp: number;
};

/** WebSocket snapshot from the GDL90 relay */
export type AdsbSnapshot = {
  type: "snapshot";
  timestamp: number;
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
