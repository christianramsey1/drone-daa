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
  | "laanc" // LAANC UAS Facility Map
  | "nsrPermanent" // National Security UAS Flight Restrictions (permanent)
  | "nsrPending" // Pending National Security Flight Restrictions
  | "sata" // Supplemental Air Traffic Areas (SFRA, special rules)
  | "recFlyer" // Recreational Flyer Fixed Sites (FRIA)
  | "fria" // FAA-Recognized Identification Areas
  | "obstruction"; // Digital Obstacle File (towers, antennas, etc.)

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

export type ObstructionPoint = {
  id: string;
  lat: number;
  lon: number;
  aglFt: number;
  amslFt: number;
  typeCode: string;
  lighting: string;
  city?: string;
  state?: string;
};

export type FaaLayerId =
  | "classB"
  | "classC"
  | "classD"
  | "classE5"
  | "tfrAreas"
  | "specialUse"
  | "prohibited"
  | "nsrPartTime"
  | "nsrPermanent"
  | "nsrPending"
  | "sata"
  | "recFlyer"
  | "fria"
  | "obstructions"
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
  // ── Airspace classes ───────────────────────────────────────────
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
    id: "classE5",
    label: "Class E5 (700' AGL)",
    serviceUrl: `${ARCGIS_BASE}/Class_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "classE",
    defaultEnabled: false,
    where: "LOCAL_TYPE='CLASS_E5'",
  },
  // ── Restrictions ───────────────────────────────────────────────
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
  // ── National Security ──────────────────────────────────────────
  {
    id: "nsrPartTime",
    label: "NSR Part-Time",
    serviceUrl: `${ARCGIS_BASE}/Part_Time_National_Security_UAS_Flight_Restrictions_Primary/FeatureServer`,
    layerIndex: 0,
    defaultType: "restricted",
    defaultEnabled: false,
  },
  {
    id: "nsrPermanent",
    label: "NSR Permanent (DoD)",
    serviceUrl: `${ARCGIS_BASE}/DoD_Mar_13/FeatureServer`,
    layerIndex: 0,
    defaultType: "nsrPermanent",
    defaultEnabled: true,
  },
  {
    id: "nsrPending",
    label: "NSR Pending",
    serviceUrl: `${ARCGIS_BASE}/Pending_Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer`,
    layerIndex: 0,
    defaultType: "nsrPending",
    defaultEnabled: false,
  },
  // ── Special areas ──────────────────────────────────────────────
  {
    id: "sata",
    label: "SATA (SFRA / Special Rules)",
    serviceUrl: `${ARCGIS_BASE}/Boundary_Airspace/FeatureServer`,
    layerIndex: 0,
    defaultType: "sata",
    defaultEnabled: false,
  },
  {
    id: "recFlyer",
    label: "Recreational Flyer Fixed Sites",
    serviceUrl: `${ARCGIS_BASE}/Recreational_Flyer_Fixed_Sites/FeatureServer`,
    layerIndex: 0,
    defaultType: "recFlyer",
    defaultEnabled: false,
  },
  {
    id: "fria",
    label: "FRIA (Recognized ID Areas)",
    serviceUrl: `${ARCGIS_BASE}/FAA_Recognized_Identification_Areas/FeatureServer`,
    layerIndex: 0,
    defaultType: "fria",
    defaultEnabled: false,
  },
  // ── Obstructions ────────────────────────────────────────────────
  {
    id: "obstructions",
    label: "Obstructions (DOF)",
    serviceUrl: `${ARCGIS_BASE}/Digital_Obstacle_File/FeatureServer`,
    layerIndex: 0,
    defaultType: "obstruction",
    defaultEnabled: false,
  },
  // ── UAS Facility Map ───────────────────────────────────────────
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

    // Build name from type-appropriate attributes
    let name = attrs.NAME ?? attrs.SITE_NAME ?? attrs.title ?? attrs.Facility
      ?? attrs.Base ?? attrs.IDENT ?? layer.label;
    const ceilingFt = attrs.CEILING ?? attrs.UPPER_VAL ?? attrs.CEILING_ALT ?? null;
    if (layer.defaultType === "laanc" && ceilingFt != null) {
      name = `LAANC ${ceilingFt} ft AGL`;
    }
    if (layer.defaultType === "recFlyer" && attrs.SITE_NAME) {
      name = attrs.SITE_NAME;
    }
    if (layer.defaultType === "fria" && attrs.title) {
      name = attrs.title;
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
    case "nsrPermanent": return "#b91c1c"; // deep red
    case "nsrPending": return "#f59e0b"; // amber
    case "sata": return "#10b981"; // emerald green
    case "recFlyer": return "#34d399"; // light green
    case "fria": return "#a3e635"; // lime
    case "obstruction": return "#fb923c"; // orange-300
    default: return "#9ca3af";
  }
}

// ── Obstruction points (Digital Obstacle File) ───────────────────────

export async function fetchObstructions(
  bbox: AirspaceBbox,
  signal?: AbortSignal,
): Promise<ObstructionPoint[]> {
  const geometry = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "OBJECTID,Type_Code,AGL,AMSL,Lighting,City,State",
    geometry,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    resultRecordCount: "500",
    f: "pjson",
  });

  const url = `${ARCGIS_BASE}/Digital_Obstacle_File/FeatureServer/0/query?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Obstruction query failed: ${res.status}`);
  const data = await res.json();

  return (data.features ?? []).map((f: any) => {
    const attrs = f.attributes ?? {};
    const pt = f.geometry ?? {};
    return {
      id: `obs-${attrs.OBJECTID ?? Math.random().toString(36).slice(2)}`,
      lat: pt.y ?? 0,
      lon: pt.x ?? 0,
      aglFt: attrs.AGL ?? 0,
      amslFt: attrs.AMSL ?? 0,
      typeCode: attrs.Type_Code ?? "UNKNOWN",
      lighting: attrs.Lighting ?? "",
      city: attrs.City,
      state: attrs.State,
    };
  });
}
