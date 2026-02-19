// web/src/zones/index.ts
// Zone configuration for DroneDAA

export type ZoneId = string;

export type ZoneBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type ZoneConfig = {
  id: ZoneId;
  name: string;
  center: { lat: number; lon: number };
  defaultZoom: number;
  bbox: ZoneBbox;
};

// Default view — user's area or a sensible default
export const DEFAULT_ZONE: ZoneConfig = {
  id: "default",
  name: "Current Area",
  center: { lat: 37.09, lon: -79.67 },
  defaultZoom: 10,
  bbox: { south: 36.5, west: -80.5, north: 37.7, east: -78.8 },
};
