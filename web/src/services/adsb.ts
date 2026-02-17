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
  category: string;  // A1-A7, B1-B7 per DO-260B
  onGround: boolean;
  timestamp: number;
};

export type TrackBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Fetch live manned aircraft positions from ADS-B */
export async function fetchAircraft(
  _bbox: TrackBbox
): Promise<AircraftTrack[]> {
  // TODO: Integrate ADS-B Exchange, OpenSky Network, or ADSB.lol
  return [];
}
