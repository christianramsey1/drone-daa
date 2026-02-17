// web/src/services/airspace.ts
// FAA airspace data — Class B/C/D/E, restricted areas, TFRs

export type AirspaceType =
  | "classB"
  | "classC"
  | "classD"
  | "classE"
  | "restricted"
  | "prohibited"
  | "tfr"
  | "sua"; // Special Use Airspace

export type AirspaceZone = {
  id: string;
  type: AirspaceType;
  name: string;
  polygon: Array<{ lat: number; lon: number }>;
  floorFt: number;
  ceilingFt: number;
};

export type AirspaceBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Fetch FAA airspace polygons for the given bounding box */
export async function fetchAirspace(
  _bbox: AirspaceBbox
): Promise<AirspaceZone[]> {
  // TODO: Integrate FAA NASR / FAA UAS Data Exchange / OpenAIP
  return [];
}

/** Color for airspace class */
export function airspaceColor(type: AirspaceType): string {
  switch (type) {
    case "classB": return "#3b82f6"; // blue
    case "classC": return "#a855f7"; // purple
    case "classD": return "#06b6d4"; // cyan
    case "classE": return "#6b7280"; // gray
    case "restricted": return "#ef4444"; // red
    case "prohibited": return "#dc2626"; // dark red
    case "tfr": return "#f97316"; // orange
    case "sua": return "#eab308"; // yellow
    default: return "#9ca3af";
  }
}
