// web/src/services/airspace.ts
// FAA airspace data via ArcGIS FeatureServer REST services

export type AirspaceType =
  | "classB"
  | "classC"
  | "classD"
  | "classE"
  | "restricted"
  | "prohibited"
  | "tfr"
  | "sua" // Special Use Airspace
  | "laanc"; // LAANC UAS Facility Map

export type AirspaceZone = {
  id: string;
  type: AirspaceType;
  name: string;
  polygon: Array<{ lat: number; lon: number }>;
  floorFt: number;
  ceilingFt: number;
  attributes?: Record<string, any>;
};

export type AirspaceBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

// ── FAA ArcGIS Layer Configuration ──────────────────────────────────────

export type FaaLayerId =
  | "classB"
  | "classC"
  | "classD"
  | "classE"
  | "tfrAreas"
  | "specialUse"
  | "prohibited"
  | "securityZones"
  | "uasFacilityMap";

export type FaaLayerConfig = {
  id: FaaLayerId;
  label: string;
  serviceUrl: string;
  layerIndex: number;
  defaultType: AirspaceType;
  defaultEnabled: boolean;
  where?: string;
};

const ARCGIS_BASE = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services";

export const FAA_LAYERS: FaaLayerConfig[] = [
  {
    id: "classB",
    label: "Class B",
    serviceUrl: `${ARCGIS_BASE}/Class_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "classB",
    defaultEnabled: true,
    where: "CLASS='B'",
  },
  {
    id: "classC",
    label: "Class C",
    serviceUrl: `${ARCGIS_BASE}/Class_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "classC",
    defaultEnabled: true,
    where: "CLASS='C'",
  },
  {
    id: "classD",
    label: "Class D",
    serviceUrl: `${ARCGIS_BASE}/Class_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "classD",
    defaultEnabled: true,
    where: "CLASS='D'",
  },
  {
    id: "classE",
    label: "Class E",
    serviceUrl: `${ARCGIS_BASE}/Class_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "classE",
    defaultEnabled: false,
    where: "CLASS='E'",
  },
  {
    id: "tfrAreas",
    label: "TFR Areas",
    serviceUrl: `${ARCGIS_BASE}/National_Defense_Airspace_TFR_Areas/FeatureServer`,
    layerIndex: 0,
    defaultType: "tfr",
    defaultEnabled: true,
  },
  {
    id: "specialUse",
    label: "Special Use (MOA)",
    serviceUrl: `${ARCGIS_BASE}/Special_Use_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "sua",
    defaultEnabled: false,
  },
  {
    id: "prohibited",
    label: "Restricted / Prohibited",
    serviceUrl: `${ARCGIS_BASE}/Prohibited_Areas/FeatureServer`,
    layerIndex: 0,
    defaultType: "prohibited",
    defaultEnabled: true,
  },
  {
    id: "securityZones",
    label: "UAS Security Zones",
    serviceUrl: `${ARCGIS_BASE}/Part_Time_National_Security_UAS_Flight_Restrictions_Primary/FeatureServer`,
    layerIndex: 0,
    defaultType: "restricted",
    defaultEnabled: false,
  },
  {
    id: "uasFacilityMap",
    label: "LAANC Grid",
    serviceUrl: `${ARCGIS_BASE}/FAA_UAS_FacilityMap_Data_V5/FeatureServer`,
    layerIndex: 0,
    defaultType: "laanc",
    defaultEnabled: false,
  },
];

// ── ArcGIS Query ────────────────────────────────────────────────────────

const CLASS_TO_TYPE: Record<string, AirspaceType> = {
  B: "classB",
  C: "classC",
  D: "classD",
  E: "classE",
};

export async function fetchAirspace(
  bbox: AirspaceBbox,
  layer: FaaLayerConfig,
  signal?: AbortSignal,
): Promise<AirspaceZone[]> {
  const geometry = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const params = new URLSearchParams({
    where: layer.where ?? "1=1",
    outFields: "*",
    geometry,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    resultRecordCount: "500",
    f: "pjson",
  });

  const url = `${layer.serviceUrl}/${layer.layerIndex}/query?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
  const data = await res.json();

  return (data.features ?? []).map((f: any) => {
    const attrs = f.attributes ?? {};
    const rings: number[][][] = f.geometry?.rings ?? [];
    // ArcGIS polygon rings: array of [lon, lat] coordinate pairs
    const polygon = (rings[0] ?? []).map(([lon, lat]: number[]) => ({ lat, lon }));

    // Determine airspace type from CLASS field if available
    const type = attrs.CLASS ? (CLASS_TO_TYPE[attrs.CLASS] ?? layer.defaultType) : layer.defaultType;

    // Build name — include LAANC ceiling altitude when available
    let name = attrs.NAME ?? attrs.IDENT ?? layer.label;
    const ceilingFt = attrs.CEILING ?? attrs.UPPER_VAL ?? attrs.CEILING_ALT ?? null;
    if (layer.defaultType === "laanc" && ceilingFt != null) {
      name = `LAANC ${ceilingFt} ft AGL`;
    }

    return {
      id: `${layer.id}-${attrs.OBJECTID ?? attrs.FID ?? Math.random().toString(36).slice(2)}`,
      type,
      name,
      polygon,
      floorFt: attrs.LOWER_VAL ?? attrs.FLOOR ?? 0,
      ceilingFt: ceilingFt ?? 99999,
      attributes: attrs,
    };
  });
}

// ── Color for airspace class ────────────────────────────────────────────

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
    case "laanc": return "#22d3ee"; // bright cyan for LAANC
    default: return "#9ca3af";
  }
}
