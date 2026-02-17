// web/src/services/remoteId.ts
// FAA Remote ID drone position feeds

export type DroneTrack = {
  id: string;
  lat: number;
  lon: number;
  altFt: number;
  headingDeg: number;
  speedKts: number;
  operatorId?: string;
  uasType?: string; // "helicopter" | "multirotor" | "fixed_wing" | "hybrid"
  timestamp: number;
};

export type TrackBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Fetch live drone positions from Remote ID broadcast */
export async function fetchDroneTracks(
  _bbox: TrackBbox
): Promise<DroneTrack[]> {
  // TODO: Integrate Remote ID receiver / aggregation service
  return [];
}
